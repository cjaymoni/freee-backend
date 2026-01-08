import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/entities/user.entity';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Get audit logs with filters (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Audit logs retrieved successfully',
    type: [AuditLogResponseDto],
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  async findAll(
    @Query() query: AuditLogQueryDto,
  ): Promise<{ logs: AuditLogResponseDto[]; total: number }> {
    const { logs, total } = await this.auditService.findAll(query);
    return {
      logs: logs.map((log) => AuditLogResponseDto.fromEntity(log)),
      total,
    };
  }

  @Get('entity/:entityType/:entityId')
  @ApiOperation({
    summary: 'Get audit history for a specific entity (Admin only)',
  })
  @ApiParam({
    name: 'entityType',
    description: 'Entity type (e.g., items, users)',
  })
  @ApiParam({ name: 'entityId', description: 'Entity ID' })
  @ApiResponse({
    status: 200,
    description: 'Entity audit history retrieved successfully',
    type: [AuditLogResponseDto],
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  async getEntityHistory(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ): Promise<AuditLogResponseDto[]> {
    const logs = await this.auditService.getEntityHistory(entityType, entityId);
    return logs.map((log) => AuditLogResponseDto.fromEntity(log));
  }
}
