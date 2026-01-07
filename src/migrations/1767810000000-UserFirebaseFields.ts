import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserFirebaseFields1767810000000 implements MigrationInterface {
  name = 'UserFirebaseFields1767810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Make phone_number nullable (it was NOT NULL in first migration)
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "phone_number" DROP NOT NULL`,
    );

    // 2. Drop phone_country_code if it exists (it's not in the entity)
    // We'll use a check since some environments might have already synced it differently
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "phone_country_code"`,
    );

    // 3. Add firebase_uid (nullable, unique)
    // We check for existence to avoid errors if partially synced
    const checkFirebaseUid = (await queryRunner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='firebase_uid'`,
    )) as { column_name: string }[];
    if (checkFirebaseUid.length === 0) {
      await queryRunner.query(
        `ALTER TABLE "users" ADD "firebase_uid" varchar(128)`,
      );
      await queryRunner.query(
        `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_firebase_uid" UNIQUE ("firebase_uid")`,
      );
    }

    // 4. Add is_onboarded (boolean, default false)
    const checkIsOnboarded = (await queryRunner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='is_onboarded'`,
    )) as { column_name: string }[];
    if (checkIsOnboarded.length === 0) {
      await queryRunner.query(
        `ALTER TABLE "users" ADD "is_onboarded" boolean NOT NULL DEFAULT false`,
      );
    }

    // 5. Create index if it doesn't exist
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_users_firebase_uid" ON "users" ("firebase_uid")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_firebase_uid"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "is_onboarded"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "UQ_users_firebase_uid"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "firebase_uid"`,
    );
    // We don't restore NOT NULL on phone_number as it might break existing data, but we could if needed.
  }
}
