import { Module } from '@nestjs/common';
import { ChatRealtimeService } from './chat-realtime.service';

/**
 * ChatRealtimeService on its own, so modules ChatModule depends on (auth)
 * can drop a user's sockets without importing ChatModule back. One module
 * instance, so everyone shares the server the gateway binds.
 */
@Module({
  providers: [ChatRealtimeService],
  exports: [ChatRealtimeService],
})
export class ChatRealtimeModule {}
