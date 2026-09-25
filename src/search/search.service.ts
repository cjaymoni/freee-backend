import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { SearchQueryEntity } from './entities/search-query.entity';
import { PopularSearchDto } from './dto/popular-search.dto';
import { ServiceResponseDto } from '../common/service-response.dto';
import { foldText } from '../common/text-fold';

/** How far back popular terms are counted. */
export const POPULAR_WINDOW_DAYS = 7;

/**
 * A term must be searched by at least this many different people before it is
 * shown, so something only one person typed (a name, a phone number) never
 * surfaces to anyone else.
 */
export const POPULAR_MIN_SEARCHERS = 3;

const MIN_TERM_LENGTH = 2;
const MAX_TERM_LENGTH = 100;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  // Regenerated on every start, so stored hashes can never be recomputed from
  // a user ID or IP, even by someone with database access.
  private readonly salt = randomBytes(32).toString('hex');

  constructor(
    @InjectRepository(SearchQueryEntity)
    private readonly searchQueryRepository: Repository<SearchQueryEntity>,
  ) {}

  /**
   * The form a term is stored and ranked in: accents and case folded and
   * whitespace collapsed, so "Chaise " and "chaise" count as one term. Null
   * when the term is too short to be worth ranking.
   */
  normalizeTerm(term: string): string | null {
    const normalized = foldText(term).trim().replace(/\s+/g, ' ');
    if (normalized.length < MIN_TERM_LENGTH) return null;
    return normalized.slice(0, MAX_TERM_LENGTH);
  }

  /**
   * Count a search towards popular terms. Repeats by the same searcher on the
   * same day are ignored. Never throws: a failure here must not fail the
   * search itself.
   */
  async record(term: string, searcherKey: string): Promise<void> {
    const normalized = this.normalizeTerm(term);
    if (!normalized || !searcherKey) return;

    const day = new Date().toISOString().slice(0, 10);
    const searcherHash = createHash('sha256')
      .update(`${this.salt}:${day}:${searcherKey}`)
      .digest('hex');

    try {
      await this.searchQueryRepository
        .createQueryBuilder()
        .insert()
        .into(SearchQueryEntity)
        .values({ term: normalized, searcher_hash: searcherHash })
        .orIgnore()
        .execute();
    } catch (error) {
      this.logger.warn(
        `Failed to record search: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Terms searched by the most different people over the last
   * {@link POPULAR_WINDOW_DAYS} days, most popular first. Ties go to the more
   * recently searched term, then alphabetically.
   */
  async getPopular(
    limit: number,
  ): Promise<ServiceResponseDto<PopularSearchDto[]>> {
    const since = new Date(
      Date.now() - POPULAR_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const rows = await this.searchQueryRepository
      .createQueryBuilder('search')
      .select('search.term', 'term')
      .addSelect('COUNT(DISTINCT search.searcher_hash)', 'searches')
      .addSelect('MAX(search.created_at)', 'last_searched')
      .where('search.created_at >= :since', { since })
      .groupBy('search.term')
      .having('COUNT(DISTINCT search.searcher_hash) >= :minSearchers', {
        minSearchers: POPULAR_MIN_SEARCHERS,
      })
      .orderBy('searches', 'DESC')
      .addOrderBy('last_searched', 'DESC')
      .addOrderBy('term', 'ASC')
      .limit(limit)
      .getRawMany<{ term: string; searches: string }>();

    return {
      message: 'Popular searches retrieved successfully',
      data: rows.map((row) => ({
        term: row.term,
        searches: Number(row.searches),
      })),
      state: true,
      statusCode: 200,
    };
  }

  /** Searches older than the window are never ranked again, so drop them. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired(): Promise<void> {
    const cutoff = new Date(
      Date.now() - POPULAR_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    try {
      const result = await this.searchQueryRepository.delete({
        created_at: LessThan(cutoff),
      });
      this.logger.log(`Purged ${result.affected ?? 0} expired search records`);
    } catch (error) {
      this.logger.error(
        `Failed to purge expired searches: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
