import type { ConfigService } from '@nestjs/config';

/**
 * The key every access token is signed and verified with.
 *
 * Throws rather than falling back to a default: a fallback would be a key
 * anyone can read in the source, so a missing setting would quietly let
 * anyone mint tokens the API and the chat socket accept. Startup validation
 * (env.validation.ts) already requires it; this keeps every caller safe
 * when built without that, as in scripts or test modules.
 *
 * @throws Error when JWT_SECRET is unset or blank.
 */
export function jwtSecret(config: ConfigService): string {
  return requireJwtSecret(config.get<string>('JWT_SECRET'));
}

/**
 * The rule {@link jwtSecret} applies, for a value read some other way, so
 * every reader of the secret refuses the same things.
 *
 * @throws Error when the value is unset or blank.
 */
export function requireJwtSecret(secret: string | undefined): string {
  if (!secret?.trim()) {
    throw new Error('JWT_SECRET is not set; refusing to sign or verify tokens');
  }
  return secret;
}
