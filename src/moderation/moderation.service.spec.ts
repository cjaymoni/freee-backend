import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { ModerationService } from './moderation.service';
import { BlockedUser } from './entities/blocked-user.entity';
import { ReportedItem } from './entities/reported-item.entity';
import { ReportedUser } from './entities/reported-user.entity';
import { ModerationComplaint } from './entities/moderation-complaint.entity';
import { ItemService } from '../item/item.service';
import { UserService } from '../user/user.service';
import { ActionTaken } from './dto/resolve-report.dto';
import { UserRole } from '../user/entities/user.entity';

const build = (repos: {
  reportedItem?: object;
  reportedUser?: object;
  blocked?: object;
  complaint?: object;
  itemService?: object;
  userService?: object;
}) =>
  new ModerationService(
    (repos.reportedItem ?? {}) as Repository<ReportedItem>,
    (repos.reportedUser ?? {}) as Repository<ReportedUser>,
    (repos.blocked ?? {}) as Repository<BlockedUser>,
    (repos.complaint ?? {}) as Repository<ModerationComplaint>,
    (repos.itemService ?? {}) as ItemService,
    (repos.userService ?? {}) as UserService,
  );

describe('ModerationService.getBlockedUsers', () => {
  it('embeds only the public profile of each blocked user', async () => {
    const service = build({
      blocked: {
        find: jest.fn().mockResolvedValue([
          {
            id: 'block-1',
            blockerId: 'me',
            blockedId: 'b',
            isDeleted: false,
            blocked: {
              id: 'b',
              first_name: 'Esi',
              last_name: 'Mensah',
              cloudinary_avatar_url: 'https://x/b.png',
              email: 'b@example.com',
              fcm_token: 'SECRET-FCM',
              firebase_uid: 'fb-b',
              date_of_birth: '1990-01-01',
            },
          },
        ]),
      },
    });

    const [row] = await service.getBlockedUsers('me');

    expect(row).toMatchObject({ id: 'block-1', blockedId: 'b' });
    expect(row.blocked).toEqual({
      id: 'b',
      first_name: 'Esi',
      last_name: 'Mensah',
      cloudinary_avatar_url: 'https://x/b.png',
    });
  });
});

describe('ModerationService report queues', () => {
  const rows = () =>
    ['medium', 'high', 'low', 'urgent', 'high'].map((priority, i) => ({
      id: `r${i}`,
      priority,
    }));

  it.each([
    ['getItemReports', 'reportedItem'],
    ['getUserReports', 'reportedUser'],
  ] as const)('%s lists urgent, high, medium, low', async (method, repo) => {
    const service = build({
      [repo]: { find: jest.fn().mockResolvedValue(rows()) },
    });

    const result = (await service[method]()) as { id: string }[];

    // Same-priority rows keep the repository's newest-first order.
    expect(result.map((r) => r.id)).toEqual(['r3', 'r1', 'r4', 'r0', 'r2']);
  });
});

