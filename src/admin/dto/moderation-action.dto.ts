import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** So a reason of only spaces counts as empty. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** For actions that must say why: suspend, ban, hide, flag. */
export class ReasonDto {
  @ApiProperty({ example: 'Repeated no-shows reported by three sharers' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** For actions that undo one: reinstate, restore. */
export class OptionalReasonDto {
  @ApiPropertyOptional({ example: 'Appeal accepted' })
  @Transform(trim)
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
