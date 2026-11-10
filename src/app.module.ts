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
import { SearchModule } from './search/search.module';
import { CategoryModule } from './category/category.module';
import { AuditModule } from './audit/audit.module';
import { AuditInterceptor } from './audit/interceptors/audit.interceptor';
import { SavedItemModule } from './saved-item/saved-item.module';
import { ItemViewModule } from './item-view/item-view.module';
import { ItemRequestModule } from './item-request/item-request.module';
import { ModerationModule } from './moderation/moderation.module';
import { ChatModule } from './chat/chat.module';
import { AdminModule } from './admin/admin.module';
import { LocationsModule } from './locations/locations.module';
import { FoundingFreerModule } from './founding-freer/founding-freer.module';
import { AnnouncementModule } from './announcement/announcement.module';

import { PageSizeInterceptor } from './common/interceptors/page-size.interceptor';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module';
import { PlatformSettingsService } from './platform-settings/platform-settings.service';

import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    PlatformSettingsModule,
    // Resolved per request so a limit changed in the back office applies
    // without a redeploy. @Throttle on a controller still wins for the
    // endpoints that carry their own limit, such as sending a sign-in code.
    ThrottlerModule.forRootAsync({
      imports: [PlatformSettingsModule],
      inject: [PlatformSettingsService],
      useFactory: (settings: PlatformSettingsService) => [
        {
          ttl: () => settings.get('rate_limits.window_seconds') * 1000,
          limit: () => settings.get('rate_limits.requests_per_window'),
        },
      ],
    }),
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
              reconnectStrategy: (retries: number) =>
                Math.min(retries * 100, 3000),
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
    SearchModule,
    CategoryModule,
    AuditModule,
    SavedItemModule,
    ItemViewModule,
    ItemRequestModule,
    ModerationModule,
    ChatModule,
    AdminModule,
    LocationsModule,
    FoundingFreerModule,
    AnnouncementModule,
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
    // Applies platform.max_page_size to every list endpoint, whichever way
    // that endpoint validates its paging. An interceptor, so it runs after
    // the route's own guards - see the class for why that matters.
    {
      provide: APP_INTERCEPTOR,
      useClass: PageSizeInterceptor,
    },
  ],
})
export class AppModule {}
