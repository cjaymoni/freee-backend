import { instanceToPlain } from 'class-transformer';
import { Repository } from 'typeorm';
import { ItemViewService } from './item-view.service';
import { ItemViewEntity } from './entities/item-view.entity';
import { ItemEntity } from '../item/entities/item.entity';
import { SystemEventService } from '../audit/system-event.service';

describe('ItemViewService.getUserViewHistory', () => {
  it("returns the item owner's public profile only", async () => {
    const owner = {
      id: 'owner-1',
      first_name: 'Kofi',
      email: 'owner@example.com',
      fcm_token: 'secret-fcm-token',
      date_of_birth: '1990-01-01',
      firebase_uid: 'fb-owner',
      failed_login_attempts: 2,
    };
    const view = {
      id: 'v1',
      item_id: 'item-1',
      viewer_id: 'me',
      ip_address: '1.2.3.4',
      created_at: new Date(),
      item: { id: 'item-1', user_id: 'owner-1', user: owner, images: [] },
    };
    const service = new ItemViewService(
      {
        findAndCount: jest.fn().mockResolvedValue([[view], 1]),
      } as unknown as Repository<ItemViewEntity>,
      {} as Repository<ItemEntity>,
      {} as SystemEventService,
    );

    const result = await service.getUserViewHistory('me');
    const json = JSON.stringify(instanceToPlain(result));

    expect(json).toContain('Kofi');
    for (const secret of [
      'owner@example.com',
      'secret-fcm-token',
      '1990-01-01',
      'fb-owner',
      'failed_login_attempts',
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});
