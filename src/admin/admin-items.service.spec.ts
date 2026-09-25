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
