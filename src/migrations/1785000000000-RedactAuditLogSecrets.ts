import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit interceptor stored `request.body` verbatim, so every
 * POST /user and PATCH /user/:id wrote the user's plaintext password into
 * audit_logs.new_values. The interceptor now redacts before writing; this
 * migration cleans up the rows already on disk.
 *
 * Rows are kept and their sensitive keys overwritten rather than deleted, so
 * the audit trail itself stays intact.
 */
export class RedactAuditLogSecrets1785000000000 implements MigrationInterface {
  name = 'RedactAuditLogSecrets1785000000000';

  private static readonly SENSITIVE_KEYS = [
    'password',
    'password_hash',
    'currentPassword',
    'newPassword',
    'confirmPassword',
    'token',
    'idToken',
    'secret',
    'api_key',
    'access_token',
    'refresh_token',
    'session_token',
    'code',
    'confirmation_code',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // new_values / old_values are `json`, which has no key operators, so each
    // update round-trips through jsonb.
    for (const column of ['new_values', 'old_values']) {
      for (const key of RedactAuditLogSecrets1785000000000.SENSITIVE_KEYS) {
        await queryRunner.query(
          `
          UPDATE audit_logs
          SET "${column}" = (
            "${column}"::jsonb || jsonb_build_object($1::text, '[REDACTED]'::text)
          )::json
          WHERE "${column}" IS NOT NULL
            AND jsonb_typeof("${column}"::jsonb) = 'object'
            AND "${column}"::jsonb ? $1::text
            AND "${column}"::jsonb ->> $1::text IS DISTINCT FROM '[REDACTED]'
          `,
          [key],
        );
      }
    }
  }

  public async down(): Promise<void> {
    // Deliberately irreversible: the original values were credentials that
    // should never have been persisted, and are not recoverable.
  }
}
