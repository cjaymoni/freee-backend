import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// Load environment variables
config();

/**
 * TypeORM DataSource configuration for migrations
 * This file is used by TypeORM CLI for generating and running migrations
 */
const databaseUrl = process.env.DATABASE_URL;

export const AppDataSource = new DataSource(
  databaseUrl
    ? {
        type: 'postgres',
        url: databaseUrl,
        entities: ['src/**/*.entity.ts'],
        migrations: ['src/migrations/*.ts'],
        synchronize: false,
        logging: process.env.NODE_ENV === 'development',
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_DATABASE || 'freee',
        entities: ['src/**/*.entity.ts'],
        migrations: ['src/migrations/*.ts'],
        synchronize: false,
        logging: process.env.NODE_ENV === 'development',
      },
);
