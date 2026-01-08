import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItemImageEntity } from './entities/item-image.entity';
import { ItemEntity } from './entities/item.entity';
import { CreateItemImageDto } from './dto/create-item-image.dto';
import { ItemImageResponseDto } from './dto/item-image-response.dto';
import { ServiceResponseDto } from '../common/service-response.dto';

@Injectable()
export class ItemImageService {
  constructor(
    @InjectRepository(ItemImageEntity)
    private readonly imageRepository: Repository<ItemImageEntity>,
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
  ) {}

  /**
   * Add an image to an item
   */
  async create(
    userId: string,
    itemId: string,
    createDto: CreateItemImageDto,
  ): Promise<ServiceResponseDto<ItemImageResponseDto>> {
    // Verify item exists and user owns it
    const item = await this.itemRepository.findOne({
      where: { id: itemId, is_deleted: false },
    });

    if (!item) {
      throw new NotFoundException(`Item with ID ${itemId} not found`);
    }

    if (item.user_id !== userId) {
      throw new ForbiddenException('You can only add images to your own items');
    }

    // If setting as primary, unset other primary images
    if (createDto.is_primary) {
      await this.imageRepository.update(
        { item_id: itemId, is_primary: true, is_deleted: false },
        { is_primary: false },
      );
    }

    // If this is the first image, make it primary
    const imageCount = await this.imageRepository.count({
      where: { item_id: itemId, is_deleted: false },
    });

    const image = this.imageRepository.create({
      ...createDto,
      item_id: itemId,
      is_primary: createDto.is_primary || imageCount === 0,
    });

    const saved = await this.imageRepository.save(image);
    return {
      message: 'Image added successfully',
      data: ItemImageResponseDto.fromEntity(saved),
      state: true,
      statusCode: 201,
    };
  }

  /**
   * Get all images for an item
   */
  async findAllByItemId(
    itemId: string,
  ): Promise<ServiceResponseDto<ItemImageResponseDto[]>> {
    const images = await this.imageRepository.find({
      where: { item_id: itemId, is_deleted: false },
      order: { is_primary: 'DESC', display_order: 'ASC', created_at: 'ASC' },
    });

    return {
      message: 'Images retrieved successfully',
      data: images.map((image) => ItemImageResponseDto.fromEntity(image)),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Get a single image by ID
   */
  async findOne(
    imageId: string,
  ): Promise<ServiceResponseDto<ItemImageResponseDto>> {
    const image = await this.imageRepository.findOne({
      where: { id: imageId, is_deleted: false },
    });

    if (!image) {
      throw new NotFoundException(`Image with ID ${imageId} not found`);
    }

    return {
      message: 'Image retrieved successfully',
      data: ItemImageResponseDto.fromEntity(image),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Set an image as primary
   */
  async setPrimary(
    userId: string,
    imageId: string,
  ): Promise<ServiceResponseDto<ItemImageResponseDto>> {
    const image = await this.imageRepository.findOne({
      where: { id: imageId, is_deleted: false },
      relations: ['item'],
    });

    if (!image) {
      throw new NotFoundException(`Image with ID ${imageId} not found`);
    }

    if (image.item.user_id !== userId) {
      throw new ForbiddenException(
        'You can only modify images for your own items',
      );
    }

    // Unset other primary images for this item
    await this.imageRepository.update(
      { item_id: image.item_id, is_primary: true, is_deleted: false },
      { is_primary: false },
    );

    image.is_primary = true;
    const updated = await this.imageRepository.save(image);

    return {
      message: 'Image set as primary successfully',
      data: ItemImageResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Update display order
   */
  async updateDisplayOrder(
    userId: string,
    imageId: string,
    displayOrder: number,
  ): Promise<ServiceResponseDto<ItemImageResponseDto>> {
    const image = await this.imageRepository.findOne({
      where: { id: imageId, is_deleted: false },
      relations: ['item'],
    });

    if (!image) {
      throw new NotFoundException(`Image with ID ${imageId} not found`);
    }

    if (image.item.user_id !== userId) {
      throw new ForbiddenException(
        'You can only modify images for your own items',
      );
    }

    image.display_order = displayOrder;
    const updated = await this.imageRepository.save(image);

    return {
      message: 'Display order updated successfully',
      data: ItemImageResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Soft delete an image
   */
  async remove(
    userId: string,
    imageId: string,
  ): Promise<ServiceResponseDto<ItemImageResponseDto>> {
    const image = await this.imageRepository.findOne({
      where: { id: imageId, is_deleted: false },
      relations: ['item'],
    });

    if (!image) {
      throw new NotFoundException(`Image with ID ${imageId} not found`);
    }

    if (image.item.user_id !== userId) {
      throw new ForbiddenException(
        'You can only delete images from your own items',
      );
    }

    // Check if this is the last image
    const imageCount = await this.imageRepository.count({
      where: { item_id: image.item_id, is_deleted: false },
    });

    if (imageCount === 1) {
      throw new BadRequestException(
        'Cannot delete the last image. Items must have at least one image.',
      );
    }

    image.is_deleted = true;
    image.deleted_at = new Date();

    // If this was the primary image, set another image as primary
    if (image.is_primary) {
      const nextImage = await this.imageRepository.findOne({
        where: { item_id: image.item_id, is_deleted: false },
        order: { display_order: 'ASC', created_at: 'ASC' },
      });

      if (nextImage && nextImage.id !== image.id) {
        nextImage.is_primary = true;
        await this.imageRepository.save(nextImage);
      }
    }

    const deleted = await this.imageRepository.save(image);
    return {
      message: 'Image deleted successfully',
      data: ItemImageResponseDto.fromEntity(deleted),
      state: true,
      statusCode: 200,
    };
  }
}
