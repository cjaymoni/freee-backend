import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisOptions } from 'ioredis';

export const redisConfig = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService): RedisOptions => ({
    host: configService.get<string>('REDIS_HOST'),
    port: configService.get<number>('REDIS_PORT'),
  }),
};
