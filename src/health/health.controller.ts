import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import Redis from 'ioredis';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    @Inject('REDIS_CLIENT') private redisClient: Redis,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Check application health' })
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      async () => {
        try {
          await this.redisClient.ping();
          return { redis: { status: 'up' } };
        } catch (error: any) {
          const message =
            error instanceof Error ? error.message : String(error);
          return { redis: { status: 'down', message } };
        }
      },
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024), // 150MB
      () =>
        this.disk.checkStorage('storage', {
          path: '/',
          threshold: 2 * 1024 * 1024,
        }), // 2GB
    ]);
  }
}
