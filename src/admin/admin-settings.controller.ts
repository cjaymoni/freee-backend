import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuditEntityType } from '../audit/audit.constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GetUser } from '../common/decorators/get-user.decorator';
import { PlatformSettingEntity } from '../platform-settings/entities/platform-setting.entity';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { UpdateSettingsDto } from '../platform-settings/dto/update-settings.dto';
import {
  definitionOf,
  GROUP_DESCRIPTIONS,
  GROUP_LABELS,
  SETTING_GROUPS,
  SETTING_KEYS,
  type SettingKey,
  type SettingValues,
} from '../platform-settings/settings.registry';
import { UserRole } from '../user/entities/user.entity';
import { AdminAuditService } from './admin-audit.service';
import { toUserRef } from './admin-views';

/** The id the audit log files settings changes under; there is only one row. */
const SETTINGS_AUDIT_ID = 'platform';

/**
 * The settings grouped the way the back office renders them: definition,
 * current value, and who last moved it off its default.
 */
function toSettingGroups(
  values: SettingValues,
  overrides: Map<string, PlatformSettingEntity>,
) {
  return SETTING_GROUPS.map((group) => ({
    key: group,
    label: GROUP_LABELS[group],
    description: GROUP_DESCRIPTIONS[group],
    settings: SETTING_KEYS.filter(
      (key) => definitionOf(key).group === group,
    ).map((key) => {
      const definition = definitionOf(key);
      const override = overrides.get(key);
      return {
        key,
        label: definition.label,
        description: definition.description,
        type: definition.type,
        value: values[key],
        default: definition.default,
        is_default: values[key] === definition.default,
        ...(definition.type === 'number' && {
          min: definition.min,
          max: definition.max,
          unit: definition.unit,
          zero_means: definition.zeroMeans ?? null,
        }),
        updated_at: override?.updated_at ?? null,
        updated_by: toUserRef(override?.editor),
      };
    }),
  }));
}

/**
 * Files a settings change in the audit log. A free function, not a method:
 * every method on this controller is a route, and a private helper would be
 * picked up as one.
 *
 * Nothing is logged when the submitted values matched what was already in
 * force, so a no-op save does not clutter the log.
 */
async function recordChange(
  adminAudit: AdminAuditService,
  before: SettingValues,
  after: SettingValues,
  action: string,
  actor: { userId: string; role: UserRole },
  request: Request,
): Promise<void> {
  const { old, next } = changedValues(before, after);
  if (Object.keys(next).length === 0) return;
  await adminAudit.record({
    actor,
    entityType: AuditEntityType.PLATFORM_SETTINGS,
    entityId: SETTINGS_AUDIT_ID,
    action,
    oldValues: old,
    newValues: next,
    request,
  });
}

/** What changed, for the audit log: only the keys whose value moved. */
function changedValues(before: SettingValues, after: SettingValues) {
  const old: Record<string, number | boolean> = {};
  const next: Record<string, number | boolean> = {};
  for (const key of SETTING_KEYS) {
    if (before[key] !== after[key]) {
      old[key] = before[key];
      next[key] = after[key];
    }
  }
  return { old, next };
}

/**
 * Platform-wide limits: how many listings and requests a user gets, how hard
 * the API throttles, how sign-in codes behave. Admin only, and every change
 * lands in the audit log.
 */
@ApiTags('Admin - Settings')
@ApiBearerAuth()
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSettingsController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly adminAudit: AdminAuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Every platform setting, its value and its range (admin)',
  })
  async list() {
    const values = this.settings.all();
    const rows = await this.settings.overrides();
    return {
      message: 'Settings retrieved successfully',
      data: {
        groups: toSettingGroups(
          values,
          new Map(rows.map((row) => [row.key, row])),
        ),
      },
      state: true,
      statusCode: 200,
    };
  }

  @Patch()
  @ApiOperation({ summary: 'Change one or more platform settings (admin)' })
  async update(
    @Body() dto: UpdateSettingsDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    const { before, after } = await this.settings.update(
      dto.settings as Partial<Record<SettingKey, number | boolean>>,
      userId,
    );
    await recordChange(
      this.adminAudit,
      before,
      after,
      'updated',
      { userId, role },
      request,
    );
    return this.list();
  }

  @Post('reset')
  @ApiOperation({
    summary: 'Put every platform setting back to its default (admin)',
  })
  async reset(
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    const { before, after } = await this.settings.resetAll();
    await recordChange(
      this.adminAudit,
      before,
      after,
      'restored',
      { userId, role },
      request,
    );
    return this.list();
  }
}
