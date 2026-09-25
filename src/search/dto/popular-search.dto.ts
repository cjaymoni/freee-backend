import { ApiProperty } from '@nestjs/swagger';

export class PopularSearchDto {
  @ApiProperty({
    example: 'chair',
    description: 'Search term, lowercased and without accents',
  })
  term: string;

  @ApiProperty({
    example: 12,
    description:
      'Distinct searchers who searched this term in the window, counted once per searcher per day',
  })
  searches: number;
}
