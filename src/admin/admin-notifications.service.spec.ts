import { DataSource } from 'typeorm';
import {
  AdminNotificationEntity,
  AdminNotificationStatus,
  NotificationAudience,
} from '../notification/entities/admin-notification.entity';
import {
  NotificationService,
  NotifyResult,
} from '../notification/notification.service';
import { NotificationCategory } from '../notification/notification.types';
import { UserEntity, UserRole } from '../user/entities/user.entity';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminNotificationsService,
  NOTIFICATION_SENT,
} from './admin-notifications.service';

const admin = { userId: 'admin-1', role: UserRole.ADMIN };

const setup = ({
  recipients = ['u-1', 'u-2'],
  userExists = true,
}: { recipients?: string[]; userExists?: boolean } = {}) => {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({
      count: String(recipients.length),
      push: '1',
      email: '0',
    }),
    getCount: jest.fn().mockResolvedValue(recipients.length),
    getRawMany: jest.fn().mockResolvedValue(recipients.map((id) => ({ id }))),
  };
  const users = {
    exists: jest.fn().mockResolvedValue(userExists),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
  const sent = {
    create: jest.fn((row: object) => row),
    save: jest.fn((row: object) => Promise.resolve({ ...row, id: 'n-1' })),
    update: jest.fn().mockResolvedValue({}),
    findOneOrFail: jest.fn().mockResolvedValue({ id: 'n-1', sender: null }),
  };
  const dataSource = {
    getRepository: (entity: unknown) =>
      entity === UserEntity
        ? users
        : entity === AdminNotificationEntity && sent,
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    notify: jest
      .fn<Promise<NotifyResult>, unknown[]>()
      .mockResolvedValue({ push: 'sent', email: 'skipped' }),
  };
  const service = new AdminNotificationsService(
    dataSource as unknown as DataSource,
    audit as unknown as AdminAuditService,
    notifications as unknown as NotificationService,
  );
  // Delivery runs in the background; tests drive it directly.
  const deliver = jest
    .spyOn(service as never, 'deliver')
    .mockResolvedValue(undefined as never);
  return { service, qb, users, sent, audit, notifications, deliver };
};

const announcement = {
  title: 'We launch Friday',
  body: 'Thanks for being early.\n\nSee you there.',
};

describe('AdminNotificationsService.send', () => {
  it('records the send, audits it and delivers to every recipient', async () => {
    const { service, sent, audit, deliver } = setup();

    const res = await service.send(admin, {
      ...announcement,
      audience: NotificationAudience.ALL,
    });

    expect(sent.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: announcement.title,
        audience: { type: 'all' },
        status: AdminNotificationStatus.SENDING,
        recipient_count: 2,
        send_email: false,
        sent_by: admin.userId,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: admin,
        entityId: 'n-1',
        action: NOTIFICATION_SENT,
      }),
    );
    expect(deliver).toHaveBeenCalledWith(expect.anything(), ['u-1', 'u-2']);
    expect(res.message).toBe('Sending to 2 users');
  });

  it('refuses an audience nobody is in', async () => {
    const { service, sent } = setup({ recipients: [] });
    await expect(
      service.send(admin, {
        ...announcement,
        audience: NotificationAudience.FOUNDING_FREERS,
      }),
    ).rejects.toThrow('No users match this audience');
    expect(sent.save).not.toHaveBeenCalled();
  });

  it('refuses a user who does not exist', async () => {
    const { service } = setup({ userExists: false });
    await expect(
      service.send(admin, {
        ...announcement,
        audience: NotificationAudience.USER,
        user_id: '6d1037a4-fc07-4212-9e4c-97bd067cdc42',
      }),
    ).rejects.toThrow('User not found');
  });

  it('needs a city or a region for a location audience', async () => {
    const { service } = setup();
    await expect(
      service.countAudience({ audience: NotificationAudience.LOCATION }),
    ).rejects.toThrow('Give a city or a region');
  });

  it('matches a location on any of the user’s saved locations', async () => {
    const { service, qb } = setup();
    const res = await service.countAudience({
      audience: NotificationAudience.LOCATION,
      city: 'Accra',
    });

    expect(res.data).toEqual({
      count: 2,
      push_reachable: 1,
      email_reachable: 0,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      'EXISTS (SELECT 1 FROM locations l WHERE l.user_id = u.id AND l.is_deleted = false AND l.city ILIKE :city)',
      { city: 'Accra', region: undefined },
    );
  });

  it('stores only the fields the audience type uses', async () => {
    const { service, sent } = setup();
    await service.send(admin, {
      ...announcement,
      audience: NotificationAudience.FOUNDING_FREERS,
      city: 'Accra',
    });
    expect(sent.save).toHaveBeenCalledWith(
      expect.objectContaining({ audience: { type: 'founding_freers' } }),
    );
  });
});

describe('AdminNotificationsService delivery', () => {
  const row = {
    id: 'n-1',
    ...announcement,
    send_email: true,
  } as AdminNotificationEntity;

  const deliver = (service: AdminNotificationsService, ids: string[]) =>
    (
      service as unknown as {
        deliver: (n: AdminNotificationEntity, ids: string[]) => Promise<void>;
      }
    ).deliver(row, ids);

  it('counts what each user got and marks the send done', async () => {
    const { service, sent, notifications, deliver: spy } = setup();
    spy.mockRestore();
    notifications.notify
      .mockResolvedValueOnce({ push: 'sent', email: 'sent' })
      .mockResolvedValueOnce({ push: 'skipped', email: 'sent' })
      .mockResolvedValueOnce({ push: 'failed', email: 'skipped' })
      .mockResolvedValueOnce({ push: 'skipped', email: 'skipped' });

    await deliver(service, ['a', 'b', 'c', 'd']);

    expect(notifications.notify).toHaveBeenCalledWith('a', {
      category: NotificationCategory.ANNOUNCEMENTS,
      title: announcement.title,
      body: announcement.body,
      data: { type: 'announcement', notification_id: 'n-1' },
      email: {
        subject: announcement.title,
        paragraphs: ['Thanks for being early.', 'See you there.'],
      },
    });
    expect(sent.update).toHaveBeenCalledWith('n-1', {
      push_sent_count: 1,
      email_sent_count: 2,
      failure_count: 1,
    });
    expect(sent.update).toHaveBeenLastCalledWith(
      'n-1',
      expect.objectContaining({ status: AdminNotificationStatus.SENT }),
    );
  });

  it('marks the send failed, keeping its counts, if delivery stops', async () => {
    const { service, sent, deliver: spy } = setup();
    spy.mockRestore();
    sent.update.mockRejectedValueOnce(new Error('connection lost'));

    await deliver(service, ['a']);

    expect(sent.update).toHaveBeenLastCalledWith(
      'n-1',
      expect.objectContaining({
        status: AdminNotificationStatus.FAILED,
        push_sent_count: 1,
      }),
    );
  });
});
