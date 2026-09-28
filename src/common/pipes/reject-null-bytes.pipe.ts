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

/** Longest path echoed in the error; deep bodies would otherwise echo MBs. */
const MAX_PATH_LENGTH = 200;

/** A value still to check, linked to its parent to name it if it fails. */
interface Node {
  value: unknown;
  parent?: Node;
  step: string;
  /** Its key in the parent object holds a NUL. */
  badKey?: boolean;
}

/**
 * Path to the first string holding a NUL, in parsed JSON or a query. Walks
 * with its own stack rather than recursion, and only spells out a path once
 * something fails, so a deeply nested body costs linear time and memory
 * instead of overflowing the call stack and surfacing as a 500.
 */
function findNullByte(root: unknown, rootPath: string): string | undefined {
  const stack: Node[] = [{ value: root, step: rootPath }];
  while (stack.length) {
    const node = stack.pop()!;
    const { value } = node;
    // Checked on visit, not on push, so the first NUL in document order is
    // the one reported.
    if (node.badKey) return `${pathOf(node.parent!)} key`;
    if (typeof value === 'string') {
      if (value.includes('\u0000')) return pathOf(node);
    } else if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({ value: value[i], parent: node, step: `[${i}]` });
      }
    } else if (isPlainObject(value)) {
      const entries = Object.entries(value);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [key, child] = entries[i];
        stack.push({
          value: child,
          parent: node,
          step: `.${key}`,
          badKey: key.includes('\u0000'),
        });
      }
    }
  }
  return undefined;
}

/** The node's path, cut in the middle if long. */
function pathOf(node: Node): string {
  const steps: string[] = [];
  for (let at: Node | undefined = node; at; at = at.parent) steps.push(at.step);
  const path = steps.reverse().join('');
  if (path.length <= MAX_PATH_LENGTH) return path;
  const half = Math.floor((MAX_PATH_LENGTH - 1) / 2);
  return `${path.slice(0, half)}…${path.slice(-half)}`;
}

/**
 * Only plain objects: files and other class instances are not client text.
 * Express parses query strings into objects with no prototype at all.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
