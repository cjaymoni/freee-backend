import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchService, POPULAR_MIN_SEARCHERS } from './search.service';
import { SearchQueryEntity } from './entities/search-query.entity';

describe('SearchService', () => {
  let service: SearchService;

  const insertBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };
  const selectBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  const repo = {
    createQueryBuilder: jest.fn((alias?: string) =>
      alias ? selectBuilder : insertBuilder,
    ),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: getRepositoryToken(SearchQueryEntity), useValue: repo },
      ],
    }).compile();

    service = module.get(SearchService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('normalizeTerm', () => {
    it('folds case, accents and whitespace into one form', () => {
      expect(service.normalizeTerm('  Chaisé   Longue ')).toBe('chaise longue');
      expect(service.normalizeTerm('ɛkɔ')).toBe('eko');
    });

    it('ignores terms too short to rank', () => {
      expect(service.normalizeTerm(' a ')).toBeNull();
    });
  });

  describe('record', () => {
    it('stores the normalized term with a hash instead of the searcher', async () => {
      await service.record('Chair', 'user-1');

      const [values] = insertBuilder.values.mock.calls[0] as [
        { term: string; searcher_hash: string },
      ];
      expect(values.term).toBe('chair');
      expect(values.searcher_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(values.searcher_hash).not.toContain('user-1');
      expect(insertBuilder.orIgnore).toHaveBeenCalled();
    });

    it('gives the same searcher the same hash within a day', async () => {
      await service.record('chair', 'user-1');
      await service.record('chair', 'user-1');
      await service.record('chair', 'user-2');

      const hashes = insertBuilder.values.mock.calls.map(
        ([values]: [{ searcher_hash: string }]) => values.searcher_hash,
      );
      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[2]).not.toBe(hashes[0]);
    });

    it('never throws when the insert fails', async () => {
      insertBuilder.execute.mockRejectedValueOnce(new Error('db down'));

      await expect(service.record('chair', 'user-1')).resolves.toBeUndefined();
    });
  });

  describe('getPopular', () => {
    it('ranks terms by distinct searchers and hides rare ones', async () => {
      selectBuilder.getRawMany.mockResolvedValue([
        { term: 'chair', searches: '8' },
        { term: 'table', searches: '3' },
      ]);

      const result = await service.getPopular(5);

      expect(selectBuilder.having).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(DISTINCT search.searcher_hash)'),
        { minSearchers: POPULAR_MIN_SEARCHERS },
      );
      expect(selectBuilder.orderBy).toHaveBeenCalledWith('searches', 'DESC');
      expect(selectBuilder.limit).toHaveBeenCalledWith(5);
      expect(result.data).toEqual([
        { term: 'chair', searches: 8 },
        { term: 'table', searches: 3 },
      ]);
    });
  });
});
