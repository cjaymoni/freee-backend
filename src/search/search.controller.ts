import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  SearchService,
  POPULAR_MIN_SEARCHERS,
  POPULAR_WINDOW_DAYS,
} from './search.service';
import { PopularSearchDto } from './dto/popular-search.dto';
import { ServiceResponseDto } from '../common/service-response.dto';
import { AppError } from '../common/app-error';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('popular')
  @ApiOperation({
    summary: 'Get popular search terms',
    description:
      `Terms searched through \`GET /items?query=\` over the last ${POPULAR_WINDOW_DAYS} days, ` +
      'ranked by how many different people searched them (each searcher counts ' +
      'once per day). Terms are lowercased and without accents. A term is only ' +
      `listed once at least ${POPULAR_MIN_SEARCHERS} different people have searched it, ` +
      'so nothing a single person typed is ever shown.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: `Number of terms to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})`,
  })
  @ApiResponse({ status: 200, type: PopularSearchDto, isArray: true })
  @ApiResponse({ status: 400, description: 'Invalid limit' })
  async getPopular(
    @Query('limit') limit?: string,
  ): Promise<ServiceResponseDto<PopularSearchDto[]>> {
    const parsed = limit === undefined ? DEFAULT_LIMIT : Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      throw new AppError(
        new BadRequestException(
          `limit must be an integer between 1 and ${MAX_LIMIT}`,
        ),
      );
    }
    return this.searchService.getPopular(parsed);
  }
}
