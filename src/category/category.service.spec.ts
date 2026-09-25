import { Repository } from 'typeorm';
import { CategoryService } from './category.service';
import { CategoryEntity } from './entities/category.entity';

type Row = Partial<CategoryEntity> & { id: string };

describe('CategoryService', () => {
  let rows: Row[];
  let repo: {
    findOne: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let service: CategoryService;

  beforeEach(() => {
    rows = [];
    repo = {
      findOne: jest.fn(({ where }: { where: Partial<Row> }) =>
        Promise.resolve(
          rows.find((row) =>
            Object.entries(where).every(
              ([key, value]) => row[key as keyof Row] === value,
            ),
          ) ?? null,
        ),
      ),
      update: jest.fn((id: string, patch: Partial<Row>) => {
        Object.assign(rows.find((row) => row.id === id)!, patch);
        return Promise.resolve();
      }),
      create: jest.fn((data: object) => ({ id: 'new', ...data })),
      save: jest.fn((row: object) => Promise.resolve(row)),
    };
    service = new CategoryService(
      repo as unknown as Repository<CategoryEntity>,
    );
  });

  describe('slugs', () => {
    it("takes over a deleted category's slug", async () => {
      rows = [{ id: 'old', slug: 'garage', is_deleted: true }];

      const result = await service.create({ name: 'Garage', slug: 'garage' });

      expect(result.statusCode).toBe(201);
      expect(rows[0].slug).toBe('garage~old');
    });

    it('still refuses a live duplicate', async () => {
      rows = [{ id: 'live', slug: 'garage', is_deleted: false }];

      await expect(
        service.create({ name: 'Garage', slug: 'garage' }),
      ).rejects.toThrow("Category with slug 'garage' already exists");
    });
  });

  it('refuses to move a category under its own descendant', async () => {
    rows = [
      { id: 'a', parent_category_id: null, is_deleted: false },
      { id: 'b', parent_category_id: 'a', is_deleted: false },
      { id: 'c', parent_category_id: 'b', is_deleted: false },
    ];

    await expect(
      service.update('a', { parent_category_id: 'c' }),
    ).rejects.toThrow('cannot be moved under one of its own subcategories');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('shows only live, active subcategories on the detail view', async () => {
    rows = [
      {
        id: 'a',
        is_deleted: false,
        subcategories: [
          { id: 'live', is_deleted: false, is_active: true },
          { id: 'deleted', is_deleted: true, is_active: true },
          { id: 'inactive', is_deleted: false, is_active: false },
        ] as CategoryEntity[],
      },
    ];

    const result = await service.findOne('a');

    expect(result.data.subcategories!.map((sub) => sub.id)).toEqual(['live']);
  });
});
