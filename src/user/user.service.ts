import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Repository, FindOptionsWhere } from 'typeorm';
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
  ) {}

  private readonly logger = new Logger(UserService.name);

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async create(
    createUserDto: CreateUserDto,
    file?: Express.Multer.File,
    options: { is_active?: boolean; is_verified?: boolean } = {},
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    try {
      this.logger.log(`Creating user with email: ${createUserDto.email}`);

      // Check if user exists by email OR phone number
      const whereConditions: FindOptionsWhere<UserEntity>[] = [
        { email: createUserDto.email },
      ];
      if (createUserDto.phone_number) {
        whereConditions.push({ phone_number: createUserDto.phone_number });
      }

      // Check if user exists by email OR phone number
      const existingUser = await this.userRepository.findOne({
        where: whereConditions,
      });

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

      // Hash password before saving
      const saltRounds = 12; // bcrypt rounds (as per your schema notes)
      const hashedPassword = await bcrypt.hash(
        createUserDto.password_hash!,
        saltRounds,
      );

      let avatarData = {};
      if (file) {
        const uploadResult = await this.cloudinaryService.uploadImage(file, {
          folder: 'users',
        });
        this.logger.log(
          `Avatar uploaded to Cloudinary: ${uploadResult.secureUrl}`,
        );
        avatarData = {
          cloudinary_avatar_public_id: uploadResult.publicId,
          cloudinary_avatar_url: uploadResult.secureUrl,
        };
      }

      // Create new user with hashed password
      const user = this.userRepository.create({
        ...createUserDto,
        ...avatarData,
        password_hash: hashedPassword,
        // Set default values
        is_verified: options.is_verified ?? false,
        is_active: options.is_active ?? true,
        notification_enabled: true,
        failed_login_attempts: 0,
        member_since: new Date(),
      });

      // Don't include password in DTO
      // delete user.password_hash; // Remove plain password if it exists

      const result = await this.userRepository.save(user);
      this.logger.log(`User created successfully with ID: ${result.id}`);

      // Map to response DTO (exclude sensitive fields)
      const responseDto = new UserResponseDto();
      Object.assign(responseDto, result);

      return {
        message: 'User created successfully',
        data: responseDto,
        state: true,
        statusCode: 201,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Error creating user: ${error.message}`, error.stack);
      }
      throw new AppError(error);
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
      const user = await this.userRepository.findOne({ where: { id } });
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

  async update(id: string, updateUserDto: UpdateUserDto) {
    try {
      this.logger.log(`Updating user with ID: ${id}`);
      const user = await this.userRepository.findOne({ where: { id } });
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      if (updateUserDto.password_hash) {
        const saltRounds = 12;
        updateUserDto.password_hash = await bcrypt.hash(
          updateUserDto.password_hash,
          saltRounds,
        );
      }
      const updatedUser = await this.userRepository.update(id, updateUserDto);
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

  async remove(id: string) {
    try {
      this.logger.log(`Deleting user with ID: ${id}`);
      const user = await this.userRepository.findOne({ where: { id } });
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      const deletedUser = await this.userRepository.softDelete(id);
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
