import { IsNull, Repository } from 'typeorm';
import { UserRole } from '../user/entities/user.entity';
import {
  StaffNotificationEntity,
  StaffNotificationType,
} from './entities/staff-notification.entity';
import { StaffInboxService } from './staff-inbox.service';

const setup = () => {
  const repo = {
    query: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue({ affected: 3 }),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    count: jest.fn().mockResolvedValue(2),
  };
  const service = new StaffInboxService(
    repo as unknown as Repository<StaffNotificationEntity>,
  );
  return { service, repo };
};

const entry = {
  type: StaffNotificationType.ITEM_REPORTED,
  title: 'A listing was reported',
  body: 'Counterfeit',
  link: '/reports/listings',
};

describe('StaffInboxService', () => {
  it('writes one entry per active staff member, leaving out the one who caused it', async () => {
    const { service, repo } = setup();
    await service.toAllStaff(entry, 'mod-1');

    const [sql, params] = repo.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('u.role::text = ANY($5)');
    expect(sql).toContain('u.is_active = true');
    expect(params).toEqual([
      entry.type,
      entry.title,
      entry.body,
      entry.link,
      [UserRole.ADMIN, UserRole.MODERATOR],
      'mod-1',
    ]);
  });

  it('cuts long user-typed text to fit', async () => {
    const { service, repo } = setup();
    await service.toUser('u-1', { ...entry, body: 'x'.repeat(600) });
    const [[row]] = repo.insert.mock.calls as [[{ body: string }]];
    expect(row.body).toHaveLength(500);
    expect(row.body.endsWith('…')).toBe(true);
  });

  it('never throws, so it cannot fail the action it is about', async () => {
    const { service, repo } = setup();
    repo.query.mockRejectedValueOnce(new Error('db down'));
    repo.insert.mockRejectedValueOnce(new Error('db down'));
    await expect(service.toAllStaff(entry)).resolves.toBeUndefined();
    await expect(service.toUser('u-1', entry)).resolves.toBeUndefined();
  });

  it('lists only unread entries when asked, with the unread count', async () => {
    const { service, repo } = setup();
    const res = await service.list('u-1', { unread: true, page: 2, limit: 10 });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'u-1', read_at: IsNull() },
        skip: 10,
        take: 10,
      }),
    );
    expect(res.unread).toBe(2);
  });

  it('only marks the user’s own entries read', async () => {
    const { service, repo } = setup();
    repo.exists.mockResolvedValueOnce(false);
    await expect(service.markRead('u-1', 'someone-elses')).resolves.toBe(false);
    expect(repo.update).not.toHaveBeenCalled();

    await expect(service.markAllRead('u-1')).resolves.toBe(3);
    expect(repo.update).toHaveBeenCalledWith(
      { user_id: 'u-1', read_at: IsNull() },
      { read_at: expect.any(Date) as Date },
    );
  });
});
