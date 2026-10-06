import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { UserModule } from '../user/user.module';
import { ItemModule } from '../item/item.module';
import { FoundingFreerController } from './founding-freer.controller';
import { FoundingFreerService } from './founding-freer.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), UserModule, ItemModule],
  controllers: [FoundingFreerController],
  providers: [FoundingFreerService],
})
export class FoundingFreerModule {}
