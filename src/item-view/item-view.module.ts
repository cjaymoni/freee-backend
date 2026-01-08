import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemViewController } from './item-view.controller';
import { ItemViewService } from './item-view.service';
import { ItemViewEntity } from './entities/item-view.entity';
import { ItemEntity } from '../item/entities/item.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ItemViewEntity, ItemEntity])],
  controllers: [ItemViewController],
  providers: [ItemViewService],
  exports: [ItemViewService],
})
export class ItemViewModule {}
