/**
 * For @Transform on query DTOs. Query strings arrive as text, so map
 * "true"/"false" onto booleans; anything else is left for @IsBoolean to reject.
 */
export const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;
