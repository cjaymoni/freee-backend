import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditLogEntity } from '../entities/audit-log.entity';

export class AuditLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  user_id?: string | null;

  @ApiProperty()
  entity_type: string;

  @ApiProperty()
  entity_id: string;

  @ApiProperty()
  action: string;

  @ApiPropertyOptional()
  old_values?: Record<string, any> | null;

  @ApiPropertyOptional()
  new_values?: Record<string, any> | null;

  @ApiPropertyOptional()
  changed_fields?: string[] | null;

  @ApiPropertyOptional()
  ip_address?: string | null;

  @ApiPropertyOptional()
  user_agent?: string | null;

  @ApiPropertyOptional()
  api_endpoint?: string | null;

  @ApiPropertyOptional()
  request_method?: string | null;

  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional()
  error_message?: string | null;

  @ApiPropertyOptional()
  metadata?: Record<string, any> | null;

  @ApiProperty()
  created_at: Date;

  static fromEntity(entity: AuditLogEntity): AuditLogResponseDto {
    const dto = new AuditLogResponseDto();
    dto.id = entity.id;
    dto.user_id = entity.user_id;
    dto.entity_type = entity.entity_type;
    dto.entity_id = entity.entity_id;
    dto.action = entity.action;
    dto.old_values = entity.old_values;
    dto.new_values = entity.new_values;
    dto.changed_fields = entity.changed_fields;
    dto.ip_address = entity.ip_address;
    dto.user_agent = entity.user_agent;
    dto.api_endpoint = entity.api_endpoint;
    dto.request_method = entity.request_method;
    dto.success = entity.success;
    dto.error_message = entity.error_message;
    dto.metadata = entity.metadata;
    dto.created_at = entity.created_at;
    return dto;
  }
}
