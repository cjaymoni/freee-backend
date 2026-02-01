import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AppLogger } from './logger.service';
import { SecretsService } from './secrets.service';
import { DistanceService } from './distance.service';

@Global()
@Module({
  providers: [DatabaseService, AppLogger, SecretsService, DistanceService],
  exports: [DatabaseService, AppLogger, SecretsService, DistanceService],
})
export class CommonModule {}
