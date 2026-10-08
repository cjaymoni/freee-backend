import { StaffInboxService } from '../notification/staff-inbox.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { ItemService } from '../item/item.service';
import { CreateItemDto } from '../item/dto/create-item.dto';
import { ItemCondition, ModerationStatus } from '../item/entities/item.entity';
import { FoundingFreerService } from './founding-freer.service';
import { FOUNDING_REVIEW_REASON } from './founding-freer.constants';

describe('FoundingFreerService', () => {
  let users: { findOne: jest.Mock; update: jest.Mock };
  let itemService: { create: jest.Mock };
  let userService: { invalidateUserCache: jest.Mock };
  let staffInbox: { toAllStaff: jest.Mock };
  let open: string;

  const service = () =>
    new FoundingFreerService(
      users as unknown as Repository<UserEntity>,
      userService as unknown as UserService,
      itemService as unknown as ItemService,
      { get: () => open } as unknown as ConfigService,
      staffInbox as unknown as StaffInboxService,
    );

  const dto = {
    title: 'Chair',
    condition: ItemCondition.GOOD,
  } as CreateItemDto;
  const photo = [{ originalname: 'chair.jpg' }] as Express.Multer.File[];

  beforeEach(() => {
    open = 'true';
    users = { findOne: jest.fn(), update: jest.fn() };
    itemService = {
      create: jest.fn().mockResolvedValue({
        state: true,
        data: { id: 'item-1', title: 'Chair' },
      }),
    };
    staffInbox = { toAllStaff: jest.fn() };
    userService = { invalidateUserCache: jest.fn() };
  });

  describe('join', () => {
    it('marks the user and keeps an existing name', async () => {
      users.findOne.mockResolvedValue({ id: 'u1', first_name: 'Ama' });
      await service().join('u1', { first_name: 'Someone', last_name: 'Else' });
      const [, changes] = users.update.mock.calls[0] as [
        string,
        Partial<UserEntity>,
      ];
      expect(Object.keys(changes).sort()).toEqual([
        'founding_freer_since',
        'is_founding_freer',
      ]);
      expect(changes.is_founding_freer).toBe(true);
      expect(changes.founding_freer_since).toBeInstanceOf(Date);
      expect(userService.invalidateUserCache).toHaveBeenCalled();
    });

    it('fills a missing name', async () => {
      users.findOne.mockResolvedValue({ id: 'u1' });
      await service().join('u1', { first_name: ' Kofi ' });
      expect(users.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ first_name: 'Kofi', last_name: null }),
      );
    });

    it('keeps the original join date', async () => {
      const since = new Date('2026-09-01');
      users.findOne.mockResolvedValue({
        id: 'u1',
        founding_freer_since: since,
      });
      await service().join('u1', {});
      expect(users.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ founding_freer_since: since }),
      );
    });

    it('is refused once sign-up closes', async () => {
      open = 'false';
      await expect(service().join('u1', {})).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('createItem', () => {
    it('creates the item hidden, waiting for review', async () => {
      users.findOne.mockResolvedValue({ id: 'u1', is_founding_freer: true });
      await service().createItem('u1', dto, photo);
      expect(itemService.create).toHaveBeenCalledWith('u1', dto, photo, {
        moderation_status: ModerationStatus.HIDDEN,
        moderation_reason: FOUNDING_REVIEW_REASON,
      });
    });

    it('tells every other staff member it is waiting for review', async () => {
      users.findOne.mockResolvedValue({ id: 'u1', is_founding_freer: true });
      await service().createItem('u1', dto, photo);
      expect(staffInbox.toAllStaff).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'listing_awaiting_review',
          body: 'Chair',
          link: '/listings/item-1',
        }),
        'u1',
      );
    });

    it('needs the user to have joined', async () => {
      users.findOne.mockResolvedValue({ id: 'u1', is_founding_freer: false });
      await expect(service().createItem('u1', dto, photo)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('needs at least one photo', async () => {
      users.findOne.mockResolvedValue({ id: 'u1', is_founding_freer: true });
      await expect(service().createItem('u1', dto, [])).rejects.toThrow(
        BadRequestException,
      );
      expect(itemService.create).not.toHaveBeenCalled();
    });

    it('is refused once sign-up closes', async () => {
      open = 'false';
      await expect(service().createItem('u1', dto, photo)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
