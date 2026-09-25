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
  ForbiddenException,
  BadRequestException,
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
import { UpdatePhoneNumberDto } from './dto/update-phone-number.dto';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { STAFF_ROLES, UserRole, isStaff } from './entities/user.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import { AppError } from '../common/app-error';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { avatarUploadOptions } from './avatar-upload.options';

/**
 * The only fields a user may set on their own record via PATCH /user/:id.
 * Anything else (role, verification flags, firebase_uid, deletion and lockout
 * state, timestamps, avatar public id, ...) is dropped and reported in
 * `warnings` rather than rejected, so existing clients that echo the whole
 * profile back keep working. `password` is handled separately below.
 */
const SELF_EDITABLE_FIELDS = new Set<string>([
  'first_name',
  'last_name',
  'email',
  'phone_number',
  'date_of_birth',
  'gender',
  'bio',
  'cloudinary_avatar_url',
  'fcm_token',
  'notification_enabled',
]);

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
  @UseInterceptors(FileInterceptor('file', avatarUploadOptions))
  async create(
    @GetUser('userId') userId: string,
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
      markOnboardedOnCreate: true,
      actingUserId: userId,
    });
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all users (staff only)' })
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
  @ApiOperation({
    summary: 'Get a user by ID',
    description:
      'Users may only fetch their own profile. Staff may fetch any user.',
  })
  @ApiResponse({
    status: 200,
    description: 'User found successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - non-admins may only view their own profile',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
    type: ErrorResponseDto,
  })
  findOne(
    @Param('id') id: string,
    @GetUser('userId') requesterId: string,
    @GetUser('role') requesterRole: UserRole,
  ) {
    // This record carries full PII (email, phone_number, date_of_birth) as well
    // as fcm_token and account-security state, so it is limited to the owner
    // and to staff.
    if (id !== requesterId && !isStaff(requesterRole)) {
      throw new AppError(
        new ForbiddenException('You can only view your own profile'),
      );
    }

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
  @UseInterceptors(FileInterceptor('file', avatarUploadOptions))
  async uploadAvatar(
    @GetUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    if (!file) {
      throw new BadRequestException('An image file is required in "file"');
    }
    const previous = await this.userService.findOneEntity(userId);
    const upload = await this.cloudinaryService.uploadAvatar(file, userId);
    const previousId = previous?.cloudinary_avatar_public_id;
    let result: ServiceResponseDto<UserResponseDto>;
    try {
      result = await this.userService.update(userId, {
        cloudinary_avatar_public_id: upload.publicId,
        cloudinary_avatar_url: upload.secureUrl,
      });
    } catch (error) {
      // Don't leak the new upload, unless it overwrote the avatar the user
      // still references.
      if (previousId !== upload.publicId) {
        await this.cloudinaryService.deleteImagesQuietly([upload.publicId]);
      }
      throw error;
    }

    // uploadAvatar overwrites avatars/user_<id> in place, but an avatar set
    // during onboarding (POST /user) lives under a different id and would
    // otherwise be orphaned.
    if (previousId && previousId !== upload.publicId) {
      await this.cloudinaryService.deleteImagesQuietly([previousId]);
    }
    return result;
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

  @Post('phone-number')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update phone number from a verified Firebase ID token',
    description:
      'Call after changing the phone number in Firebase, with a refreshed ' +
      'Firebase ID token. The number is taken from the verified token, not ' +
      'from the request, and is saved as verified in one step. The token ' +
      "must belong to the signed-in user's Firebase account. On any error the " +
      'existing phone number is left unchanged.',
  })
  @ApiResponse({
    status: 200,
    description: 'Phone number updated',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'The Firebase account has no verified phone number',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Firebase ID token is invalid or expired',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'The token belongs to a different Firebase account',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'The phone number is linked to another account',
    type: ErrorResponseDto,
  })
  async updatePhoneNumber(
    @GetUser('userId') userId: string,
    @Body() dto: UpdatePhoneNumberDto,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    return this.userService.updatePhoneFromFirebase(userId, dto.idToken);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a user by ID',
    description:
      'Used across multiple onboarding steps:\n' +
      '- **Screen 4** — Set name: `{ first_name, last_name }`\n' +
      '- **Screen 5** — Set date of birth: `{ date_of_birth }`\n' +
      '- **Screen 6** — Set gender: `{ gender }`\n\n' +
      'Non-admins may only update their own record. `role`, `is_active`, the ' +
      'verification flags and `firebase_uid` are admin-only: when a user sends ' +
      'them they are ignored and listed in `warnings`. Admins cannot set `role` ' +
      'or `is_active` here (400); use the /admin/users endpoints. Changing `email` or ' +
      '`phone_number` clears the matching verification flag.',
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
  @ApiResponse({
    status: 403,
    description: 'Forbidden - non-admins may only update their own profile',
    type: ErrorResponseDto,
  })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @GetUser('userId') requesterId: string,
    @GetUser('role') requesterRole: UserRole,
  ) {
    if (requesterRole !== UserRole.ADMIN) {
      if (id !== requesterId) {
        throw new AppError(
          new ForbiddenException('You can only update your own profile'),
        );
      }
      const allowed: UpdateUserDto = {};
      const ignored: string[] = [];
      for (const [key, value] of Object.entries(updateUserDto)) {
        if (value === undefined || key === 'password') continue;
        if (SELF_EDITABLE_FIELDS.has(key)) {
          (allowed as Record<string, unknown>)[key] = value;
        } else {
          ignored.push(key);
        }
      }

      const warnings: string[] = [];
      if (updateUserDto.password !== undefined) {
        // Replacing a password must prove the current one, which only
        // /auth/change-password does. Setting a first one is fine here.
        const current = await this.userService.findOneEntityWithPassword(id);
        if (current?.password_hash) {
          warnings.push(
            'password was ignored; use /auth/change-password to change it',
          );
        } else if (updateUserDto.password.length < 6) {
          throw new AppError(
            new BadRequestException('password must be at least 6 characters'),
          );
        } else {
          allowed.password = updateUserDto.password;
        }
      }
      if (ignored.length) {
        warnings.push(
          `These fields can't be changed here and were ignored: ${ignored.join(', ')}`,
        );
      }

      const result = await this.userService.update(id, allowed);
      if (warnings.length) {
        result.warnings = warnings;
      }
      return result;
    }

    // A role change must end the user's sessions (the role travels in the
    // access token) and be audited, which only the admin endpoint does.
    if (updateUserDto.role !== undefined) {
      throw new AppError(
        new BadRequestException(
          'Change roles with PATCH /admin/users/:id/role',
        ),
      );
    }
    // Suspending and reinstating record a reason and who did it, and lifting
    // a ban is admin only; the admin endpoints check all of that.
    if (updateUserDto.is_active !== undefined) {
      throw new AppError(
        new BadRequestException(
          'Suspend or reinstate with POST /admin/users/:id/suspend or /reinstate',
        ),
      );
    }

    return this.userService.update(id, updateUserDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a user by ID',
    description:
      'Users may only delete their own account. Admins may delete any user.',
  })
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
  @ApiResponse({
    status: 403,
    description: 'Forbidden - non-admins may only delete their own account',
    type: ErrorResponseDto,
  })
  remove(
    @Param('id') id: string,
    @GetUser('userId') requesterId: string,
    @GetUser('role') requesterRole: UserRole,
  ) {
    if (id !== requesterId && requesterRole !== UserRole.ADMIN) {
      throw new AppError(
        new ForbiddenException('You can only delete your own account'),
      );
    }
    return this.userService.remove(id, requesterId);
  }
}
