import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { PageSizeInterceptor } from './page-size.interceptor';
import { stubPlatformSettings } from '../../platform-settings/testing/stub-platform-settings';

const PASSED = 'handler ran';

const nextHandler = (): CallHandler => ({ handle: () => of(PASSED) });

const contextFor = (
  query: Record<string, unknown>,
  type: 'http' | 'ws' = 'http',
): ExecutionContext =>
  ({
    getType: () => type,
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ query }) }),
  }) as unknown as ExecutionContext;

const interceptorWith = (max: number, skip = false) => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(skip),
  } as unknown as Reflector;
  return new PageSizeInterceptor(
    stubPlatformSettings({ 'platform.max_page_size': max }),
    reflector,
  );
};

/** What the handler returned, or the error the interceptor raised first. */
const run = (
  interceptor: PageSizeInterceptor,
  context: ExecutionContext,
): unknown => {
  let seen: unknown;
  interceptor
    .intercept(context, nextHandler())
    .subscribe((value) => (seen = value));
  return seen;
};

describe('PageSizeInterceptor', () => {
  it('lets a page inside the limit through', () => {
    expect(run(interceptorWith(50), contextFor({ limit: '50' }))).toBe(PASSED);
  });

  it('refuses a page over the limit', () => {
    expect(() => run(interceptorWith(50), contextFor({ limit: '51' }))).toThrow(
      'limit must be an integer between 1 and 50',
    );
  });

  it('leaves a request with no limit alone', () => {
    expect(run(interceptorWith(50), contextFor({}))).toBe(PASSED);
  });

  it('leaves a limit that is not a whole number to the DTO', () => {
    for (const limit of ['many', '1.5', '-5', '']) {
      expect(run(interceptorWith(50), contextFor({ limit }))).toBe(PASSED);
    }
  });

  it('leaves a repeated limit to the DTO, which reports it better', () => {
    expect(run(interceptorWith(50), contextFor({ limit: ['10', '99'] }))).toBe(
      PASSED,
    );
  });

  it('ignores anything that is not an HTTP request', () => {
    expect(run(interceptorWith(50), contextFor({ limit: '999' }, 'ws'))).toBe(
      PASSED,
    );
  });

  it('skips a handler that opted out, whatever the limit', () => {
    expect(run(interceptorWith(10, true), contextFor({ limit: '999' }))).toBe(
      PASSED,
    );
  });
});