describe('ModerationService.resolveItemReport', () => {
  it('resolves a report whose item an earlier report already removed', async () => {
    const report = { id: 'rep-2', itemId: 'item-1', status: 'pending' };
    const save = jest.fn((row: object) => Promise.resolve(row));
    const service = build({
      reportedItem: { findOne: jest.fn().mockResolvedValue(report), save },
      itemService: {
        adminRemove: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Item not found')),
      },
    });

    const result = await service.resolveItemReport(
      'rep-2',
      { status: 'resolved', actionTaken: ActionTaken.ITEM_REMOVED } as never,
      'admin',
      UserRole.ADMIN,
    );

    expect(save).toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'resolved', reviewedBy: 'admin' });
  });

  const setup = () => {
    const findOne = jest
      .fn()
      .mockResolvedValue({ id: 'rep-3', itemId: 'item-1', reporterId: 'rep' });
    const save = jest.fn((row: object) => Promise.resolve(row));
    const adminRemove = jest.fn().mockResolvedValue({});
    const service = build({
      reportedItem: { findOne, save },
      itemService: { adminRemove },
    });
    return { service, findOne, save, adminRemove };
  };

  it('refuses a moderator removing the item', async () => {
    const { service, save, adminRemove } = setup();

    await expect(
      service.resolveItemReport(
        'rep-3',
        { status: 'resolved', actionTaken: ActionTaken.ITEM_REMOVED } as never,
        'mod-1',
        UserRole.MODERATOR,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(adminRemove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('lets a moderator resolve without removing', async () => {
    const { service, adminRemove } = setup();

    await service.resolveItemReport(
      'rep-3',
      { status: 'resolved', actionTaken: ActionTaken.USER_WARNED } as never,
      'mod-1',
      UserRole.MODERATOR,
    );

    expect(adminRemove).not.toHaveBeenCalled();
  });

  it('refuses reviewing a report you filed', async () => {
    const { service, save } = setup();

    await expect(
      service.resolveItemReport(
        'rep-3',
        { status: 'dismissed' } as never,
        'rep',
        UserRole.ADMIN,
      ),
    ).rejects.toThrow('You cannot review a report you filed');
    expect(save).not.toHaveBeenCalled();
  });
});

describe('ModerationService targets that do not exist', () => {
  const fkViolation = () => {
    const error = new QueryFailedError('INSERT', [], new Error('fk'));
    (error as unknown as { driverError: object }).driverError = {
      code: '23503',
    };
    return error;
  };

  it('answers a report on a missing item with 404', async () => {
    const service = build({
      reportedItem: {
        create: (row: object) => row,
        save: jest.fn().mockRejectedValue(fkViolation()),
      },
    });
    await expect(
      service.reportItem({ itemId: 'nope', reason: 'spam' } as never, 'me'),
    ).rejects.toThrow(NotFoundException);
  });

  it('answers a block of a missing user with 404', async () => {
    const service = build({
      blocked: {
        findOne: jest.fn().mockResolvedValue(null),
        create: (row: object) => row,
        save: jest.fn().mockRejectedValue(fkViolation()),
      },
    });
    await expect(
      service.blockUser({ blockedId: 'nope' } as never, 'me'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ModerationService.resolveUserReport', () => {
  const setup = (role: string, account_status = 'active') => {
    const update = jest.fn().mockResolvedValue(true);
    const save = jest.fn((r: unknown) => Promise.resolve(r));
    const service = build({
      reportedUser: {
        findOne: jest.fn().mockResolvedValue({
          id: 'rep-1',
          reporterId: 'reporter',
          reportedUserId: 'target',
          reason: 'Harassment',
          reportedUser: { id: 'target', role, account_status },
        }),
        save,
      },
      userService: { setAccountState: update },
    });
    return { service, update, save };
  };

  it.each([
    ['ADMIN', ActionTaken.USER_SUSPENDED],
    ['MODERATOR', ActionTaken.USER_SUSPENDED],
    ['ADMIN', ActionTaken.ITEM_REMOVED],
    ['MODERATOR', ActionTaken.ITEM_REMOVED],
  ])(
    'refuses to suspend a %s account from a report (%s)',
    async (role, actionTaken) => {
      const { service, update, save } = setup(role);

      await expect(
        service.resolveUserReport(
          'rep-1',
          { status: 'resolved', actionTaken } as never,
          'mod-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(update).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('suspends a regular user', async () => {
    const { service, update } = setup('USER');

    await service.resolveUserReport(
      'rep-1',
      { status: 'resolved', actionTaken: ActionTaken.USER_SUSPENDED } as never,
      'mod-1',
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'target' }),
      'active',
      {
        is_active: false,
        account_status: 'suspended',
        status_reason: 'Reported: Harassment',
        suspended_until: null,
        status_changed_by: 'mod-1',
      },
    );
  });

  it('leaves a banned account banned', async () => {
    const { service, update, save } = setup('USER', 'banned');

    await service.resolveUserReport(
      'rep-1',
      { status: 'resolved', actionTaken: ActionTaken.USER_SUSPENDED } as never,
      'mod-1',
    );

    expect(update).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it('refuses reviewing a report you filed', async () => {
    const { service, update, save } = setup('USER');

    await expect(
      service.resolveUserReport(
        'rep-1',
        {
          status: 'resolved',
          actionTaken: ActionTaken.USER_SUSPENDED,
        } as never,
        'reporter',
      ),
    ).rejects.toThrow('You cannot review a report you filed');
    expect(update).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
