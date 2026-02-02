import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { typeOrmConfig } from './config/typeorm.config';
import { RedisModule } from './redis/redis.module';
import { UserModule } from './user/user.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { AuthModule } from './auth/auth.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-store';
import { ConfigService } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { CommonModule } from './common/common.module';
import { FirebaseModule } from './firebase/firebase.module';
import { ItemModule } from './item/item.module';
import { CategoryModule } from './category/category.module';
import { AuditModule } from './audit/audit.module';
import { AuditInterceptor } from './audit/interceptors/audit.interceptor';
import { SavedItemModule } from './saved-item/saved-item.module';
import { ItemViewModule } from './item-view/item-view.module';
import { ItemRequestModule } from './item-request/item-request.module';
import { ModerationModule } from './moderation/moderation.module';

import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    ScheduleModule.forRoot(),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const upstashUrl = configService.get<string>('UPSTASH_REDIS_REST_URL');
        const upstashToken = configService.get<string>(
          'UPSTASH_REDIS_REST_TOKEN',
        );

        if (upstashUrl && upstashToken) {
          const { Redis } = await import('@upstash/redis');
          const client = new Redis({
            url: upstashUrl,
            token: upstashToken,
          });

          return {
            store: {
              get: async (key: string) => {
                const val = await client.get(key);
                return val;
              },
              set: async (key: string, value: any, ttl?: number) => {
                if (ttl) {
                  await client.set(key, value, { px: ttl * 1000 });
                } else {
                  await client.set(key, value);
                }
              },
              del: async (key: string) => {
                await client.del(key);
              },
              reset: async () => {
                await client.flushall();
              },
            },
          };
        }

        return {
          store: (await redisStore({
            socket: {
              host: configService.get<string>('REDIS_HOST'),
              port: configService.get<number>('REDIS_PORT'),
            },
            password: configService.get<string>('REDIS_PASSWORD'),
            ttl: 600, // 10 minutes default
          })) as any,
        };
      },
      inject: [ConfigService],
    }),
    TypeOrmModule.forRootAsync(typeOrmConfig),
    RedisModule,
    CloudinaryModule,
    AuthModule,
    UserModule,
    ItemModule,
    CategoryModule,
    AuditModule,
    SavedItemModule,
    ItemViewModule,
    ItemRequestModule,
    ModerationModule,
    HealthModule,
    CommonModule,
    FirebaseModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
