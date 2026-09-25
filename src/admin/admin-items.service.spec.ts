import { DataSource } from 'typeorm';
import { ModerationStatus } from '../item/entities/item.entity';
import { UserRole } from '../user/entities/user.entity';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminItemsService,
  ITEM_FLAGGED,
  ITEM_HIDDEN,
  ITEM_RESTORED,
} from './admin-items.service';

const moderator = { userId: 'mod-1', role: UserRole.MODERATOR };

const setup = (item: object | null) => {
  const repo = {
    findOne: jest.fn().mockResolvedValue(item),
    update: jest.fn().mockResolvedValue({}),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminItemsService(
    { getRepository: () => repo } as unknown as DataSource,
    audit as unknown as AdminAuditService,
  );
  jest.spyOn(service, 'detail').mockResolvedValue({ data: {} } as never);
  return { service, repo, audit };
};

const listing = (moderation_status: ModerationStatus) => ({
  id: 'item-1',
  is_deleted: false,
  moderation_status,
});

describe('AdminItemsService moderation', () => {
  it.each([
    ['hide', ModerationStatus.VISIBLE, ModerationStatus.HIDDEN, ITEM_HIDDEN],
    ['hide', ModerationStatus.FLAGGED, ModerationStatus.HIDDEN, ITEM_HIDDEN],
    ['flag', ModerationStatus.VISIBLE, ModerationStatus.FLAGGED, ITEM_FLAGGED],
    [
      'restore',
      ModerationStatus.HIDDEN,
      ModerationStatus.VISIBLE,
      ITEM_RESTORED,
    ],
    [
      'restore',
      ModerationStatus.FLAGGED,
      ModerationStatus.VISIBLE,
      ITEM_RESTORED,
    ],
  ] as const)(
    '%s moves a %s listing to %s and audits it',
    async (method, from, to, action) => {
      const { service, repo, audit } = setup(listing(from));

      await service[method](moderator, 'item-1', 'Because');

      expect(repo.update).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({
          moderation_status: to,
          moderation_reason: to === ModerationStatus.VISIBLE ? null : 'Because',
          moderated_by: moderator.userId,
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: moderator,
          action,
          oldValues: { moderation_status: from },
          newValues: { moderation_status: to },
          reason: 'Because',
        }),
      );
    },
  );

  it.each([
    ['hide', ModerationStatus.HIDDEN],
    ['flag', ModerationStatus.FLAGGED],
    ['flag', ModerationStatus.HIDDEN],
    ['restore', ModerationStatus.VISIBLE],
  ] as const)('refuses to %s a %s listing', async (method, from) => {
    const { service, repo } = setup(listing(from));

    await expect(
      service[method](moderator, 'item-1', 'x'),
    ).rejects.toMatchObject({ status: 409 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('404s on a removed or missing listing', async () => {
    const { service } = setup(null);

    await expect(service.hide(moderator, 'item-1', 'x')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('AdminItemsService.list filters', () => {
  const setup = () => {
    const calls: [string, unknown?][] = [];
    const qb: Record<string, unknown> = {};
    for (const m of ['leftJoinAndSelect', 'orderBy', 'skip', 'take']) {
      qb[m] = () => qb;
    }
    qb.andWhere = (sql: unknown, params?: unknown) => {
      calls.push([typeof sql === 'string' ? sql : 'brackets', params]);
      return qb;
    };
    qb.getManyAndCount = () => Promise.resolve([[], 0]);
    const service = new AdminItemsService(
      {
        getRepository: () => ({ createQueryBuilder: () => qb }),
      } as unknown as DataSource,
      {} as AdminAuditService,
    );
    return { service, calls };
  };

  it('leaves removed listings out unless asked', async () => {
    const { service, calls } = setup();
    await service.list({});
    expect(calls).toContainEqual(['item.is_deleted = false', undefined]);

    const withRemoved = setup();
    await withRemoved.service.list({ include_deleted: true });
    expect(withRemoved.calls.map(([sql]) => sql)).not.toContain(
      'item.is_deleted = false',
    );
  });

  it('matches a top-level category and its subcategories', async () => {
    const { service, calls } = setup();
    await service.list({ category_id: 'cat-1' });
    expect(calls).toContainEqual([
      '(category.id = :categoryId OR category.parent_category_id = :categoryId)',
      { categoryId: 'cat-1' },
    ]);
  });

  it.each([
    [
      true,
      'EXISTS (SELECT 1 FROM item_requests ir WHERE ir.item_id = item.id)',
    ],
    [
      false,
      'NOT EXISTS (SELECT 1 FROM item_requests ir WHERE ir.item_id = item.id)',
    ],
  ])('has_requests=%s filters on requests', async (has_requests, sql) => {
    const { service, calls } = setup();
    await service.list({ has_requests });
    expect(calls.map(([s]) => s)).toContain(sql);
  });

  it('filters on moderation status and sharer', async () => {
    const { service, calls } = setup();
    await service.list({
      moderation_status: ModerationStatus.HIDDEN,
      user_id: 'u-1',
    });
    expect(calls).toContainEqual([
      'item.moderation_status = :moderation',
      { moderation: ModerationStatus.HIDDEN },
    ]);
    expect(calls).toContainEqual(['item.user_id = :userId', { userId: 'u-1' }]);
  });
});
