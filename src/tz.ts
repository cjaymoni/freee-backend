// Every timestamp column is `timestamp` without time zone, and node-postgres
// sends and reads Dates in the process's local time. Pinning the process to
// UTC keeps stored times, date-range filters and day boundaries consistent
// wherever the API runs. Imported first by main.ts so nothing creates a Date
// before it applies.
process.env.TZ = 'UTC';
