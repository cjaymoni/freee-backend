import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { FirebaseService } from './firebase.service';

jest.mock('firebase-admin', () => ({ messaging: jest.fn() }));

type Result = { success: boolean; error?: { code: string; message: string } };

describe('FirebaseService.sendToTokens', () => {
  const send = jest.fn();
  const service = new FirebaseService({} as ConfigService);
  // As if onModuleInit had found credentials.
  Object.assign(service, { firebaseApp: {} });

  beforeEach(() => {
    send.mockReset();
    (admin.messaging as unknown as jest.Mock).mockReturnValue({
      sendEachForMulticast: send,
    });
  });

  const reply = (...responses: Result[]) =>
    send.mockResolvedValue({
      responses,
      successCount: responses.filter((r) => r.success).length,
    });
  const fail = (code: string): Result => ({
    success: false,
    error: { code: `messaging/${code}`, message: code },
  });
  const ok: Result = { success: true };

  it('sends one message to every token, with the notification and data', async () => {
    reply(ok, ok);

    await expect(
      service.sendToTokens(['a', 'b'], {
        title: 'Hi',
        body: 'There',
        data: { type: 'chat_message' },
      }),
    ).resolves.toEqual({ invalidTokens: [] });
    expect(send).toHaveBeenCalledWith({
      tokens: ['a', 'b'],
      notification: { title: 'Hi', body: 'There' },
      data: { type: 'chat_message' },
    });
  });

  it('returns dead tokens by position, and only those', async () => {
    reply(
      ok,
      fail('registration-token-not-registered'),
      fail('unavailable'),
      fail('invalid-registration-token'),
    );

    await expect(
      service.sendToTokens(['live', 'gone', 'busy', 'bad'], {
        title: 't',
        body: 'b',
      }),
    ).resolves.toEqual({ invalidTokens: ['gone', 'bad'] });
  });

  it('counts a rejected token as dead when another one got through', async () => {
    reply(ok, fail('invalid-argument'), fail('mismatched-credential'));

    const { invalidTokens } = await service.sendToTokens(['a', 'b', 'c'], {
      title: 't',
      body: 'b',
    });

    expect(invalidTokens).toEqual(['b', 'c']);
  });

  it('keeps rejected tokens when nothing got through: the fault is ours', async () => {
    reply(fail('invalid-argument'), fail('mismatched-credential'));

    const { invalidTokens } = await service.sendToTokens(['a', 'b'], {
      title: 't',
      body: 'b',
    });

    expect(invalidTokens).toEqual([]);
  });

  it('sends nothing for no tokens, or without Firebase configured', async () => {
    await expect(
      service.sendToTokens([], { title: 't', body: 'b' }),
    ).resolves.toEqual({ invalidTokens: [] });

    const unconfigured = new FirebaseService({} as ConfigService);
    await expect(
      unconfigured.sendToTokens(['a'], { title: 't', body: 'b' }),
    ).resolves.toEqual({ invalidTokens: [] });
    expect(send).not.toHaveBeenCalled();
  });
});
