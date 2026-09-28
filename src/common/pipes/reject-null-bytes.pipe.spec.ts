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

describe('RejectNullBytesPipe edge cases', () => {
  const pipe = new RejectNullBytesPipe();

  it('checks route params', () => {
    expect(() =>
      pipe.transform('abc\u0000', { type: 'param', data: 'id' }),
    ).toThrow(new BadRequestException('id must not contain a NUL character'));
  });

  it('leaves buffers and class instances untouched', () => {
    const buffer = Buffer.from('a\u0000b');
    class Upload {
      name = 'x\u0000';
    }
    const upload = new Upload();
    expect(pipe.transform(buffer, { type: 'body' })).toBe(buffer);
    expect(pipe.transform({ file: upload }, { type: 'body' })).toEqual({
      file: upload,
    });
  });

  it('walks a very deeply nested body without overflowing the stack', () => {
    const depth = 200_000;
    const deep = JSON.parse(
      '['.repeat(depth) + '"\\u0000"' + ']'.repeat(depth),
    ) as unknown;
    const ok = JSON.parse('['.repeat(depth) + ']'.repeat(depth)) as unknown;

    expect(() => pipe.transform(ok, { type: 'body' })).not.toThrow();
    expect(() => pipe.transform(deep, { type: 'body' })).toThrow(
      BadRequestException,
    );
  });

  it('keeps the echoed path short however deep the NUL sits', () => {
    const depth = 10_000;
    const deep = JSON.parse(
      '['.repeat(depth) + '"\\u0000"' + ']'.repeat(depth),
    ) as unknown;
    let message = '';
    try {
      pipe.transform(deep, { type: 'body' });
    } catch (error) {
      message = (error as BadRequestException).message;
    }
    expect(message).toMatch(/^body\[0\]\[0\].*….*\[0\] must not contain/);
    expect(message.length).toBeLessThan(260);
  });

  it('reports the first NUL in document order, keys included', () => {
    const value = { a: { b: 'x\u0000' }, ['c\u0000']: 1 };
    expect(() => pipe.transform(value, { type: 'body' })).toThrow(
      'body.a.b must not contain a NUL character',
    );
    const keyFirst = { ['c\u0000']: 1, a: { b: 'x\u0000' } };
    expect(() => pipe.transform(keyFirst, { type: 'body' })).toThrow(
      'body key must not contain a NUL character',
    );
  });
});
