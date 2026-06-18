import { MigrationInterface, QueryRunner } from "typeorm";

export class AddQuantityToItems1781799549043 implements MigrationInterface {
    name = 'AddQuantityToItems1781799549043'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "items" ADD "quantity" integer NOT NULL DEFAULT '1'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "quantity"`);
    }

}
