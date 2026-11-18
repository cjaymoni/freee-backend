import type { ConfigService } from '@nestjs/config';
import { jwtSecret } from './jwt-secret';

const configWith = (value: unknown) =>
  ({ get: () => value }) as unknown as ConfigService;

describe('jwtSecret', () => {
  it('returns the configured secret', () => {
    expect(jwtSecret(configWith('a-real-secret'))).toBe('a-real-secret');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('refuses a secret that is %s', (_label, value) => {
    expect(() => jwtSecret(configWith(value))).toThrow('JWT_SECRET is not set');
  });
});
