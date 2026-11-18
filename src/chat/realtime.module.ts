import { Module } from '@nestjs/common';
import { ChatRealtimeService } from './chat-realtime.service';

/**
 * The socket registry on its own, with no imports, so modules that only need
 * to emit to a user (items and accounts closing requests) can reach it
 * without importing ChatModule, which pulls in AuthModule -> UserModule and
 * would make a cycle. One instance: ChatModule re-exports this one rather
 * than declaring its own.
 */
@Module({
  providers: [ChatRealtimeService],
  exports: [ChatRealtimeService],
})
export class RealtimeModule {}
