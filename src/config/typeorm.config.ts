import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import type { LogLevel } from 'typeorm';

export const typeOrmConfig: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const databaseUrl = configService.get<string>('DATABASE_URL');
    const isProduction = configService.get<string>('NODE_ENV') === 'production';

    const baseConfig = {
      type: 'postgres' as const,
      autoLoadEntities: true,
      synchronize: !isProduction,
      migrations: ['dist/migrations/*.js'],
      migrationsRun: isProduction,
      // Connection pooling configuration
      extra: {
        max: configService.get<number>('DB_POOL_MAX', 10),
        min: 0,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 10000,
      },
      // Logging
      logging: ['error', 'warn'] as LogLevel[],
      logger: 'advanced-console' as const,
      // Connection retry
      retryAttempts: 3,
      retryDelay: 3000,
    };

    if (databaseUrl) {
      return {
        ...baseConfig,
        url: databaseUrl,
        synchronize: false, // Force false for remote databases
        ssl: {
          rejectUnauthorized: false,
        },
        extra: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 10000,
        },
      };
    }

    return {
      ...baseConfig,
      host: configService.get<string>('DB_HOST'),
      port: configService.get<number>('DB_PORT'),
      username: configService.get<string>('DB_USERNAME'),
      password: configService.get<string>('DB_PASSWORD'),
      database: configService.get<string>('DB_DATABASE'),
    };
  },
};
