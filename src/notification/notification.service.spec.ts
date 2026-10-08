import { DataSource, FindOperator } from 'typeorm';
import { NotificationService } from './notification.service';
import { NotificationCategory, Notice } from './notification.types';
import { FirebaseService } from '../firebase/firebase.service';
import { MailService } from '../mail/mail.service';

const USER = 'user-1';

const chat: Notice = {
  category: NotificationCategory.CHAT_MESSAGES,
  title: 'Ama',
  body: 'Is it still available?',
  data: { type: 'chat_message', conversation_id: 'conv-1' },
};

const suspension: Notice = {
  category: NotificationCategory.ACCOUNT,
  title: 'Your account has been suspended',
  body: 'Until a moderator lifts it.',
  evenIfInactive: true,
  email: {
    subject: 'Suspended',
    paragraphs: ['Your account has been suspended.'],
    transactional: true,
  },
};

const withEmail = (notice: Notice): Notice => ({
  ...notice,
  email: { subject: 'Hi', paragraphs: ['Hello'] },
});

const setup = ({
  user = {},
  settings = null as Record<string, unknown> | null,
  tokens = ['phone', 'tablet'],
  invalidTokens = [] as string[],
} = {}) => {
  const users = {
    findOne: jest.fn().mockResolvedValue({
      id: USER,
      email: 'ama@example.com',
      notification_enabled: true,
      is_active: true,
      is_deleted: false,
      ...user,
    }),
  };
  const preferences = {
    findOne: jest
      .fn()
      .mockResolvedValue(settings ? { notification_settings: settings } : null),
  };
  const tokenQuery = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(tokens.map((token) => ({ token }))),
  };
  const sessions = {
    createQueryBuilder: jest.fn(() => tokenQuery),
    update: jest.fn().mockResolvedValue({}),
  };
  const firebase = {
    sendToTokens: jest.fn().mockResolvedValue({ sentCount: 1, invalidTokens }),
  };
  const mail = { sendNotice: jest.fn().mockResolvedValue(undefined) };
  const service = new NotificationService(
    users as never,
    preferences as never,
    sessions as never,
    {} as DataSource,
    firebase as unknown as FirebaseService,
    mail as unknown as MailService,
  );
  return { service, firebase, mail, sessions, tokenQuery };
};

describe('NotificationService.notify', () => {
  it('pushes to every live device, tagged with its category', async () => {
    const { service, firebase } = setup();

    await service.notify(USER, chat);

    expect(firebase.sendToTokens).toHaveBeenCalledWith(['phone', 'tablet'], {
      title: 'Ama',
      body: 'Is it still available?',
      data: {
        type: 'chat_message',
        conversation_id: 'conv-1',
        category: 'chat_messages',
      },
    });
  });

  it('counts every session not signed out and opened in the last 90 days', async () => {
    const { service, tokenQuery } = setup();

    await service.notify(USER, chat);

    const conditions = (tokenQuery.andWhere.mock.calls as [string][]).map(
      ([sql]) => sql,
    );
    expect(conditions).toEqual([
      's.is_active = true',
      's.fcm_token IS NOT NULL',
      's.created_at > :idleSince',
    ]);
    const [, { idleSince }] = tokenQuery.andWhere.mock.calls[2] as [
      string,
      { idleSince: Date },
    ];
    const days = (Date.now() - idleSince.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(90);
  });

  it('leaves out the devices of the sessions it is told to skip', async () => {
    const { service, tokenQuery } = setup();

    await service.notify(USER, chat, { skipDevicesOf: ['web', 'phone'] });

    const [sql, params] = tokenQuery.andWhere.mock.calls[3] as [string, object];
    expect(sql).toContain('s.fcm_token NOT IN');
    expect(params).toEqual({ skipDevicesOf: ['web', 'phone'] });
  });

  it('sends nothing when the user has no device', async () => {
    const { service, firebase } = setup({ tokens: [] });

    await service.notify(USER, chat);

    expect(firebase.sendToTokens).not.toHaveBeenCalled();
  });

  it.each([
    ['notifications are turned off', { user: { notification_enabled: false } }],
    ['push is turned off', { settings: { push: false } }],
    ['that kind is turned off', { settings: { chat_messages: false } }],
    ['the account is suspended', { user: { is_active: false } }],
  ])('does not push when %s', async (_, options) => {
    const { service, firebase } = setup(options);

    await service.notify(USER, chat);

    expect(firebase.sendToTokens).not.toHaveBeenCalled();
  });

  it('still pushes other kinds when one is turned off', async () => {
    const { service, firebase } = setup({
      settings: { item_requests: false },
    });

    await service.notify(USER, chat);

    expect(firebase.sendToTokens).toHaveBeenCalled();
  });

  it('pushes a notice about the account to a suspended user', async () => {
    const { service, firebase } = setup({ user: { is_active: false } });

    await service.notify(USER, suspension);

    expect(firebase.sendToTokens).toHaveBeenCalled();
  });

  it('never reaches a deleted account', async () => {
    const { service, firebase, mail } = setup({ user: { is_deleted: true } });

    await service.notify(USER, suspension);

    expect(firebase.sendToTokens).not.toHaveBeenCalled();
    expect(mail.sendNotice).not.toHaveBeenCalled();
  });

  it('emails when the notice has an email and emails are on', async () => {
    const { service, mail } = setup();

    await service.notify(USER, withEmail(chat));

    expect(mail.sendNotice).toHaveBeenCalledWith('ama@example.com', {
      subject: 'Hi',
      title: 'Ama',
      paragraphs: ['Hello'],
    });
  });

  it.each([
    ['emails are turned off', { settings: { email: false } }],
    ['that kind is turned off', { settings: { chat_messages: false } }],
    ['notifications are turned off', { user: { notification_enabled: false } }],
    ['there is no address', { user: { email: null } }],
  ])('does not email when %s', async (_, options) => {
    const { service, mail } = setup(options);

    await service.notify(USER, withEmail(chat));

    expect(mail.sendNotice).not.toHaveBeenCalled();
  });

  it('sends an account email even to someone who turned emails off', async () => {
    const { service, mail } = setup({
      settings: { email: false, account: false },
      user: { notification_enabled: false, is_active: false },
    });

    await service.notify(USER, suspension);

    expect(mail.sendNotice).toHaveBeenCalled();
  });

  it('forgets tokens FCM says are dead', async () => {
    const { service, sessions } = setup({ invalidTokens: ['tablet'] });

    await service.notify(USER, chat);

    const [where, values] = sessions.update.mock.calls[0] as [
      { fcm_token: FindOperator<string[]> },
      object,
    ];
    expect(where.fcm_token.value).toEqual(['tablet']);
    expect(values).toEqual({ fcm_token: null });
  });

  it('never throws, and still emails when the push fails', async () => {
    const { service, firebase, mail } = setup();
    firebase.sendToTokens.mockRejectedValueOnce(new Error('FCM down'));

    await expect(
      service.notify(USER, { ...suspension, evenIfInactive: true }),
    ).resolves.toEqual({ push: 'failed', email: 'sent' });
    expect(mail.sendNotice).toHaveBeenCalled();
  });
});
