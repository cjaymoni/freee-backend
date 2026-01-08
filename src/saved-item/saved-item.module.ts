import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedItemController } from './saved-item.controller';
import { SavedItemService } from './saved-item.service';
import { SavedItemEntity } from './entities/saved-item.entity';
import { ItemEntity } from '../item/entities/item.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SavedItemEntity, ItemEntity])],
  controllers: [SavedItemController],
  providers: [SavedItemService],
  exports: [SavedItemService],
})
export class SavedItemModule {}
