import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

/**
 * Postgres cannot store or compare the NUL character in text, so any
 * `\u0000` that reaches a query fails it with a 500. Rejected here, for
 * everything a client sends, before any other pipe or the database sees it.
 */
@Injectable()
export class RejectNullBytesPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // Custom decorators read the signed-in user, not the request.
    if (metadata.type === 'custom') return value;
    const path = findNullByte(value, metadata.data ?? metadata.type);
    if (path !== undefined) {
      throw new BadRequestException(`${path} must not contain a NUL character`);
    }
    return value;
  }
}

/** Path to the first string holding a NUL, in parsed JSON or a query. */
function findNullByte(value: unknown, path: string): string | undefined {
  if (typeof value === 'string') {
    return value.includes('\u0000') ? path : undefined;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findNullByte(value[i], `${path}[${i}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  // Only plain objects: files and other class instances are not client text.
  // Express parses query strings into objects with no prototype at all.
  const proto: unknown = value ? Object.getPrototypeOf(value) : undefined;
  if (value && (proto === Object.prototype || proto === null)) {
    for (const [key, child] of Object.entries(value)) {
      if (key.includes('\u0000')) return `${path} key`;
      const found = findNullByte(child, `${path}.${key}`);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
