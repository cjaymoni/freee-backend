import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppEnv, resolveAppEnv } from '../config/app-env';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  /**
   * Named once at boot so every probe says which deployment answered;
   * staging and production otherwise look identical. See config/app-env.ts.
   */
  private readonly environment: AppEnv;

  /**
   * The commit this instance is running, when the host says. Render sets
   * RENDER_GIT_COMMIT; elsewhere pass GIT_COMMIT at deploy time. CI waits on
   * this to know the new build is live rather than the one it replaced.
   */
  private readonly commit?: string;

  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    @InjectDataSource() private dataSource: DataSource,
    configService: ConfigService,
  ) {
    this.environment = resolveAppEnv({
      APP_ENV: configService.get<string>('APP_ENV'),
      NODE_ENV: configService.get<string>('NODE_ENV'),
    });
    this.commit =
      configService.get<string>('RENDER_GIT_COMMIT') ??
      configService.get<string>('GIT_COMMIT');
  }

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Check application health' })
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
    ]);
  }

  @Get('db')
  @ApiOperation({ summary: 'Check database connection' })
  async checkDatabase() {
    try {
      await this.dataSource.query('SELECT 1');
      return {
        status: 'ok',
        environment: this.environment,
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'error',
        environment: this.environment,
        database: 'disconnected',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check if application is ready' })
  readiness() {
    return {
      status: 'ready',
      environment: this.environment,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  @ApiOperation({ summary: 'Check if application is alive' })
  liveness() {
    return {
      status: 'alive',
      environment: this.environment,
      commit: this.commit,
      timestamp: new Date().toISOString(),
    };
  }
}
