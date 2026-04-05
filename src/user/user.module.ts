import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserEntity } from './entities/user.entity';
import { LocationEntity } from './entities/location.entity';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { UserLocationService } from './user-location.service';
import { UserPreferenceService } from './user-preference.service';
import { UserLocationController } from './user-location.controller';
import { UserPreferenceController } from './user-preference.controller';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { CategoryEntity } from '../category/entities/category.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      LocationEntity,
      UserPreferenceEntity,
      CategoryEntity,
    ]),
    CloudinaryModule,
  ],
  controllers: [
    UserLocationController,
    UserPreferenceController,
    UserController,
  ],
  providers: [UserService, UserLocationService, UserPreferenceService],
  exports: [UserService, UserLocationService, UserPreferenceService],
})
export class UserModule {}
