import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPickupTypeToItems1781799146619 implements MigrationInterface {
    name = 'AddPickupTypeToItems1781799146619'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "items" ADD "pickup_time" TIME`);
        await queryRunner.query(`CREATE TYPE "public"."items_pickup_type_enum" AS ENUM('anytime', 'contact_me', 'specific_date')`);
        await queryRunner.query(`ALTER TABLE "items" ADD "pickup_type" "public"."items_pickup_type_enum"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "pickup_type"`);
        await queryRunner.query(`DROP TYPE "public"."items_pickup_type_enum"`);
        await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "pickup_time"`);
    }

}
