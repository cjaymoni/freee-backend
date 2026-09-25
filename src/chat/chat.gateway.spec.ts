import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';
import { AuthService } from '../auth/auth.service';

describe('ChatGateway presence', () => {
  let realtime: ChatRealtimeService;
  let chatService: { broadcastPresence: jest.Mock; pushUnreadCount: jest.Mock };
  let gateway: ChatGateway;
  let finishLookup: () => void;

  beforeEach(() => {
    realtime = new ChatRealtimeService();
    chatService = {
      broadcastPresence: jest.fn(),
      pushUnreadCount: jest.fn(),
    };
    const authService = {
      // Held open so the test can disconnect mid-handshake, like a phone
      // dropping off while the session lookup is still in flight.
      validateSession: jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finishLookup = () => resolve(true);
          }),
      ),
      getUserForValidation: jest.fn().mockResolvedValue({ is_active: true }),
    };
    gateway = new ChatGateway(
      chatService as unknown as ChatService,
      realtime,
      {
        verifyAsync: jest
          .fn()
          .mockResolvedValue({ sub: 'u1', session_token: 's1' }),
      } as unknown as JwtService,
      { get: () => 'secret' } as unknown as ConfigService,
      authService as unknown as AuthService,
    );
  });

  const socket = () => ({
    id: 'sock-1',
    connected: true,
    data: {} as Record<string, unknown>,
    handshake: { auth: { token: 't' }, headers: {}, query: {} },
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('does not leave a user online when the socket drops mid-handshake', async () => {
    const client = socket();
    const connecting = gateway.handleConnection(client as never);
    await settle();

    client.connected = false;
    await gateway.handleDisconnect(client as never);
    finishLookup();
    await connecting;

    expect(realtime.isOnline('u1')).toBe(false);
    expect(chatService.broadcastPresence).not.toHaveBeenCalledWith('u1', true);
  });

  it('marks a user online, then offline when the socket closes', async () => {
    const client = socket();
    const connecting = gateway.handleConnection(client as never);
    await settle();
    finishLookup();
    await connecting;
    expect(realtime.isOnline('u1')).toBe(true);

    client.connected = false;
    await gateway.handleDisconnect(client as never);
    expect(realtime.isOnline('u1')).toBe(false);
  });
});
