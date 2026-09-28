import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { RejectNullBytesPipe } from './reject-null-bytes.pipe';

describe('RejectNullBytesPipe', () => {
  const pipe = new RejectNullBytesPipe();
  const body: ArgumentMetadata = { type: 'body' };
  const query = (data?: string): ArgumentMetadata => ({ type: 'query', data });

  it('passes ordinary input through untouched', () => {
    const value = { title: "O'Reilly; DROP --", tags: ['a', 'b'], n: 1 };
    expect(pipe.transform(value, body)).toBe(value);
  });

  it.each<[string, unknown, ArgumentMetadata, string]>([
    ['a named query param', 'chair\u0000', query('query'), 'query'],
    ['a nested body field', { a: { b: 'x\u0000' } }, body, 'body.a.b'],
    ['an array element', { tags: ['ok', '\u0000'] }, body, 'body.tags[1]'],
    ['an object key', { ['k\u0000']: 1 }, body, 'body key'],
    [
      'a query object with no prototype',
      Object.assign(Object.create(null) as object, { search: '\u0000' }),
      query(),
      'query.search',
    ],
  ])('rejects NUL in %s', (_, value, metadata, path) => {
    expect(() => pipe.transform(value, metadata)).toThrow(
      new BadRequestException(`${path} must not contain a NUL character`),
    );
  });

  it('leaves custom decorators alone', () => {
    expect(pipe.transform('\u0000', { type: 'custom' })).toBe('\u0000');
  });
});
