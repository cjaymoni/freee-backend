import { Raw } from 'typeorm';

/** The windows any caller may ask for. Fixed strings, never user input. */
export type Interval = '60 seconds' | '1 hour' | '1 day';

/**
 * Matches rows whose column is inside the last `interval`, measured by the
 * database clock.
 *
 * Columns like `created_at` are filled by the database, so a window on one
 * has to be measured against the same clock. Computing the cutoff in Node
 * instead makes the window drift by whatever the two clocks disagree by,
 * which on a managed Postgres is not guaranteed to be nothing.
 */
export const withinLast = (interval: Interval) =>
  Raw((column) => `${column} > CURRENT_TIMESTAMP - INTERVAL '${interval}'`);
