import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import IoRedis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';
import { redisConfig } from '../config/redis.config';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const upstashUrl = configService.get<string>('UPSTASH_REDIS_REST_URL');
        const upstashToken = configService.get<string>(
          'UPSTASH_REDIS_REST_TOKEN',
        );

        if (upstashUrl && upstashToken) {
          return new UpstashRedis({
            url: upstashUrl,
            token: upstashToken,
          });
        }

        const options = redisConfig.useFactory(configService);
        return new IoRedis(options);
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
