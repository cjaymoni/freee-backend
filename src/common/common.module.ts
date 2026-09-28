import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AppLogger } from './logger.service';
import { SecretsService } from './secrets.service';

@Global()
@Module({
  providers: [DatabaseService, AppLogger, SecretsService],
  exports: [DatabaseService, AppLogger, SecretsService],
})
export class CommonModule {}
