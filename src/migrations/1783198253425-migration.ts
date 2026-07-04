import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1783198253425 implements MigrationInterface {
    name = 'Migration1783198253425'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "item_requests" DROP COLUMN "pickup_time"`);
        await queryRunner.query(`ALTER TABLE "item_requests" DROP COLUMN "pickup_date"`);
        await queryRunner.query(`ALTER TABLE "item_requests" ADD "pickup_date" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "item_requests" DROP COLUMN "pickup_date"`);
        await queryRunner.query(`ALTER TABLE "item_requests" ADD "pickup_date" date`);
        await queryRunner.query(`ALTER TABLE "item_requests" ADD "pickup_time" TIME`);
    }

}
