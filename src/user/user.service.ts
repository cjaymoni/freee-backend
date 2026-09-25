import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  Repository,
  FindOptionsWhere,
  DataSource,
  EntityManager,
  QueryFailedError,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { UserEntity } from './entities/user.entity';
import { defaultAvatarUrl } from './default-avatar';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { ItemEntity, ItemStatus } from '../item/entities/item.entity';
import { ItemImageEntity } from '../item/entities/item-image.entity';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { CategoryEntity } from '../category/entities/category.entity';
import { UserResponseDto } from './dto/user-response.dto';
import { ServiceResponseDto } from 'src/common/service-response.dto';
import * as bcrypt from 'bcrypt';
import { FindUserDto } from './dto/find-user.dto';
import { AppError } from 'src/common/app-error';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { FirebaseService } from '../firebase/firebase.service';
import { closeActiveRequests } from '../item-request/close-active-requests';
import { isItemImagePublicId } from '../item/item-image-upload.options';

type UploadFile = {
  buffer: Buffer;
};

const USER_SORT_COLUMNS = new Set([
  'created_at',
  'member_since',
  'last_active',
  'first_name',
  'last_name',
  'email',
]);

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly cloudinaryService: CloudinaryService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly dataSource: DataSource,
    private readonly firebaseService: FirebaseService,
  ) {}

  private readonly logger = new Logger(UserService.name);

  async findByEmail(email: string): Promise<UserEntity | null> {
    const cacheKey = `user:email:${email}`;
    const cachedUser = await this.cacheManager.get<UserEntity>(cacheKey);
    if (cachedUser) return cachedUser;

    const user = await this.userRepository.findOne({ where: { email } });
    if (user) {
      await this.cacheManager.set(cacheKey, user, 3600); // Cache for 1 hour
    }
    return user;
  }

  async findByFirebaseUid(firebaseUid: string): Promise<UserEntity | null> {
    const cacheKey = `user:firebase_uid:${firebaseUid}`;
    const cachedUser = await this.cacheManager.get<UserEntity>(cacheKey);
    if (cachedUser) return cachedUser;

    const user = await this.userRepository.findOne({
      where: { firebase_uid: firebaseUid },
    });
    if (user) {
      await this.cacheManager.set(cacheKey, user, 3600);
    }
    return user;
  }

  async findOneEntity(id: string): Promise<UserEntity | null> {
    return await this.userRepository.findOne({ where: { id } });
  }

  /**
   * Look up a user together with their password_hash, which is `select: false`
   * on the entity and so is absent from every other lookup.
   *
   * For credential verification only. The result must never be returned from a
   * controller or written to the cache - unlike findByEmail, this method is
   * deliberately uncached so the hash does not sit in Redis.
   */
  async findByEmailWithPassword(email: string): Promise<UserEntity | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .where('user.email = :email', { email })
      .getOne();
  }

  /**
   * Id-based counterpart to {@link findByEmailWithPassword}. Same rules apply:
   * credential verification only, never returned to a caller.
   */
  async findOneEntityWithPassword(id: string): Promise<UserEntity | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .where('user.id = :id', { id })
      .getOne();
  }

  async findByEmailOrPhone(
    email?: string,
    phoneNumber?: string,
  ): Promise<UserEntity | null> {
    const whereConditions: FindOptionsWhere<UserEntity>[] = [];
    if (email) whereConditions.push({ email });
    if (phoneNumber) {
      whereConditions.push({ phone_number: phoneNumber });
    }

    if (whereConditions.length === 0) return null;

    return this.userRepository.findOne({
      where: whereConditions,
    });
  }

  async create(
    createUserDto: CreateUserDto,
    file?: UploadFile,
    options: {
      is_active?: boolean;
      is_email_verified?: boolean;
      is_phone_verified?: boolean;
      source?: string;
      upsertOnConflict?: boolean;
      markOnboardedOnCreate?: boolean;
      /**
       * The signed-in user calling POST /user. The call may then only patch
       * that user's own row; identifiers in the body are never used to pick
       * which account gets written.
       */
      actingUserId?: string;
    } = {},
    manager?: EntityManager,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    const queryRunner = !manager ? this.dataSource.createQueryRunner() : null;
    if (queryRunner) {
      await queryRunner.connect();
      await queryRunner.startTransaction();
    }
    const entityManager = manager || queryRunner!.manager;
    // Uploaded during this call: discarded if the call fails.
    let uploadedAvatarId: string | undefined;

    try {
      const source = options.source ?? 'unknown';
      this.logger.log(`[create][source=${source}] Creating user`);

      let existingUser: UserEntity | null;
      if (options.actingUserId) {
        existingUser = await this.loadOwnProfileForPatch(
          entityManager,
          options.actingUserId,
          createUserDto,
        );
      } else {
        const whereConditions: FindOptionsWhere<UserEntity>[] = [];
        if (createUserDto.firebase_uid) {
          whereConditions.push({ firebase_uid: createUserDto.firebase_uid });
        }
        if (createUserDto.email) {
          whereConditions.push({ email: createUserDto.email });
        }
        if (createUserDto.phone_number) {
          whereConditions.push({ phone_number: createUserDto.phone_number });
        }
        existingUser = whereConditions.length
          ? await entityManager.findOne(UserEntity, { where: whereConditions })
          : null;
      }

      if (existingUser) {
        const shouldPatchExisting =
          !!options.actingUserId ||
          options.upsertOnConflict ||
          (createUserDto.firebase_uid &&
            existingUser.firebase_uid === createUserDto.firebase_uid);

        if (!shouldPatchExisting) {
          if (
            createUserDto.email &&
            existingUser.email === createUserDto.email
          ) {
            throw new ConflictException('Email already exists');
          }
          if (
            createUserDto.phone_number &&
            existingUser.phone_number === createUserDto.phone_number
          ) {
            throw new ConflictException('Phone number already exists');
          }
          throw new ConflictException('User already exists');
        }

        let passwordHash: string | undefined;
        if (createUserDto.password) {
          const saltRounds = 12;
          passwordHash = await bcrypt.hash(createUserDto.password, saltRounds);
        }

        let patchData: QueryDeepPartialEntity<UserEntity> = {
          first_name: createUserDto.first_name,
          last_name: createUserDto.last_name,
          date_of_birth: createUserDto.date_of_birth,
          gender: createUserDto.gender,
          bio: createUserDto.bio,
          firebase_uid: createUserDto.firebase_uid || existingUser.firebase_uid,
          email: createUserDto.email || existingUser.email,
          phone_number: createUserDto.phone_number || existingUser.phone_number,
          is_active: options.is_active ?? existingUser.is_active,
          is_onboarded: options.markOnboardedOnCreate
            ? true
            : existingUser.is_onboarded,
          // A changed identifier has not been verified yet.
          is_email_verified:
            options.is_email_verified ??
            (createUserDto.email && createUserDto.email !== existingUser.email
              ? false
              : existingUser.is_email_verified),
          is_phone_verified:
            options.is_phone_verified ??
            (createUserDto.phone_number &&
            createUserDto.phone_number !== existingUser.phone_number
              ? false
              : existingUser.is_phone_verified),
        };

        if (passwordHash) {
          patchData = {
            ...patchData,
            password_hash: passwordHash,
          };
        }

        if (file) {
          const uploadResult = await this.cloudinaryService.uploadImage(file, {
            folder: 'users',
          });
          uploadedAvatarId = uploadResult.publicId;
          patchData = {
            ...patchData,
            cloudinary_avatar_public_id: uploadResult.publicId,
            cloudinary_avatar_url: uploadResult.secureUrl,
          };
        } else if (createUserDto.cloudinary_avatar_url) {
          patchData = {
            ...patchData,
            cloudinary_avatar_url: createUserDto.cloudinary_avatar_url,
          };
        } else if (!existingUser.cloudinary_avatar_url) {
          patchData = {
            ...patchData,
            cloudinary_avatar_url: defaultAvatarUrl(existingUser.id),
          };
        }

        await entityManager.update(UserEntity, existingUser.id, patchData);

        if (createUserDto.category_ids?.length) {
          const categories = await entityManager.findByIds(
            CategoryEntity,
            createUserDto.category_ids,
          );

          let preference = await entityManager.findOne(UserPreferenceEntity, {
            where: { user_id: existingUser.id },
            relations: ['preferred_categories'],
          });

          if (!preference) {
            preference = entityManager.create(UserPreferenceEntity, {
              user_id: existingUser.id,
              preferred_categories: categories,
            });
          } else {
            preference.preferred_categories = categories;
          }

          await entityManager.save(UserPreferenceEntity, preference);
        }

        const refreshedUser = await entityManager.findOne(UserEntity, {
          where: { id: existingUser.id },
        });

        if (!refreshedUser) {
          throw new NotFoundException('User not found after patch');
        }

        if (queryRunner) {
          await queryRunner.commitTransaction();
          // The new avatar replaced the old one; drop the old file once that
          // is committed. With a caller's manager the commit isn't ours yet.
          const replacedId = existingUser.cloudinary_avatar_public_id;
          if (
            uploadedAvatarId &&
            replacedId &&
            replacedId !== uploadedAvatarId
          ) {
            await this.cloudinaryService.deleteImagesQuietly([replacedId]);
          }
        }

        const responseDto = new UserResponseDto();
        Object.assign(responseDto, refreshedUser);
        return {
          message: 'User updated successfully',
          data: responseDto,
          state: true,
          statusCode: 200,
        };
      }

      // Hash password
      let hashedPassword = '';
      if (createUserDto.password) {
        const saltRounds = 12;
        hashedPassword = await bcrypt.hash(createUserDto.password, saltRounds);
      }

      // Handle Avatar
      let avatarData: {
        cloudinary_avatar_public_id?: string;
        cloudinary_avatar_url?: string;
      } = {};
      if (file) {
        const uploadResult = await this.cloudinaryService.uploadImage(file, {
          folder: 'users',
        });
        uploadedAvatarId = uploadResult.publicId;
        avatarData = {
          cloudinary_avatar_public_id: uploadResult.publicId,
          cloudinary_avatar_url: uploadResult.secureUrl,
        };
      } else if (createUserDto.cloudinary_avatar_url) {
        avatarData = {
          cloudinary_avatar_url: createUserDto.cloudinary_avatar_url,
        };
      } else {
        // Auto-generate a DiceBear avatar; seed will be replaced with the real user id after save
        avatarData = { cloudinary_avatar_url: defaultAvatarUrl('temp') };
      }

      const userData = { ...createUserDto } as Record<string, any>;
      delete userData.password;
      const user = entityManager.create(UserEntity, {
        ...userData,
        ...avatarData,
        firebase_uid: createUserDto.firebase_uid || null,
        password_hash: createUserDto.password ? hashedPassword : undefined,
        is_email_verified: options.is_email_verified ?? false,
        is_phone_verified: options.is_phone_verified ?? false,
        is_onboarded: options.markOnboardedOnCreate ?? false,
        is_active: options.is_active ?? true,
        notification_enabled: true,
        failed_login_attempts: 0,
        member_since: new Date(),
      });

      const result = await entityManager.save(UserEntity, user);

      // Replace temp seed with the real user id for a stable, unique avatar
      if (!file && !createUserDto.cloudinary_avatar_url) {
        result.cloudinary_avatar_url = defaultAvatarUrl(result.id);
        await entityManager.update(UserEntity, result.id, {
          cloudinary_avatar_url: result.cloudinary_avatar_url,
        });
      }

      // Create user preference with selected categories
      const preference = entityManager.create(UserPreferenceEntity, {
        user_id: result.id,
        preferred_categories: createUserDto.category_ids?.length
          ? await entityManager.findByIds(
              CategoryEntity,
              createUserDto.category_ids,
            )
          : [],
      });
      await entityManager.save(UserPreferenceEntity, preference);

      if (queryRunner) {
        await queryRunner.commitTransaction();
      }

      this.logger.log(`User record persisted`);

      const responseDto = new UserResponseDto();
      Object.assign(responseDto, result);

      return {
        message: 'User created successfully',
        data: responseDto,
        state: true,
        statusCode: 201,
      };
    } catch (error) {
      if (queryRunner) {
        await queryRunner.rollbackTransaction();
      }
      // Nothing references this upload now that the write failed.
      if (uploadedAvatarId) {
        await this.cloudinaryService.deleteImagesQuietly([uploadedAvatarId]);
      }
      throw error;
    } finally {
      if (queryRunner) {
        await queryRunner.release();
      }
    }
  }

  /**
   * Resolve the row POST /user may patch: always the caller's own. Rejects an
   * email or phone that belongs to another account, and a password when the
   * account already has one (that goes through /auth/change-password, which
   * checks the current password). firebase_uid is set by the backend at
   * sign-in, so a client-sent value is dropped.
   */
  private async loadOwnProfileForPatch(
    manager: EntityManager,
    userId: string,
    dto: CreateUserDto,
  ): Promise<UserEntity> {
    const user = await manager
      .createQueryBuilder(UserEntity, 'user')
      .addSelect('user.password_hash')
      .where('user.id = :userId', { userId })
      .andWhere('user.is_deleted = false')
      .getOne();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    dto.firebase_uid = undefined;

    if (dto.email && dto.email !== user.email) {
      const taken = await manager.findOne(UserEntity, {
        where: { email: dto.email },
      });
      if (taken) throw new ConflictException('Email already exists');
    }
    if (dto.phone_number && dto.phone_number !== user.phone_number) {
      const taken = await manager.findOne(UserEntity, {
        where: { phone_number: dto.phone_number },
      });
      if (taken) throw new ConflictException('Phone number already exists');
    }
    if (dto.password && user.password_hash) {
      throw new BadRequestException(
        'Password is already set; use /auth/change-password',
      );
    }
    return user;
  }

  async findAll(
    findUserDto: FindUserDto,
  ): Promise<ServiceResponseDto<UserResponseDto[]>> {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy,
        order = 'DESC',
        ...query
      } = findUserDto;

      const where = {
        ...query,
        is_deleted: false,
      } as unknown as FindOptionsWhere<UserEntity>;

      if (query.date_of_birth) {
        where.date_of_birth = new Date(query.date_of_birth);
      }

      const [users, total] = await this.userRepository.findAndCount({
        where,
        order: {
          [sortBy && USER_SORT_COLUMNS.has(sortBy) ? sortBy : 'created_at']:
            order,
        },
        take: limit,
        skip: (page - 1) * limit,
      });
      this.logger.log(`Found ${users.length} users`);
      const responseDto = users.map((user) => {
        const responseDto = new UserResponseDto();
        Object.assign(responseDto, user);
        return responseDto;
      });
      return {
        message: 'Users found successfully',
        data: responseDto,
        state: true,
        statusCode: 200,
        total,
        page,
        limit,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Error finding users: ${error.message}`, error.stack);
      }
      throw new AppError(error);
    }
  }

  async findOne(id: string): Promise<ServiceResponseDto<UserResponseDto>> {
    try {
      const cacheKey = `user:id:${id}`;
      const cachedUser = await this.cacheManager.get<UserEntity>(cacheKey);

      let user: UserEntity | null = null;
      if (cachedUser) {
        user = cachedUser;
      } else {
        user = await this.userRepository.findOne({ where: { id } });
        if (user) {
          await this.cacheManager.set(cacheKey, user, 3600);
        }
      }

      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      const responseDto = new UserResponseDto();
      Object.assign(responseDto, user);
      return {
        message: 'User found successfully',
        data: responseDto,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error finding user ${id}: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    manager?: EntityManager,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    try {
      const entityManager = manager || this.userRepository.manager;
      const user = await entityManager.findOne(UserEntity, { where: { id } });
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      // Both columns are unique: answer a taken value with a 409 rather than
      // letting the insert fail as a 500 carrying the raw constraint name.
      if (updateUserDto.email && updateUserDto.email !== user.email) {
        const taken = await entityManager.findOne(UserEntity, {
          where: { email: updateUserDto.email },
        });
        if (taken && taken.id !== id) {
          throw new ConflictException('Email already exists');
        }
      }
      if (
        updateUserDto.phone_number &&
        updateUserDto.phone_number !== user.phone_number
      ) {
        const taken = await entityManager.findOne(UserEntity, {
          where: { phone_number: updateUserDto.phone_number },
        });
        if (taken && taken.id !== id) {
          throw new ConflictException('Phone number already exists');
        }
      }

      const { password, ...otherData } = updateUserDto;
      const updateData = {
        ...(otherData as any),
      } as QueryDeepPartialEntity<UserEntity>;

      if (password) {
        const saltRounds = 12;
        updateData.password_hash = await bcrypt.hash(password, saltRounds);
      }

      // Clearing the avatar falls back to the DiceBear default, not to nothing.
      if (
        'cloudinary_avatar_url' in updateUserDto &&
        !updateUserDto.cloudinary_avatar_url
      ) {
        updateData.cloudinary_avatar_url = defaultAvatarUrl(id);
      }

      // A new address hasn't been verified yet, unless the caller (an admin)
      // says otherwise explicitly.
      if (
        updateUserDto.email !== undefined &&
        updateUserDto.email !== user.email &&
        updateUserDto.is_email_verified === undefined
      ) {
        updateData.is_email_verified = false;
      }
      if (
        updateUserDto.phone_number !== undefined &&
        updateUserDto.phone_number !== user.phone_number &&
        updateUserDto.is_phone_verified === undefined
      ) {
        updateData.is_phone_verified = false;
      }

      // Check for onboarding completion
      if (
        updateUserDto.first_name &&
        updateUserDto.last_name &&
        !user.is_onboarded
      ) {
        updateData.is_onboarded = true;
      }

      await entityManager.update(UserEntity, id, updateData);
      const updatedUser = await entityManager.findOne(UserEntity, {
        where: { id },
      });

      // Invalidate cache
      const freshUser = await entityManager.findOne(UserEntity, {
        where: { id },
      });
      if (freshUser) {
        await this.cacheManager.del(`user:id:${id}`);
        await this.cacheManager.del(`user:email:${freshUser.email}`);
        if (user.email && user.email !== freshUser.email) {
          await this.cacheManager.del(`user:email:${user.email}`);
        }
      }

      const responseDto = new UserResponseDto();
      Object.assign(responseDto, updatedUser);
      return {
        message: 'User updated successfully',
        data: responseDto,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error updating user ${id}: ${error.message}`,
          error.stack,
        );
      }
      // A concurrent update claimed the value between the check and the write.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | undefined)?.code === '23505'
      ) {
        throw new AppError(
          new ConflictException('Email or phone number already exists'),
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * Set a user's phone number from a verified Firebase ID token.
   *
   * The number is read from the token, never from the client, so the stored
   * phone is always one Firebase has verified. The token must belong to the
   * same Firebase account as the user; the number and its verified flag are
   * written in one statement, so a failure leaves the old phone untouched.
   */
  async updatePhoneFromFirebase(
    id: string,
    idToken: string,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    let decoded: Awaited<ReturnType<FirebaseService['verifyIdToken']>>;
    try {
      decoded = await this.firebaseService.verifyIdToken(idToken);
    } catch (error) {
      this.logger.warn(
        `Firebase token verification failed for user ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new AppError(
        new UnauthorizedException(
          'The Firebase ID token is invalid or expired. Refresh it and try again.',
        ),
      );
    }

    const phoneNumber = decoded.phone_number;
    if (!phoneNumber) {
      throw new AppError(
        new BadRequestException(
          'The Firebase account has no verified phone number. Verify the number in Firebase first.',
        ),
      );
    }

    const user = await this.userRepository.findOne({
      where: { id, is_deleted: false },
    });
    if (!user) {
      throw new AppError(new NotFoundException(`User with ID ${id} not found`));
    }
    if (!user.firebase_uid || user.firebase_uid !== decoded.uid) {
      throw new AppError(
        new ForbiddenException(
          'The Firebase ID token belongs to a different account.',
        ),
      );
    }

    if (user.phone_number === phoneNumber && user.is_phone_verified) {
      const responseDto = new UserResponseDto();
      Object.assign(responseDto, user);
      return {
        message: 'Phone number is already up to date',
        data: responseDto,
        state: true,
        statusCode: 200,
      };
    }

    const owner = await this.userRepository.findOne({
      where: { phone_number: phoneNumber },
    });
    if (owner && owner.id !== id) {
      throw new AppError(
        new ConflictException(
          'This phone number is already linked to another account.',
        ),
      );
    }

    const result = await this.update(id, {
      phone_number: phoneNumber,
      is_phone_verified: true,
    });
    return { ...result, message: 'Phone number updated successfully' };
  }

  async remove(id: string, deletedById?: string, manager?: EntityManager) {
    try {
      const run = <T>(work: (em: EntityManager) => Promise<T>) =>
        manager ? work(manager) : this.dataSource.transaction(work);

      const { user, deletedUser, imageIds } = await run(
        async (entityManager) => {
          const user = await entityManager.findOne(UserEntity, {
            where: { id, is_deleted: false },
          });
          if (!user) {
            throw new NotFoundException(`User with ID ${id} not found`);
          }

          // UserEntity tracks deletion with its own columns (there is no
          // @DeleteDateColumn, so repository.softDelete would throw).
          //
          // email, phone_number and firebase_uid are unique and are how Firebase
          // sign-in finds an account, so they are released: signing in again
          // with the same Google account or phone creates a fresh account
          // instead of landing in this deleted one, and nobody is locked out of
          // re-registering. Deactivating blocks password login.
          await entityManager.update(UserEntity, id, {
            is_deleted: true,
            deleted_at: new Date(),
            is_active: false,
            email: null,
            phone_number: null as unknown as string,
            firebase_uid: null,
            fcm_token: null as unknown as string,
            cloudinary_avatar_public_id: null as unknown as string,
            cloudinary_avatar_url: null as unknown as string,
            ...(deletedById && { deleted_by: { id: deletedById } }),
          });

          // End live sessions so existing access and refresh tokens stop working.
          await entityManager.update(
            UserSessionEntity,
            { user: { id }, is_active: true },
            { is_active: false },
          );

          // Take down the user's listings, and their images, so nobody requests
          // items from a deleted account.
          const images = await entityManager
            .createQueryBuilder(ItemImageEntity, 'image')
            .innerJoin('image.item', 'item')
            .where('item.user_id = :id AND item.is_deleted = false', { id })
            .andWhere('image.is_deleted = false')
            .getMany();
          if (images.length) {
            await entityManager.update(
              ItemImageEntity,
              images.map((image) => image.id),
              { is_deleted: true, deleted_at: new Date() },
            );
          }
          await entityManager.update(
            ItemEntity,
            { user_id: id, is_deleted: false },
            {
              is_deleted: true,
              deleted_at: new Date(),
              deleted_by: deletedById ?? id,
              deletion_reason: 'Owner account deleted',
              status: ItemStatus.UNAVAILABLE,
            },
          );

          await closeActiveRequests(
            entityManager,
            { userId: id },
            deletedById ?? id,
            'Account was deleted',
          );

          const deletedUser = await entityManager.findOne(UserEntity, {
            where: { id },
          });
          return {
            user,
            deletedUser,
            imageIds: images
              .map((image) => image.cloudinary_public_id)
              .filter(isItemImagePublicId),
          };
        },
      );

      // After the commit, so a rollback never strands rows pointing at deleted
      // assets. With a caller-supplied manager the commit is the caller's, so
      // the files are left for it to handle.
      if (!manager) {
        await this.cloudinaryService.deleteImagesQuietly([
          ...imageIds,
          user.cloudinary_avatar_public_id,
        ]);
      }

      // Invalidate cache
      await this.cacheManager.del(`user:id:${id}`);
      if (user.email) {
        await this.cacheManager.del(`user:email:${user.email}`);
      }
      if (user.firebase_uid) {
        await this.cacheManager.del(`user:firebase_uid:${user.firebase_uid}`);
      }

      const responseDto = new UserResponseDto();
      Object.assign(responseDto, deletedUser);
      return {
        message: 'User deleted successfully',
        data: responseDto,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error deleting user ${id}: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }
}
