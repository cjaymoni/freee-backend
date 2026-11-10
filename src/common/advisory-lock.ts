import type { EntityManager } from 'typeorm';

/**
 * Namespaces for Postgres advisory locks.
 *
 * Advisory locks share one key space per database, so two unrelated locks
 * derived from the same id - a user's listing cap and the same user's request
 * cap, say - would serialise against each other for no reason. The
 * two-argument form takes a namespace alongside the id, which keeps each call
 * site's locks to itself. Add a new constant rather than reusing one.
 */
export const LockNamespace = {
  /** Counting a user's listings against the per-user caps. */
  LISTING_CAP: 1,
  /** Counting a user's requests against the per-user caps. */
  REQUEST_CAP: 2,
} as const;

export type LockNamespace = (typeof LockNamespace)[keyof typeof LockNamespace];

/**
 * Takes a transaction-scoped advisory lock on one user, so a check-then-act
 * on their rows cannot be raced by their own concurrent request.
 *
 * Released when the surrounding transaction ends, commit or rollback, so
 * there is nothing to unlock by hand. `hashtext` maps the uuid onto the int4
 * the lock takes; a collision would only make two users queue behind each
 * other briefly, never let one past a cap.
 *
 * Call it before the first read of the rows being counted, and always in the
 * same order relative to any row lock the same path takes - see the callers.
 */
export async function lockUser(
  manager: EntityManager,
  namespace: LockNamespace,
  userId: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
    namespace,
    userId,
  ]);
}
