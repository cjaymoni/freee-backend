import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ModerationService } from './moderation.service';
import { CreateReportedItemDto } from './dto/create-reported-item.dto';
import { CreateReportedUserDto } from './dto/create-reported-user.dto';
import { CreateBlockedUserDto } from './dto/create-blocked-user.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { ResolveComplaintDto } from './dto/resolve-complaint.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActiveUserGuard } from '../auth/guards/active-user.guard';
import { AllowSuspended } from '../auth/decorators/allow-suspended.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { STAFF_ROLES, UserRole, isStaff } from '../user/entities/user.entity';

@ApiTags('Moderation')
@Controller('moderation')
@UseGuards(JwtAuthGuard, ActiveUserGuard)
@ApiBearerAuth()
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post('items/report')
  @ApiOperation({ summary: 'Report an item' })
  reportItem(
    @Body() dto: CreateReportedItemDto,
    @GetUser('id') userId: string,
  ) {
    return this.moderationService.reportItem(dto, userId);
  }

  @Post('users/report')
  @ApiOperation({ summary: 'Report a user' })
  reportUser(
    @Body() dto: CreateReportedUserDto,
    @GetUser('id') userId: string,
  ) {
    return this.moderationService.reportUser(dto, userId);
  }

  @Post('users/block')
  @ApiOperation({ summary: 'Block a user' })
  blockUser(@Body() dto: CreateBlockedUserDto, @GetUser('id') userId: string) {
    return this.moderationService.blockUser(dto, userId);
  }

  @Delete('users/block/:blockedId')
  @ApiOperation({ summary: 'Unblock a user' })
  unblockUser(
    @Param('blockedId') blockedId: string,
    @GetUser('id') userId: string,
  ) {
    return this.moderationService.unblockUser(blockedId, userId);
  }

  @Get('users/blocked')
  @ApiOperation({ summary: 'Get blocked users' })
  getBlockedUsers(@GetUser('id') userId: string) {
    return this.moderationService.getBlockedUsers(userId);
  }

  @Patch('items/report/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @ApiOperation({
    summary: 'Resolve item report (staff)',
    description:
      'Removing the item (item_removed) is admin only. Nobody can review a report they filed.',
  })
  resolveItemReport(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @GetUser('id') userId: string,
    @GetUser('role') role: UserRole,
  ) {
    return this.moderationService.resolveItemReport(id, dto, userId, role);
  }

  @Patch('users/report/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Resolve user report (staff)' })
  resolveUserReport(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @GetUser('id') userId: string,
  ) {
    return this.moderationService.resolveUserReport(id, dto, userId);
  }

  // The list endpoints stay open to regular users (existing clients may use
  // them) but only return that user's own records; staff see everything.
  @Get('items/reports')
  @ApiOperation({
    summary: 'Get item reports',
    description: 'Staff get all reports; other users get the ones they filed.',
  })
  getItemReports(
    @GetUser('id') userId: string,
    @GetUser('role') role: UserRole,
    @Query('status') status?: string,
  ) {
    return this.moderationService.getItemReports(
      status,
      isStaff(role) ? undefined : userId,
    );
  }

  @Get('users/reports')
  @ApiOperation({
    summary: 'Get user reports',
    description: 'Staff get all reports; other users get the ones they filed.',
  })
  getUserReports(
    @GetUser('id') userId: string,
    @GetUser('role') role: UserRole,
    @Query('status') status?: string,
  ) {
    return this.moderationService.getUserReports(
      status,
      isStaff(role) ? undefined : userId,
    );
  }

  @Post('complaints')
  @AllowSuspended()
  @ApiOperation({ summary: 'Lodge a complaint (for suspended users)' })
  createComplaint(
    @Body() dto: CreateComplaintDto,
    @GetUser('id') userId: string,
  ) {
    return this.moderationService.createComplaint(dto, userId);
  }

  @Get('complaints')
  @ApiOperation({
    summary: 'Get complaints',
    description: 'Staff get all complaints; other users get their own.',
  })
  getComplaints(
    @GetUser('id') userId: string,
    @GetUser('role') role: UserRole,
    @Query('status') status?: string,
  ) {
    return this.moderationService.getComplaints(
      status,
      isStaff(role) ? undefined : userId,
    );
  }

  @Get('complaints/my')
  @AllowSuspended()
  @ApiOperation({ summary: 'Get my complaints' })
  getMyComplaints(@GetUser('id') userId: string) {
    return this.moderationService.getUserComplaints(userId);
  }

  @Patch('complaints/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Resolve complaint (staff)' })
  resolveComplaint(
    @Param('id') id: string,
    @Body() dto: ResolveComplaintDto,
    @GetUser('id') userId: string,
  ) {
    return this.moderationService.resolveComplaint(id, dto, userId);
  }
}
