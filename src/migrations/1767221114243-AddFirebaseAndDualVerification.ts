import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFirebaseAndDualVerification1767221114243 implements MigrationInterface {
    name = 'AddFirebaseAndDualVerification1767221114243'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_verified"`);
        await queryRunner.query(`ALTER TABLE "users" ADD "is_email_verified" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD "is_phone_verified" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD "fcm_token" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "fcm_token"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_phone_verified"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_email_verified"`);
        await queryRunner.query(`ALTER TABLE "users" ADD "is_verified" boolean NOT NULL DEFAULT false`);
    }

}
