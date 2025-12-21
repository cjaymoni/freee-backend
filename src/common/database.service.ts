import { neon } from '@neondatabase/serverless';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DatabaseService {
  private readonly sql;

  constructor(private configService: ConfigService) {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    if (databaseUrl) {
      this.sql = neon(databaseUrl);
    }
  }

  /**
   * Execute a raw SQL query using the Neon serverless driver.
   * Useful for lightning-fast edge-ready queries.
   */
  async query(strings: TemplateStringsArray, ...params: any[]) {
    if (!this.sql) {
      throw new Error(
        'DATABASE_URL is not configured for Neon serverless service',
      );
    }
    return this.sql(strings, ...params);
  }
}
