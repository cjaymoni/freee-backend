import {
  BadRequestException,
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

  async findByEmailOrPhone(
    email: string,
    phoneNumber?: string,
  ): Promise<UserEntity | null> {
    const whereConditions: FindOptionsWhere<UserEntity>[] = [{ email }];
    if (phoneNumber) {
      whereConditions.push({ phone_number: phoneNumber });
    }

    return this.userRepository.findOne({
      where: whereConditions,
    });
  }

  async create(
    createUserDto: CreateUserDto,
    file?: Express.Multer.File,
    options: { is_active?: boolean; is_verified?: boolean } = {},
    manager?: EntityManager,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    const queryRunner = !manager ? this.dataSource.createQueryRunner() : null;
    if (queryRunner) {
      await queryRunner.connect();
      await queryRunner.startTransaction();
    }
    const entityManager = manager || queryRunner!.manager;

    try {
      if (!createUserDto.email || !createUserDto.password) {
        throw new BadRequestException('Email and password are required');
      }
      this.logger.log(`Creating user with email: ${createUserDto.email}`);

      // Internal safety check: ensure email/phone is unique
      const existingUser = await this.findByEmailOrPhone(
        createUserDto.email,
        createUserDto.phone_number,
      );

      if (existingUser) {
        if (existingUser.email === createUserDto.email) {
          throw new ConflictException('Email already exists');
        }
        if (
          createUserDto.phone_number &&
          existingUser.phone_number === createUserDto.phone_number
        ) {
          throw new ConflictException('Phone number already exists');
        }
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(
        createUserDto.password,
        saltRounds,
      );

      // Handle Avatar
      let avatarData = {};
      if (file) {
        const uploadResult = await this.cloudinaryService.uploadImage(file, {
          folder: 'users',
        });
        avatarData = {
          cloudinary_avatar_public_id: uploadResult.publicId,
          cloudinary_avatar_url: uploadResult.secureUrl,
        };
      }

      const userData = { ...createUserDto } as Record<string, any>;
      delete userData.password;
      const user = entityManager.create(UserEntity, {
        ...userData,
        ...avatarData,
        password_hash: hashedPassword,
        is_verified: options.is_verified ?? false,
        is_active: options.is_active ?? true,
        notification_enabled: true,
        failed_login_attempts: 0,
        member_since: new Date(),
      });

      const result = await entityManager.save(UserEntity, user);

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
      const { page, limit, search, ...query } = findUserDto;
      void search; // Suppress unused variable warning

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
