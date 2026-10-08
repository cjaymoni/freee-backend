import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
  OmitType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppError } from '../common/app-error';
import { GetUser } from '../common/decorators/get-user.decorator';
import { PaginationDto } from '../common/pagination.dto';
import { toBoolean } from '../common/to-boolean';
import { StaffInboxService } from '../notification/staff-inbox.service';
import { STAFF_ROLES } from '../user/entities/user.entity';

export class InboxQueryDto extends OmitType(PaginationDto, [
  'sortBy',
  'order',
] as const) {
  @ApiPropertyOptional({ description: 'Only entries not read yet' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unread?: boolean;
}

/**
 * The signed-in staff member's own inbox: reports, support messages and
 * listings that need staff, and things that happened to their account.
 * Separate from /admin/notifications, which is what staff send to users.
 */
@ApiTags('Admin - My notifications')
@ApiBearerAuth()
@Controller('admin/me/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class AdminInboxController {
  constructor(private readonly inbox: StaffInboxService) {}

  @Get()
  @ApiOperation({ summary: 'My back office notifications, newest first' })
  async list(@GetUser('userId') userId: string, @Query() query: InboxQueryDto) {
    const { page = 1, limit = 20, unread } = query;
    const result = await this.inbox.list(userId, { unread, page, limit });
    return {
      message: 'Notifications retrieved successfully',
      data: result.rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        created_at: n.created_at,
        read_at: n.read_at,
      })),
      total: result.total,
      unread_count: result.unread,
      page,
      limit,
      state: true,
      statusCode: 200,
    };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many of my notifications are unread' })
  async unreadCount(@GetUser('userId') userId: string) {
    return {
      message: 'Unread count',
      data: { count: await this.inbox.unreadCount(userId) },
      state: true,
      statusCode: 200,
    };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all my notifications read' })
  async markAllRead(@GetUser('userId') userId: string) {
    const count = await this.inbox.markAllRead(userId);
    return {
      message: `${count} marked read`,
      data: { count },
      state: true,
      statusCode: 200,
    };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one of my notifications read' })
  async markRead(
    @GetUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // Someone else's entry looks the same as a missing one.
    if (!(await this.inbox.markRead(userId, id))) {
      throw new AppError(new NotFoundException('Notification not found'));
    }
    return { message: 'Marked read', data: null, state: true, statusCode: 200 };
  }
}
