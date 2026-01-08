import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemService } from './item.service';
import { ItemController } from './item.controller';
import { ItemEntity } from './entities/item.entity';
import { ItemImageEntity } from './entities/item-image.entity';
import { ItemImageService } from './item-image.service';
import { ItemImageController } from './item-image.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ItemEntity, ItemImageEntity])],
  controllers: [ItemController, ItemImageController],
  providers: [ItemService, ItemImageService],
  exports: [ItemService, ItemImageService],
})
export class ItemModule {}
