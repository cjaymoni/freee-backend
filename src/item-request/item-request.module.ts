import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemRequestController } from './item-request.controller';
import { ItemRequestService } from './item-request.service';
import { ItemRequestEntity } from './entities/item-request.entity';
import { ItemEntity } from '../item/entities/item.entity';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ItemRequestEntity, ItemEntity]),
    // Request transitions post system messages into the two users' thread.
    ChatModule,
  ],
  controllers: [ItemRequestController],
  providers: [ItemRequestService],
  exports: [ItemRequestService],
})
export class ItemRequestModule {}
