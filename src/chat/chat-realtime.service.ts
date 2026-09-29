import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * Owns the socket server handle and the online-user registry.
 *
 * It exists to break a cycle: ChatService has to push events to sockets, and
 * the gateway has to call ChatService to do the actual work. Rather than
 * wiring the two together with forwardRef, the gateway hands its server to
 * this service on init and both depend on it instead.
 *
 * Presence is tracked per process, in memory. That is correct for the way this
 * is deployed: PM2 in fork mode, one instance.
 *
 * It does not survive being scaled out. Under `pm2 -i max`, or any second
 * instance, each worker would keep its own rooms and presence map, so two
 * users on different workers would see each other as permanently offline and
 * would miss each other's events. Messages would still be stored and still be
 * pushed over FCM, which is what would make it easy to miss. Going multi-worker
 * means adding a socket.io Redis adapter first - see docs/CHAT_MODULE.md.
 */
@Injectable()
export class ChatRealtimeService {
  private readonly logger = new Logger(ChatRealtimeService.name);

  private server: Server | null = null;

  /**
   * userId -> that user's live socket ids. A user is online while the set is
   * non-empty; the set (rather than a counter) means a socket id delivered
   * twice cannot corrupt the count.
   */
  private readonly socketsByUser = new Map<string, Set<string>>();

  /**
   * Sockets whose app said it went to the background. The OS can keep such a
   * socket open for a while, so it still counts for presence but no longer
   * stands in for a push.
   */
  private readonly backgroundSockets = new Set<string>();

  bindServer(server: Server): void {
    this.server = server;
  }

  /**
   * Drops every socket the user has open on this instance. Sockets are only
   * checked when they connect, so this is how a suspension or ban reaches a
   * user who already has the app open.
   */
  disconnectUser(userId: string): void {
    this.server
      ?.in(ChatRealtimeService.roomForUser(userId))
      .disconnectSockets(true);
  }

  /** The room every one of a user's devices joins, so events fan out to all. */
  static roomForUser(userId: string): string {
    return `user:${userId}`;
  }

  /**
   * @returns true when this socket brought the user online, so the caller
   * knows whether to broadcast a presence change.
   */
  registerSocket(userId: string, socketId: string): boolean {
    let sockets = this.socketsByUser.get(userId);

    if (!sockets) {
      sockets = new Set<string>();
      this.socketsByUser.set(userId, sockets);
    }

    const wasOffline = sockets.size === 0;
    sockets.add(socketId);

    return wasOffline;
  }

  /**
   * @returns true when this was the user's last socket, so the caller knows
   * whether to broadcast a presence change.
   */
  unregisterSocket(userId: string, socketId: string): boolean {
    const sockets = this.socketsByUser.get(userId);

    if (!sockets) {
      return false;
    }

    sockets.delete(socketId);
    this.backgroundSockets.delete(socketId);

    if (sockets.size > 0) {
      return false;
    }

    this.socketsByUser.delete(userId);
    return true;
  }

  isOnline(userId: string): boolean {
    return (this.socketsByUser.get(userId)?.size ?? 0) > 0;
  }

  /** Record whether the app behind a socket is in the background. */
  setBackground(userId: string, socketId: string, background: boolean): void {
    // Only a registered socket, so a late event can't outlive its socket.
    if (!this.socketsByUser.get(userId)?.has(socketId)) return;
    if (background) this.backgroundSockets.add(socketId);
    else this.backgroundSockets.delete(socketId);
  }

  /**
   * Whether the user has the app open in front of them on some device, so a
   * push would only repeat what the socket already shows. A socket counts
   * as in front until its app says otherwise.
   */
  isInForeground(userId: string): boolean {
    for (const socketId of this.socketsByUser.get(userId) ?? []) {
      if (!this.backgroundSockets.has(socketId)) return true;
    }
    return false;
  }

  /**
   * Push an event to every device a user has connected.
   *
   * Emitting is best-effort by design: a failed push must not roll back the
   * message that was already committed, so callers get no error back and the
   * client reconciles on its next fetch.
   */
  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) {
      return;
    }

    try {
      this.server
        .to(ChatRealtimeService.roomForUser(userId))
        .emit(event, payload);
    } catch (error) {
      this.logger.warn(
        `Failed to emit ${event} to user: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /** Emit the same event to both participants of a conversation. */
  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    for (const userId of userIds) {
      this.emitToUser(userId, event, payload);
    }
  }
}
