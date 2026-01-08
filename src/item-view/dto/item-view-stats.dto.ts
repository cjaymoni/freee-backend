import { ApiProperty } from '@nestjs/swagger';

export class ItemViewStatsDto {
  @ApiProperty()
  total_views: number;

  @ApiProperty()
  unique_viewers: number;

  @ApiProperty()
  anonymous_views: number;

  @ApiProperty()
  average_duration_seconds: number;

  @ApiProperty()
  views_by_device: Record<string, number>;

  @ApiProperty()
  views_by_date: Array<{ date: string; count: number }>;
}
