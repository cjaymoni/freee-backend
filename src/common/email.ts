import { Transform } from 'class-transformer';

/**
 * The one form an email is stored and looked up in. The users.email unique
 * constraint is case-sensitive while mail delivery isn't, so without this
 * `Ama@Gmail.com` and the `ama@gmail.com` a Google sign-in carries would be
 * two accounts. Blank input gives undefined, never ''.
 */
export function normalizeEmail(
  email: string | null | undefined,
): string | undefined {
  return email?.trim().toLowerCase() || undefined;
}

/**
 * Normalizes an email field of a request body; see {@link normalizeEmail}.
 * A blank email on an optional field therefore counts as not sent.
 */
export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  );
