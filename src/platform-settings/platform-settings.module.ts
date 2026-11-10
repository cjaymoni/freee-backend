import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSettingEntity } from './entities/platform-setting.entity';
import { PlatformSettingsService } from './platform-settings.service';

/**
 * Global so that any service can read a limit without its module having to
 * import this one - the settings cut across listings, requests, chat and
 * auth, and threading an import through all of them buys nothing.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PlatformSettingEntity])],
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
