import { NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { ModerationService } from './moderation.service';
import { BlockedUser } from './entities/blocked-user.entity';
import { ReportedItem } from './entities/reported-item.entity';
import { ReportedUser } from './entities/reported-user.entity';
import { ModerationComplaint } from './entities/moderation-complaint.entity';
import { ItemService } from '../item/item.service';
import { UserService } from '../user/user.service';
import { ActionTaken } from './dto/resolve-report.dto';

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
    );

    expect(save).toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'resolved', reviewedBy: 'admin' });
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
