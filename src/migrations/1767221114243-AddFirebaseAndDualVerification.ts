import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFirebaseAndDualVerification1767221114243 implements MigrationInterface {
  name = 'AddFirebaseAndDualVerification1767221114243';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "is_verified"`,
    );

    const checkEmailVerified = (await queryRunner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='is_email_verified'`,
    )) as { column_name: string }[];
    if (checkEmailVerified.length === 0) {
      await queryRunner.query(
        `ALTER TABLE "users" ADD "is_email_verified" boolean NOT NULL DEFAULT false`,
      );
    }

    const checkPhoneVerified = (await queryRunner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='is_phone_verified'`,
    )) as { column_name: string }[];
    if (checkPhoneVerified.length === 0) {
      await queryRunner.query(
        `ALTER TABLE "users" ADD "is_phone_verified" boolean NOT NULL DEFAULT false`,
      );
    }

    const checkFcmToken = (await queryRunner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='fcm_token'`,
    )) as { column_name: string }[];
    if (checkFcmToken.length === 0) {
      await queryRunner.query(`ALTER TABLE "users" ADD "fcm_token" text`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "fcm_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "is_phone_verified"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "is_email_verified"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "is_verified" boolean NOT NULL DEFAULT false`,
    );
  }
}
