import type { ConfigService } from '@nestjs/config';
import type {
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import type { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const build = (env: Record<string, string | undefined>, query = jest.fn()) =>
    new HealthController(
      {} as HealthCheckService,
      {} as TypeOrmHealthIndicator,
      {} as MemoryHealthIndicator,
      {} as DiskHealthIndicator,
      { query } as unknown as DataSource,
      { get: (key: string) => env[key] } as ConfigService,
    );

  it('names the deployment from APP_ENV', () => {
    const controller = build({ APP_ENV: 'staging', NODE_ENV: 'production' });

    expect(controller.liveness()).toMatchObject({
      status: 'alive',
      environment: 'staging',
    });
    expect(controller.readiness()).toMatchObject({
      status: 'ready',
      environment: 'staging',
    });
  });

  it('falls back to NODE_ENV when APP_ENV is unset', () => {
    expect(build({ NODE_ENV: 'production' }).liveness()).toMatchObject({
      environment: 'production',
    });
  });

  it('reports the commit Render deployed', () => {
    expect(
      build({ APP_ENV: 'staging', RENDER_GIT_COMMIT: 'abc123' }).liveness(),
    ).toMatchObject({ commit: 'abc123' });
  });

  it('accepts GIT_COMMIT from hosts that are not Render', () => {
    expect(
      build({ APP_ENV: 'production', GIT_COMMIT: 'def456' }).liveness(),
    ).toMatchObject({ commit: 'def456' });
  });

  it('leaves the commit out when no host set one', () => {
    expect(build({ APP_ENV: 'development' }).liveness().commit).toBeUndefined();
  });

  it('reports a reachable database with the deployment name', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);

    await expect(
      build({ APP_ENV: 'staging' }, query).checkDatabase(),
    ).resolves.toMatchObject({
      status: 'ok',
      environment: 'staging',
      database: 'connected',
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports why the database is unreachable', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(new Error('password authentication failed'));

    await expect(
      build({ APP_ENV: 'staging' }, query).checkDatabase(),
    ).resolves.toMatchObject({
      status: 'error',
      environment: 'staging',
      database: 'disconnected',
      error: 'password authentication failed',
    });
  });
});
