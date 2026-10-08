import {
  Body,
  Controller,
  Delete,
  Get,
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
  ApiTags,
  OmitType,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  announcementState,
  AnnouncementService,
} from '../announcement/announcement.service';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from '../announcement/dto/announcement.dto';
import { AnnouncementEntity } from '../announcement/entities/announcement.entity';
import { AuditEntityType } from '../audit/audit.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { PaginationDto } from '../common/pagination.dto';
import { UserRole } from '../user/entities/user.entity';
import { AdminAuditService } from './admin-audit.service';
import { toUserRef } from './admin-views';

class AnnouncementListQueryDto extends OmitType(PaginationDto, [
  'sortBy',
  'order',
] as const) {}

function toAdminAnnouncement(a: AnnouncementEntity) {
  return {
    id: a.id,
    message: a.message,
    level: a.level,
    active_from: a.active_from,
    active_until: a.active_until,
    is_active: a.is_active,
    state: announcementState(a),
    creator: toUserRef(a.creator),
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

const auditFields = (a: AnnouncementEntity) => ({
  message: a.message,
  level: a.level,
  active_from: a.active_from,
  active_until: a.active_until,
  is_active: a.is_active,
});

/** In-app banners: create, schedule, switch off, delete. Admin only. */
@ApiTags('Admin - Announcements')
@ApiBearerAuth()
@Controller('admin/announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminAnnouncementsController {
  constructor(
    private readonly service: AnnouncementService,
    private readonly adminAudit: AdminAuditService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Every banner, newest first (admin)' })
  async list(@Query() query: AnnouncementListQueryDto) {
    const { page = 1, limit = 20 } = query;
    const [rows, total] = await this.service.list(page, limit);
    return {
      message: 'Announcements retrieved successfully',
      data: rows.map(toAdminAnnouncement),
      total,
      page,
      limit,
      state: true,
      statusCode: 200,
    };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a banner (admin)' })
  async create(
    @Body() dto: CreateAnnouncementDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    const row = await this.service.create(dto, userId);
    await this.adminAudit.record({
      actor: { userId, role },
      entityType: AuditEntityType.ANNOUNCEMENTS,
      entityId: row.id,
      action: 'created',
      newValues: auditFields(row),
      request,
    });
    return {
      message: 'Banner created',
      data: toAdminAnnouncement(row),
      state: true,
      statusCode: 201,
    };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Edit, reschedule or switch a banner on/off (admin)',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    const { before, after } = await this.service.update(id, dto);
    await this.adminAudit.record({
      actor: { userId, role },
      entityType: AuditEntityType.ANNOUNCEMENTS,
      entityId: id,
      action: 'updated',
      oldValues: auditFields(before),
      newValues: auditFields(after),
      request,
    });
    return {
      message: 'Banner updated',
      data: toAdminAnnouncement(after),
      state: true,
      statusCode: 200,
    };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a banner (admin)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    const row = await this.service.remove(id);
    await this.adminAudit.record({
      actor: { userId, role },
      entityType: AuditEntityType.ANNOUNCEMENTS,
      entityId: id,
      action: 'deleted',
      oldValues: auditFields(row),
      request,
    });
    return {
      message: 'Banner deleted',
      data: null,
      state: true,
      statusCode: 200,
    };
  }
}
