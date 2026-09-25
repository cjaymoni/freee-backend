import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** For actions that must say why: suspend, ban, hide, flag. */
export class ReasonDto {
  @ApiProperty({ example: 'Repeated no-shows reported by three sharers' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** For actions that undo one: reinstate, restore. */
export class OptionalReasonDto {
  @ApiPropertyOptional({ example: 'Appeal accepted' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SuspendUserDto extends ReasonDto {
  @ApiPropertyOptional({
    description:
      'When the suspension lifts on its own (ISO 8601). Omit to suspend until reinstated.',
  })
  @IsOptional()
  @IsDateString()
  until?: string;
}
