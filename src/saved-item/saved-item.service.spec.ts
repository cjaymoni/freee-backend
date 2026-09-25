import { Repository } from 'typeorm';
import { SavedItemService } from './saved-item.service';
import { SavedItemEntity } from './entities/saved-item.entity';
import { ItemEntity } from '../item/entities/item.entity';

describe('SavedItemService.getUserSavedItems', () => {
  it('returns saved items as saved, without removed items or photos', async () => {
    const savedRepo = {
      findAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 's1',
            user_id: 'me',
            item_id: 'item-1',
            is_deleted: false,
            item: {
              id: 'item-1',
              user_id: 'owner',
              user: { id: 'owner', first_name: 'Ama' },
              images: [
                { id: 'img-1', display_order: 0, is_deleted: false },
                { id: 'img-2', display_order: 1, is_deleted: true },
              ],
            },
          },
        ],
        1,
      ]),
    };
    const itemRepo = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ user_id: 'owner', count: '4' }]),
      })),
    };
    const service = new SavedItemService(
      savedRepo as unknown as Repository<SavedItemEntity>,
      itemRepo as unknown as Repository<ItemEntity>,
    );

    const result = await service.getUserSavedItems('me');

    const where = (
      savedRepo.findAndCount.mock.calls[0] as [{ where: object }]
    )[0].where;
    expect(where).toMatchObject({ item: { is_deleted: false } });
    const item = result.data[0].item!;
    expect(item.is_saved).toBe(true);
    expect(item.images!.map((image) => image.id)).toEqual(['img-1']);
    expect(item.user!.items_count).toBe(4);
  });
});
