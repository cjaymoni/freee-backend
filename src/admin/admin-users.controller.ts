import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { STAFF_ROLES, UserRole } from '../user/entities/user.entity';
import { AdminUsersService } from './admin-users.service';
import { ChangeRoleDto } from './dto/change-role.dto';
import {
  AdminUserQueryDto,
  AdminUserRequestsQueryDto,
} from './dto/admin-query.dto';
import {
  OptionalReasonDto,
  ReasonDto,
  SuspendUserDto,
} from './dto/moderation-action.dto';

@ApiTags('Admin - Users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Search and filter users (staff)' })
  list(@Query() query: AdminUserQueryDto) {
    return this.adminUsersService.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'A user with their listing, request and report counts (staff)',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.detail(id);
  }

  @Get(':id/requests')
  @ApiOperation({ summary: 'Requests the user made or received (staff)' })
  requests(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AdminUserRequestsQueryDto,
  ) {
    return this.adminUsersService.listRequests(id, query);
  }

  @Get(':id/reports')
  @ApiOperation({
    summary: 'Reports against the user and their listings (staff)',
  })
  reports(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.listReports(id);
  }

  @Get(':id/activity')
  @ApiOperation({
    summary: "The user's activity and changes to their account (staff)",
  })
  activity(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.activity(id);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspend a user (staff)',
    description:
      'Blocks everything but the complaint endpoints, so the user can appeal. With `until`, the suspension lifts itself. Staff accounts cannot be suspended.',
  })
  @ApiResponse({
    status: 409,
    description: 'Account is banned',
    type: ErrorResponseDto,
  })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendUserDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    return this.adminUsersService.suspend(
      { userId, role },
      id,
      dto.reason,
      dto.until,
      request,
    );
  }

  @Post(':id/ban')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Permanently ban a user (admin only)',
    description:
      'Ends every session and revokes Firebase tokens. Banned accounts reach nothing, complaints included.',
  })
  ban(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    return this.adminUsersService.ban(
      { userId, role },
      id,
      dto.reason,
      request,
    );
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lift a suspension (staff) or a ban (admin only)',
  })
  reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalReasonDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    return this.adminUsersService.reinstate(
      { userId, role },
      id,
      dto.reason,
      request,
    );
  }

  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Change a user's role (admin only)",
    description:
      'Ends all of the user’s sessions so their next token carries the new role. Admins cannot change their own role.',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({
    status: 400,
    description: 'User already has this role',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Not an admin, or changing your own role',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ErrorResponseDto,
  })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    return this.adminUsersService.changeRole(
      { userId, role },
      id,
      dto.role,
      dto.reason,
      request,
    );
  }
}
