import { resolveAppEnv } from './app-env';

describe('resolveAppEnv', () => {
  it.each(['development', 'test', 'staging', 'production'])(
    'uses APP_ENV=%s as given',
    (appEnv) => {
      expect(resolveAppEnv({ APP_ENV: appEnv, NODE_ENV: 'production' })).toBe(
        appEnv,
      );
    },
  );

  it('ignores case and surrounding space in APP_ENV', () => {
    expect(resolveAppEnv({ APP_ENV: '  Staging ' })).toBe('staging');
  });

  it.each([
    ['production', 'production'],
    ['test', 'test'],
    ['development', 'development'],
    ['provision', 'development'],
  ])('falls back to NODE_ENV=%s as %s', (nodeEnv, expected) => {
    expect(resolveAppEnv({ NODE_ENV: nodeEnv })).toBe(expected);
  });

  it.each([{}, { APP_ENV: '' }, { APP_ENV: 'prod', NODE_ENV: '' }])(
    'answers development for %j',
    (env) => {
      expect(resolveAppEnv(env)).toBe('development');
    },
  );

  it('does not let an unknown APP_ENV hide NODE_ENV', () => {
    expect(resolveAppEnv({ APP_ENV: 'prod', NODE_ENV: 'production' })).toBe(
      'production',
    );
  });
});
