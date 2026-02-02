import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ReportedItem } from './entities/reported-item.entity';
import { ReportedUser } from './entities/reported-user.entity';
import { BlockedUser } from './entities/blocked-user.entity';
import { ModerationComplaint } from './entities/moderation-complaint.entity';
import { ItemModule } from '../item/item.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReportedItem, ReportedUser, BlockedUser, ModerationComplaint]),
    forwardRef(() => ItemModule),
    forwardRef(() => UserModule),
  ],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
