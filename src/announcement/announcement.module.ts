import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { AnnouncementEntity } from './entities/announcement.entity';

/** In-app banners. The back office manages them through AdminModule. */
@Module({
  imports: [TypeOrmModule.forFeature([AnnouncementEntity])],
  controllers: [AnnouncementController],
  providers: [AnnouncementService],
  exports: [AnnouncementService],
})
export class AnnouncementModule {}
