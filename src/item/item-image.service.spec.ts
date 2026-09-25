import { BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ItemImageService } from './item-image.service';
import { ItemImageEntity } from './entities/item-image.entity';
import { ItemEntity } from './entities/item.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateItemImageDto } from './dto/create-item-image.dto';

describe('ItemImageService Cloudinary ownership', () => {
  const item = { id: 'item-1', user_id: 'owner', is_deleted: false };
  let images: {
    exists: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    findOne: jest.Mock;
  };
  let cloudinary: { deleteImagesQuietly: jest.Mock };
  let service: ItemImageService;

  const dto = (publicId: string) =>
    ({
      cloudinary_public_id: publicId,
      cloudinary_url: 'https://x/a.jpg',
      cloudinary_secure_url: 'https://x/a.jpg',
    }) as CreateItemImageDto;

  beforeEach(() => {
    images = {
      exists: jest.fn().mockResolvedValue(false),
      count: jest.fn().mockResolvedValue(2),
      create: jest.fn((row: object) => row),
      save: jest.fn((row: object) => Promise.resolve({ id: 'img', ...row })),
      update: jest.fn(),
      findOne: jest.fn(),
    };
    cloudinary = { deleteImagesQuietly: jest.fn() };
    service = new ItemImageService(
      images as unknown as Repository<ItemImageEntity>,
      {
        findOne: jest.fn().mockResolvedValue(item),
      } as unknown as Repository<ItemEntity>,
      cloudinary as unknown as CloudinaryService,
    );
  });

  it("refuses to register another asset, such as a user's avatar", async () => {
    await expect(
      service.create('owner', 'item-1', dto('avatars/user_victim')),
    ).rejects.toThrow(BadRequestException);
    expect(images.save).not.toHaveBeenCalled();
  });

  it('refuses an item image that is already attached somewhere', async () => {
    images.exists.mockResolvedValue(true);
    await expect(
      service.create('owner', 'item-1', dto('items/someone-elses')),
    ).rejects.toThrow(ConflictException);
    expect(images.save).not.toHaveBeenCalled();
  });

  it('registers an unused item image', async () => {
    await service.create('owner', 'item-1', dto('items/fresh'));
    expect(images.save).toHaveBeenCalled();
  });

  it('never destroys a non-item asset when an image row is deleted', async () => {
    // A row registered before this fix could still point at an avatar.
    images.findOne.mockResolvedValue({
      id: 'img',
      item_id: 'item-1',
      item,
      is_primary: false,
      cloudinary_public_id: 'avatars/user_victim',
    });
    await service.remove('owner', 'img');
    expect(cloudinary.deleteImagesQuietly).not.toHaveBeenCalled();
  });
});
