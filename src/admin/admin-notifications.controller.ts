import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { UserRole } from '../user/entities/user.entity';
import { AdminNotificationsService } from './admin-notifications.service';
import {
  NotificationAudienceDto,
  NotificationHistoryQueryDto,
  SendNotificationDto,
} from './dto/send-notification.dto';

/** Announcements to users by push and email. Admin only. */
@ApiTags('Admin - Notifications')
@ApiBearerAuth()
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminNotificationsController {
  constructor(private readonly service: AdminNotificationsService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Notifications sent from the back office (admin)' })
  list(@Query() query: NotificationHistoryQueryDto) {
    return this.service.list(query);
  }

  @Get('audience')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'How many users an audience would reach (admin)',
  })
  countAudience(@Query() query: NotificationAudienceDto) {
    return this.service.countAudience(query);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send an announcement (admin)',
    description:
      'Answers once the send is recorded; delivery runs in the background and its counts update on the history row. Users who turned off announcements, push or email are skipped.',
  })
  @ApiResponse({
    status: 400,
    description: 'No users match the audience',
    type: ErrorResponseDto,
  })
  send(
    @Body() dto: SendNotificationDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    return this.service.send({ userId, role }, dto, request);
  }
}
