import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ServiceResponseDto } from 'src/common/service-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserEntity } from './entities/user.entity';
import { CreateUserResponseDto } from './dto/create-user-response.dto';
import { FindUserDto } from './dto/find-user.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from './entities/user.entity';
import { GetUser } from '../common/decorators/get-user.decorator';

@ApiTags('user')
@ApiBearerAuth()
@ApiExtraModels(
  ServiceResponseDto,
  UserResponseDto,
  UserEntity,
  CreateUserResponseDto,
  FindUserDto,
  ErrorResponseDto,
)
@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiCreatedResponse({
    description: 'User created successfully',
    type: CreateUserResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'User already exists',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
    type: ErrorResponseDto,
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async create(
    @Body() createUserDto: CreateUserDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    return this.userService.create(createUserDto, file);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all users (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Users found successfully',
    type: [UserResponseDto],
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Requires admin role',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
    type: ErrorResponseDto,
  })
  findAll(
    @Query() findUserDto: FindUserDto,
  ): Promise<ServiceResponseDto<UserResponseDto[]>> {
    return this.userService.findAll(findUserDto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({
    status: 200,
    description: 'User found successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
    type: ErrorResponseDto,
  })
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a user by ID' })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
    type: ErrorResponseDto,
  })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(id, updateUserDto);
  }

  @Patch('fcm-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update FCM token for push notifications' })
  @ApiResponse({
    status: 200,
    description: 'FCM token updated successfully',
  })
  async updateFcmToken(
    @GetUser('userId') userId: string,
    @Body() fcmTokenDto: UpdateFcmTokenDto,
  ) {
    return this.userService.update(userId, fcmTokenDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a user by ID' })
  @ApiResponse({
    status: 200,
    description: 'User deleted successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
    type: ErrorResponseDto,
  })
  remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }
}
