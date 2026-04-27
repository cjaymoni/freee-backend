import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
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
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { UserEntity } from './entities/user.entity';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { CategoryEntity } from '../category/entities/category.entity';
import { UserResponseDto } from './dto/user-response.dto';
import { ServiceResponseDto } from 'src/common/service-response.dto';
import * as bcrypt from 'bcrypt';
import { FindUserDto } from './dto/find-user.dto';
import { AppError } from 'src/common/app-error';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { Express } from 'express';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly cloudinaryService: CloudinaryService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly dataSource: DataSource,
  ) {}

  private readonly logger = new Logger(UserService.name);

  async findByEmail(email: string): Promise<UserEntity | null> {
    const cacheKey = `user:email:${email}`;
    const cachedUser = await this.cacheManager.get<UserEntity>(cacheKey);
    if (cachedUser) {
      this.logger.log(`Cache hit for user email: ${email}`);
      return cachedUser;
    }

    const user = await this.userRepository.findOne({ where: { email } });
    if (user) {
      await this.cacheManager.set(cacheKey, user, 3600); // Cache for 1 hour
    }
    return user;
  }

  async findByFirebaseUid(firebaseUid: string): Promise<UserEntity | null> {
    const cacheKey = `user:firebase_uid:${firebaseUid}`;
    const cachedUser = await this.cacheManager.get<UserEntity>(cacheKey);
    if (cachedUser) {
      this.logger.log(`Cache hit for user firebase_uid: ${firebaseUid}`);
      return cachedUser;
    }

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
    file?: Express.Multer.File,
    options: {
      is_active?: boolean;
      is_email_verified?: boolean;
      is_phone_verified?: boolean;
    } = {},
    manager?: EntityManager,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    const queryRunner = !manager ? this.dataSource.createQueryRunner() : null;
    if (queryRunner) {
      await queryRunner.connect();
      await queryRunner.startTransaction();
    }
    const entityManager = manager || queryRunner!.manager;

    try {
      this.logger.log(`Creating user${createUserDto.email ? ` with email: ${createUserDto.email}` : ` (no email)`}`);

      // Internal safety check: ensure firebase_uid/email/phone is unique
      if (createUserDto.firebase_uid) {
        const existingFirebaseUser = await this.findByFirebaseUid(createUserDto.firebase_uid);
        if (existingFirebaseUser) {
          throw new ConflictException('User already exists');
        }
      }

      const existingUser = await this.findByEmailOrPhone(
        createUserDto.email,
        createUserDto.phone_number,
      );

      if (existingUser) {
        // Skip conflict if it's the same firebase user (retry scenario)
        const isSameFirebaseUser =
          createUserDto.firebase_uid &&
          existingUser.firebase_uid === createUserDto.firebase_uid;

        if (!isSameFirebaseUser) {
          if (createUserDto.email && existingUser.email === createUserDto.email) {
            throw new ConflictException('Email already exists');
          }
          if (
            createUserDto.phone_number &&
            existingUser.phone_number === createUserDto.phone_number
          ) {
            throw new ConflictException('Phone number already exists');
          }
        }
      }

      // Hash password
      let hashedPassword = '';
      if (createUserDto.password) {
        const saltRounds = 12;
        hashedPassword = await bcrypt.hash(createUserDto.password, saltRounds);
      }

      // Handle Avatar
      let avatarData: { cloudinary_avatar_public_id?: string; cloudinary_avatar_url?: string } = {};
      if (file) {
        const uploadResult = await this.cloudinaryService.uploadImage(file, {
          folder: 'users',
        });
        avatarData = {
          cloudinary_avatar_public_id: uploadResult.publicId,
          cloudinary_avatar_url: uploadResult.secureUrl,
        };
      } else {
        // Auto-generate a DiceBear avatar; seed will be replaced with the real user id after save
        avatarData = {
          cloudinary_avatar_url: `https://api.dicebear.com/9.x/adventurer/svg?seed=temp`,
        };
      }

      const userData = { ...createUserDto } as Record<string, any>;
      delete userData.password;
      const user = entityManager.create(UserEntity, {
        ...userData,
        ...avatarData,
        email: createUserDto.email || null,
        firebase_uid: createUserDto.firebase_uid || null,
        password_hash: createUserDto.password ? hashedPassword : undefined,
        is_email_verified: options.is_email_verified ?? false,
        is_phone_verified: options.is_phone_verified ?? false,
        is_active: options.is_active ?? true,
        notification_enabled: true,
        failed_login_attempts: 0,
        member_since: new Date(),
      });

      const result = await entityManager.save(UserEntity, user);

      // Replace temp seed with the real user id for a stable, unique avatar
      if (!file) {
        await entityManager.update(UserEntity, result.id, {
          cloudinary_avatar_url: `https://api.dicebear.com/9.x/adventurer/svg?seed=${result.id}`,
        });
        result.cloudinary_avatar_url = `https://api.dicebear.com/9.x/adventurer/svg?seed=${result.id}`;
      }

      // Create user preference with selected categories
      const preference = entityManager.create(UserPreferenceEntity, {
        user_id: result.id,
        preferred_categories: createUserDto.category_ids?.length
          ? await entityManager.findByIds(CategoryEntity, createUserDto.category_ids)
          : [],
      });
      await entityManager.save(UserPreferenceEntity, preference);

      if (queryRunner) {
        await queryRunner.commitTransaction();
      }

      this.logger.log(`User record persisted with ID: ${result.id}`);

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
      throw error;
    } finally {
      if (queryRunner) {
        await queryRunner.release();
      }
    }
  }

  async findAll(
    findUserDto: FindUserDto,
  ): Promise<ServiceResponseDto<UserResponseDto[]>> {
    try {
      const { page = 1, limit = 20, ...query } = findUserDto;

      const where = { ...query } as unknown as FindOptionsWhere<UserEntity>;

      if (query.date_of_birth) {
        where.date_of_birth = new Date(query.date_of_birth);
      }

      const [users] = await this.userRepository.findAndCount({
        where,
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
      this.logger.log(`Finding user with ID: ${id}`);
      const cacheKey = `user:id:${id}`;
      const cachedUser = await this.cacheManager.get<UserEntity>(cacheKey);

      let user: UserEntity | null = null;
      if (cachedUser) {
        this.logger.log(`Cache hit for user ID: ${id}`);
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
  ) {
    try {
      this.logger.log(`Updating user with ID: ${id}`);
      const entityManager = manager || this.userRepository.manager;
      const user = await entityManager.findOne(UserEntity, { where: { id } });
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      const { password, ...otherData } = updateUserDto;
      const updateData = {
        ...(otherData as any),
      } as QueryDeepPartialEntity<UserEntity>;

      if (password) {
        const saltRounds = 12;
        updateData.password_hash = await bcrypt.hash(password, saltRounds);
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
      throw new AppError(error);
    }
  }

  async remove(id: string, manager?: EntityManager) {
    try {
      this.logger.log(`Deleting user with ID: ${id}`);
      const entityManager = manager || this.userRepository.manager;
      const user = await entityManager.findOne(UserEntity, { where: { id } });
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      const deletedUser = await entityManager.softDelete(UserEntity, id);

      // Invalidate cache
      await this.cacheManager.del(`user:id:${id}`);
      if (user.email) {
        await this.cacheManager.del(`user:email:${user.email}`);
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
