/**
 * Which deployment this process is.
 *
 * Staging and production both boot with `NODE_ENV=production`, because that is
 * what makes TypeORM run migrations and keep `synchronize` off (see
 * typeorm.config.ts). `APP_ENV` is what tells the two apart in logs and on the
 * health endpoints, so a request to the wrong host is obvious.
 */
export const APP_ENVS = [
  'development',
  'test',
  'staging',
  'production',
] as const;

export type AppEnv = (typeof APP_ENVS)[number];

function isAppEnv(value: string | undefined): value is AppEnv {
  return APP_ENVS.includes(value as AppEnv);
}

/**
 * Names the deployment, preferring an explicit `APP_ENV` and falling back to
 * `NODE_ENV`, so a host that only sets `NODE_ENV` still answers sensibly.
 *
 * @param env Process environment, or any object carrying APP_ENV / NODE_ENV.
 * @returns The deployment name; `development` when neither variable names one.
 */
export function resolveAppEnv(env: {
  APP_ENV?: string;
  NODE_ENV?: string;
}): AppEnv {
  const declared = env.APP_ENV?.trim().toLowerCase();
  if (isAppEnv(declared)) {
    return declared;
  }

  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === 'production' || nodeEnv === 'test') {
    return nodeEnv;
  }

  return 'development';
}
