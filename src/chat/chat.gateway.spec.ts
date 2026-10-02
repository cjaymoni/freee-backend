import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';
import { AuthService } from '../auth/auth.service';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { CHAT_NAMESPACE, ChatClientEvents, ChatEvents } from './chat.constants';

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

describe('ChatGateway payloads over a real socket', () => {
  let app: INestApplication;
  let client: ClientSocket;
  const sendMessage = jest.fn().mockResolvedValue({ state: true });
  // pushUnreadCount is the last step of handleConnection: once it runs, the
  // server has authenticated the socket, which the client's own 'connect'
  // event does not promise.
  let serverReady!: () => void;
  const authenticated = new Promise<void>((resolve) => (serverReady = resolve));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ChatGateway,
        ChatRealtimeService,
        {
          provide: ChatService,
          useValue: {
            sendMessage,
            broadcastPresence: jest.fn(),
            pushUnreadCount: jest.fn(() => {
              serverReady();
              return Promise.resolve();
            }),
          },
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: () =>
              Promise.resolve({ sub: 'u1', session_token: 's1' }),
          },
        },
        { provide: ConfigService, useValue: { get: () => 'secret' } },
        {
          provide: AuthService,
          useValue: {
            validateSession: () => Promise.resolve(true),
            getUserForValidation: () => Promise.resolve({ is_active: true }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0);
    const server = app.getHttpServer() as Server;
    const { port } = server.address() as AddressInfo;

    client = io(`http://127.0.0.1:${port}${CHAT_NAMESPACE}`, {
      auth: { token: 't' },
      transports: ['websocket'],
    });
    // A refused handshake fails here at once instead of at Jest's timeout:
    // the gateway accepts the connection, then emits its error and drops it.
    let refuse!: (why: unknown) => void;
    const refused = new Promise<never>((_, reject) => {
      refuse = (why) =>
        reject(new Error(`chat socket refused: ${JSON.stringify(why)}`));
    });
    const refusals = ['connect_error', ChatEvents.ERROR, 'disconnect'];
    refusals.forEach((event) => client.once(event, refuse));
    try {
      await Promise.race([authenticated, refused]);
    } finally {
      // Detached so the disconnect in afterAll is not taken as a refusal.
      refusals.forEach((event) => client.off(event, refuse));
    }
  });

  afterAll(async () => {
    client?.disconnect();
    await app?.close();
  });

  afterEach(() => sendMessage.mockClear());

  const send = (content: string) =>
    client.timeout(2000).emitWithAck(ChatClientEvents.SEND_MESSAGE, {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      content,
      client_message_id: 'c1',
    }) as Promise<Record<string, unknown>>;

  it('refuses a NUL in the payload before the handler runs', async () => {
    await expect(send('hi\u0000there')).resolves.toMatchObject({
      state: false,
      statusCode: 400,
      message: 'body.content must not contain a NUL character',
      client_message_id: 'c1',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('still delivers an ordinary message', async () => {
    await expect(send('hi there')).resolves.toMatchObject({ state: true });
    expect(sendMessage).toHaveBeenCalledWith(
      'u1',
      '11111111-1111-4111-8111-111111111111',
      'hi there',
    );
  });

  it('records when the app goes to the background and comes back', async () => {
    const realtime = app.get(ChatRealtimeService);
    const setState = (state: string) =>
      client
        .timeout(2000)
        .emitWithAck(ChatClientEvents.APP_STATE, { state }) as Promise<
        Record<string, unknown>
      >;

    await expect(setState('background')).resolves.toEqual({ state: true });
    expect(realtime.isOnline('u1')).toBe(true);
    expect(realtime.foregroundSessions('u1')).toEqual([]);

    await expect(setState('foreground')).resolves.toEqual({ state: true });
    // Known by the session the socket authenticated with (the JWT's s1).
    expect(realtime.foregroundSessions('u1')).toEqual(['s1']);
  });

  it('refuses an unknown app state', async () => {
    await expect(
      client
        .timeout(2000)
        .emitWithAck(ChatClientEvents.APP_STATE, { state: 'asleep' }),
    ).resolves.toMatchObject({ state: false, statusCode: 400 });
  });
});
