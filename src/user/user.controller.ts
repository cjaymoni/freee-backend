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
  ApiBody,
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
import { CloudinaryService } from '../cloudinary/cloudinary.service';

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
  constructor(
    private readonly userService: UserService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

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
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', example: 'John' },
        last_name: { type: 'string', example: 'Doe' },
        email: { type: 'string', example: 'user@example.com' },
        phone_number: { type: 'string', example: '+233243225121' },
        password: { type: 'string', example: 'password123' },
        gender: { type: 'string', example: 'Male' },
        bio: { type: 'string', example: 'A short bio' },
        date_of_birth: { type: 'string', example: '2000-01-01' },
        firebase_uid: { type: 'string', example: 'firebase-uid-123' },
        category_ids: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          example: ['123e4567-e89b-12d3-a456-426614174000'],
          description: 'Preferred category IDs selected by the user',
        },
        file: {
          type: 'string',
          format: 'binary',
          description: 'Profile avatar image',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async create(
    @Body() createUserDto: CreateUserDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    if (
      createUserDto.category_ids &&
      !Array.isArray(createUserDto.category_ids)
    ) {
      createUserDto.category_ids = [createUserDto.category_ids];
    }
    return this.userService.create(createUserDto, file, {
      source: 'user.controller.create',
      upsertOnConflict: true,
    });
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

  @Patch('avatar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upload or update user avatar',
    description:
      '**Screen 7** — Upload a profile picture during onboarding.\n\n' +
      'Uploads to Cloudinary (500x500, face crop) and updates `cloudinary_avatar_url` on the user.\n\n' +
      'If the user skips this screen, the auto-generated DiceBear avatar remains.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Avatar updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'No file provided',
    type: ErrorResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @GetUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    const upload = await this.cloudinaryService.uploadAvatar(file, userId);
    return this.userService.update(userId, {
      cloudinary_avatar_public_id: upload.publicId,
      cloudinary_avatar_url: upload.secureUrl,
    });
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a user by ID',
    description:
      'Used across multiple onboarding steps:\n' +
      '- **Screen 4** — Set name: `{ first_name, last_name }`\n' +
      '- **Screen 5** — Set date of birth: `{ date_of_birth }`\n' +
      '- **Screen 6** — Set gender: `{ gender }`',
  })
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
