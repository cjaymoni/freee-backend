import { BadRequestException, ConflictException, HttpException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';
import { UserResponseDto } from './dto/user-response.dto';
import { ServiceResponseDto } from 'src/common/service-response.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}
  
 async create(createUserDto: CreateUserDto): Promise<ServiceResponseDto<UserResponseDto>> {
    try {
      // Check if user exists by email OR phone number
      const existingUser = await this.userRepository.findOne({
        where: [
          { email: createUserDto.email },
          { phone_number: createUserDto.phone_number }
        ],
      });

      if (existingUser) {
        if (existingUser.email === createUserDto.email) {
          throw new ConflictException('Email already exists');
        }
        if (existingUser.phone_number === createUserDto.phone_number) {
          throw new ConflictException('Phone number already exists');
        }
      }

      // Hash password before saving
      const saltRounds = 12; // bcrypt rounds (as per your schema notes)
      const hashedPassword = await bcrypt.hash(createUserDto.password_hash!, saltRounds);

      // Create new user with hashed password
      const user = this.userRepository.create({
        ...createUserDto,
        password_hash: hashedPassword,
        // Set default values
        is_verified: false,
        is_active: true,
        notification_enabled: true,
        failed_login_attempts: 0,
        member_since: new Date(),
      });

      // Don't include password in DTO
      // delete user.password_hash; // Remove plain password if it exists

      const result = await this.userRepository.save(user);

      // Map to response DTO (exclude sensitive fields)
      const responseDto = new UserResponseDto();
      Object.assign(responseDto,result);

      return {
        message: 'User created successfully',
        data: responseDto,
        state: true,
        statusCode: 201,
      };

    } catch (error) {
      // Handle known exceptions
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }

      // Log the error for debugging
      console.error('Error creating user:', error);

      // Throw generic error to client
      throw new InternalServerErrorException('Failed to create user. Please try again later.');
    }
  }


  findAll() {
    return `This action returns all user`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
