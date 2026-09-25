import { Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuditLogEntity } from './entities/audit-log.entity';

describe('AuditService filters on uuid columns', () => {
  const repo = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
  };
  const service = new AuditService(
    repo as unknown as Repository<AuditLogEntity>,
  );

  afterEach(() => jest.clearAllMocks());

  it.each([[{ userId: '1111' }], [{ entityId: 'abc' }]])(
    'answers a partly typed id %j with no results instead of querying',
    async (filters) => {
      await expect(service.findAll(filters)).resolves.toEqual({
        logs: [],
        total: 0,
      });
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    },
  );

  it('answers entity history for a non-UUID with no results', async () => {
    await expect(service.getEntityHistory('items', 'abc')).resolves.toEqual([]);
    expect(repo.find).not.toHaveBeenCalled();
  });
});
