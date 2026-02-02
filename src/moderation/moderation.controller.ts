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
  @ApiOperation({ summary: 'Resolve item report (admin)' })
  resolveItemReport(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @GetUser('id') userId: string,
  ) {
    return this.moderationService.resolveItemReport(id, dto, userId);
  }

  @Patch('users/report/:id/resolve')
  @ApiOperation({ summary: 'Resolve user report (admin)' })
  resolveUserReport(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @GetUser('id') userId: string,
  ) {
    return this.moderationService.resolveUserReport(id, dto, userId);
  }

  @Get('items/reports')
  @ApiOperation({ summary: 'Get item reports (admin)' })
  getItemReports(@Query('status') status?: string) {
    return this.moderationService.getItemReports(status);
  }

  @Get('users/reports')
  @ApiOperation({ summary: 'Get user reports (admin)' })
  getUserReports(@Query('status') status?: string) {
    return this.moderationService.getUserReports(status);
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
  @ApiOperation({ summary: 'Get all complaints (admin)' })
  getComplaints(@Query('status') status?: string) {
    return this.moderationService.getComplaints(status);
  }

  @Get('complaints/my')
  @AllowSuspended()
  @ApiOperation({ summary: 'Get my complaints' })
  getMyComplaints(@GetUser('id') userId: string) {
    return this.moderationService.getUserComplaints(userId);
  }

  @Patch('complaints/:id/resolve')
  @ApiOperation({ summary: 'Resolve complaint (admin)' })
  resolveComplaint(
    @Param('id') id: string,
    @Body() dto: ResolveComplaintDto,
    @GetUser('id') userId: string,
  ) {
    return this.moderationService.resolveComplaint(id, dto, userId);
  }
}
