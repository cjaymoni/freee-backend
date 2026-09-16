import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ChatRealtimeService } from './chat-realtime.service';
import { ConversationEntity } from './entities/conversation.entity';
import { MessageEntity } from './entities/message.entity';

import { UserEntity } from '../user/entities/user.entity';
import { ItemEntity } from '../item/entities/item.entity';
import { ItemRequestEntity } from '../item-request/entities/item-request.entity';
import { BlockedUser } from '../moderation/entities/blocked-user.entity';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      UserEntity,
      ItemEntity,
      ItemRequestEntity,
      BlockedUser,
    ]),
    CloudinaryModule,
    // The gateway authenticates handshakes itself rather than through the
    // passport strategy, which is HTTP-only. Same secret, same session check.
    AuthModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'defaultSecret',
      }),
    }),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatRealtimeService],
  // Exported so the item-request flow can drop system messages into a thread.
  exports: [ChatService],
})
export class ChatModule {}
