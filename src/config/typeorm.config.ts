import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';

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
    };

    if (databaseUrl) {
      return {
        ...baseConfig,
        url: databaseUrl,
        synchronize: false, // Force false for remote databases
        ssl: {
          rejectUnauthorized: false, // Required for Neon in many cases
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
