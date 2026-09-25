import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/*
 * Bodies for the single-field preference endpoints. Binding them with
 * @Body('field') skipped validation entirely (the ValidationPipe only checks
 * class-typed parameters), so a missing or malformed value reached the
 * database as a 500. Same rules as CreateUserPreferenceDto.
 */

export class SetPreferredCategoriesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: ['123e4567-e89b-12d3-a456-426614174000'],
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  category_ids: string[];
}

export class UpdateLanguageDto {
  @ApiProperty({ example: 'en', maxLength: 10 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  language: string;
}

export class UpdateThemeDto {
  @ApiProperty({ enum: ['light', 'dark', 'auto'], example: 'dark' })
  @IsIn(['light', 'dark', 'auto'])
  theme: string;
}
