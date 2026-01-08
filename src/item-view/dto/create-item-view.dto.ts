import { IsUUID, IsOptional, IsInt, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateItemViewDto {
  @ApiProperty({
    description: 'ID of the item being viewed',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  item_id: string;

  @ApiProperty({
    description: 'Device type (e.g., mobile, desktop, tablet)',
    required: false,
    example: 'desktop',
  })
  @IsOptional()
  @IsString()
  device_type?: string;

  @ApiProperty({
    description: 'Referrer URL',
    required: false,
    example: 'https://google.com',
  })
  @IsOptional()
  @IsString()
  referrer?: string;

  @ApiProperty({
    description: 'Duration of view in seconds',
    required: false,
    example: 45,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  view_duration_seconds?: number;
}
