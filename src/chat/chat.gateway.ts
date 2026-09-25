import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Server, Socket } from 'socket.io';

import { ChatService } from './chat.service';
import { ChatRealtimeService } from './chat-realtime.service';
import {
  ChatClientEvents,
  ChatEvents,
  CHAT_NAMESPACE,
  TYPING_TIMEOUT_MS,
} from './chat.constants';
import {
  WsMarkReadDto,
  WsSendMessageDto,
  WsTypingDto,
} from './dto/ws-events.dto';
import { AuthService } from '../auth/auth.service';
import { WsHttpExceptionFilter } from './ws-http-exception.filter';

/** What we hang off the socket once its token has been verified. */
interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
    email?: string;
  };
}

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  session_token: string;
}

/**
 * Realtime side of chat.
 *
 * The gateway only does transport: authenticate the socket, route the event
 * to ChatService, and let the service decide what to persist and who to emit
 * to. That keeps one code path behind both REST and sockets, so a client that
 * cannot hold a socket open loses liveness but never functionality.
 *
 * Clients connect to the `/chat` namespace with the same access token they
 * use for REST, passed either as `auth.token` in the handshake or as an
 * Authorization header.
 */
@WebSocketGateway({
  namespace: CHAT_NAMESPACE,
  cors: {
    origin: true,
    credentials: true,
  },
})
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@UseFilters(new WsHttpExceptionFilter())
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly realtime: ChatRealtimeService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {}

  afterInit(server: Server): void {
    // Hands the server to the service layer, which is how ChatService pushes
    // events without depending on this class - see ChatRealtimeService.
    this.realtime.bindServer(server);
    this.logger.log(`Chat gateway listening on ${CHAT_NAMESPACE}`);
  }

  /**
   * Pull the access token off the handshake.
   *
   * Three shapes are accepted because the socket.io clients in use differ:
   * `auth.token` is the documented one, the header is what a browser proxy
   * tends to forward, and the query parameter is the fallback for clients
   * that cannot set either.
   */
  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: string } | undefined;

    if (auth?.token) {
      return auth.token.replace(/^Bearer\s+/i, '');
    }

    const header = client.handshake.headers.authorization;

    if (typeof header === 'string' && header.length > 0) {
      return header.replace(/^Bearer\s+/i, '');
    }

    const queryToken = client.handshake.query?.token;

    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return queryToken.replace(/^Bearer\s+/i, '');
    }

    return null;
  }

  /**
   * Authenticate the socket, then put it in its owner's room.
   *
   * The checks mirror JwtStrategy exactly - signature, then that the session
   * behind the token is still live - so revoking a session drops new sockets
   * the same way it drops REST calls.
   */
  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = this.extractToken(client);

      if (!token) {
        throw new Error('Missing access token');
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET') || 'defaultSecret',
      });

      if (!payload?.session_token) {
        throw new Error('Invalid token payload');
      }

      const isSessionActive = await this.authService.validateSession(
        payload.session_token,
      );

      if (!isSessionActive) {
        throw new Error('Session expired or invalidated');
      }

      const user = await this.authService.getUserForValidation(payload.sub);

      if (user && user.is_active === false) {
        throw new Error('Account suspended');
      }

      client.data.userId = payload.sub;
      client.data.email = payload.email;

      await client.join(ChatRealtimeService.roomForUser(payload.sub));

      // The lookups above take real time. If the client dropped meanwhile,
      // handleDisconnect has already run and found nothing to unregister, so
      // registering now would leave the user "online" - and their pushes
      // suppressed - until restart. Nothing is awaited between this check
      // and registerSocket, so a disconnect can't slip in between them; any
      // later one sees userId and unregisters normally.
      if (!client.connected) {
        return;
      }

      const cameOnline = this.realtime.registerSocket(payload.sub, client.id);

      if (cameOnline) {
        await this.chatService.broadcastPresence(payload.sub, true);
      }

      await this.chatService.pushUnreadCount(payload.sub);
    } catch (error) {
      // No detail goes back to the client: an unauthenticated socket should
      // not learn whether the token was malformed, expired or revoked.
      this.logger.warn(
        `Rejected chat socket: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      client.emit(ChatEvents.ERROR, { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    const userId = client.data?.userId;

    if (!userId) {
      return;
    }

    const wentOffline = this.realtime.unregisterSocket(userId, client.id);

    if (wentOffline) {
      await this.chatService.broadcastPresence(userId, false);
    }
  }

  /**
   * Reject anything arriving on a socket that never authenticated.
   *
   * handleConnection disconnects those, but an event can already be in flight
   * when it does, so every handler re-checks rather than trusting the close.
   */
  private requireUser(client: AuthenticatedSocket): string | null {
    const userId = client.data?.userId;

    if (!userId) {
      client.emit(ChatEvents.ERROR, { message: 'Unauthorized' });
      client.disconnect(true);
      return null;
    }

    return userId;
  }

  /**
   * Send a message over the socket.
   *
   * Delivery to both parties is handled by ChatService; the ack returned here
   * is only for the sending socket, and echoes `client_message_id` so it can
   * match the result to the optimistic bubble it already drew.
   */
  @SubscribeMessage(ChatClientEvents.SEND_MESSAGE)
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: WsSendMessageDto,
  ): Promise<unknown> {
    const userId = this.requireUser(client);

    if (!userId) {
      return { state: false, message: 'Unauthorized' };
    }

    try {
      const result = await this.chatService.sendMessage(
        userId,
        payload.conversation_id,
        payload.content,
      );

      return { ...result, client_message_id: payload.client_message_id };
    } catch (error) {
      return this.toSocketError(error, payload.client_message_id);
    }
  }

  @SubscribeMessage(ChatClientEvents.MARK_READ)
  async handleMarkRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: WsMarkReadDto,
  ): Promise<unknown> {
    const userId = this.requireUser(client);

    if (!userId) {
      return { state: false, message: 'Unauthorized' };
    }

    try {
      return await this.chatService.markAsRead(payload.conversation_id, userId);
    } catch (error) {
      return this.toSocketError(error);
    }
  }

  @SubscribeMessage(ChatClientEvents.TYPING_START)
  async handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: WsTypingDto,
  ): Promise<unknown> {
    const userId = this.requireUser(client);

    if (!userId) {
      return { state: false, message: 'Unauthorized' };
    }

    await this.chatService.relayTyping(userId, payload.conversation_id, true);

    return { state: true, timeout_ms: TYPING_TIMEOUT_MS };
  }

  @SubscribeMessage(ChatClientEvents.TYPING_STOP)
  async handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: WsTypingDto,
  ): Promise<unknown> {
    const userId = this.requireUser(client);

    if (!userId) {
      return { state: false, message: 'Unauthorized' };
    }

    await this.chatService.relayTyping(userId, payload.conversation_id, false);

    return { state: true };
  }

  /**
   * Turn a thrown AppError into the same envelope the REST layer returns, so
   * a client gets one error shape whichever transport it used.
   */
  private toSocketError(error: unknown, clientMessageId?: string): unknown {
    const response =
      error &&
      typeof error === 'object' &&
      'getResponse' in error &&
      typeof (error as { getResponse: unknown }).getResponse === 'function'
        ? (error as { getResponse: () => unknown }).getResponse()
        : { state: false, message: 'Failed to process the request' };

    return { ...(response as object), client_message_id: clientMessageId };
  }
}
