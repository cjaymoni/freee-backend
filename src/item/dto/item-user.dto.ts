import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ItemUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  profile_image: string | null;

  @ApiPropertyOptional({ nullable: true })
  joined_date: Date;

  @ApiPropertyOptional({ nullable: true })
  phone_number: string | null;

  @ApiProperty()
  items_count: number;
}
