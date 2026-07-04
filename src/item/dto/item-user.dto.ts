import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ItemUserDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/example/avatar.jpg' })
  profile_image?: string | null;

  @ApiProperty({ type: String, example: '2026-06-28T16:28:43.399Z' })
  joined_date: Date;

  @ApiPropertyOptional({ example: '+233243225121' })
  phone_number?: string | null;

  @ApiProperty({ example: 5 })
  items_count: number;
}
