import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItemEntity, ItemStatus } from './entities/item.entity';
import { ItemImageEntity } from './entities/item-image.entity';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemResponseDto } from './dto/item-response.dto';
import { ServiceResponseDto } from '../common/service-response.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { DistanceService } from '../common/distance.service';
import type { Express } from 'express';

@Injectable()
export class ItemService {
  constructor(
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
    @InjectRepository(ItemImageEntity)
    private readonly imageRepository: Repository<ItemImageEntity>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly distanceService: DistanceService,
  ) {}

  /**
   * Create a new item
   */
  async create(
    userId: string,
    createDto: CreateItemDto,
    files?: Express.Multer.File[],
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    // Validate price logic
    if (createDto.is_free && createDto.price && createDto.price > 0) {
      throw new BadRequestException(
        'Item cannot be marked as free if price is greater than 0',
      );
    }

    const item = this.itemRepository.create({
      ...createDto,
      user_id: userId,
      price: createDto.is_free ? 0 : createDto.price || 0,
    });

    const saved = await this.itemRepository.save(item);

    // Upload and associate images if provided
    if (files && files.length > 0) {
      const imageEntities: ItemImageEntity[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const uploadResult = await this.cloudinaryService.uploadImage(file, {
            folder: 'items',
          });

          const itemImage = this.imageRepository.create({
            item_id: saved.id,
            cloudinary_public_id: uploadResult.publicId,
            cloudinary_url: uploadResult.secureUrl,
            cloudinary_secure_url: uploadResult.secureUrl,
            cloudinary_format: uploadResult.format,
            width: uploadResult.width,
            height: uploadResult.height,
            size_bytes: uploadResult.bytes,
            display_order: i,
            is_primary: i === 0,
          });
          imageEntities.push(itemImage);
        } catch (error) {
          console.error(`Failed to upload file at index ${i} to Cloudinary:`, error);
        }
      }

      if (imageEntities.length > 0) {
        saved.images = await this.imageRepository.save(imageEntities);
      }
    }

    return {
      message: 'Item created successfully',
      data: ItemResponseDto.fromEntity(saved),
      state: true,
      statusCode: 201,
    };
  }

  /**
   * Get all items (with filters)
   */
  async findAll(filters?: {
    user_id?: string;
    category_id?: string;
    status?: ItemStatus;
    is_featured?: boolean;
    is_free?: boolean;
    lat?: number;
    lng?: number;
    radius?: number;
  }): Promise<ServiceResponseDto<ItemResponseDto[]>> {
    const query = this.itemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.location', 'location')
      .leftJoinAndSelect('item.user', 'user')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect(
        'item.images',
        'images',
        'images.is_deleted = :images_deleted',
        { images_deleted: false },
      )
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(ui.id)', 'count')
            .from('items', 'ui')
            .where('ui.user_id = user.id AND ui.is_deleted = false'),
        'user_items_count',
      )
      .where('item.is_deleted = :is_deleted', { is_deleted: false });

    if (filters?.user_id) {
      query.andWhere('item.user_id = :user_id', { user_id: filters.user_id });
    }

    if (filters?.category_id) {
      query.andWhere('item.category_id = :category_id', {
        category_id: filters.category_id,
      });
    }

    if (filters?.status) {
      query.andWhere('item.status = :status', { status: filters.status });
    }

    if (filters?.is_featured !== undefined) {
      query.andWhere('item.is_featured = :is_featured', {
        is_featured: filters.is_featured,
      });
    }

    if (filters?.is_free !== undefined) {
      query.andWhere('item.is_free = :is_free', { is_free: filters.is_free });
    }

    const { entities, raw } = await query
      .orderBy('item.created_at', 'DESC')
      .getRawAndEntities();

    const { lat, lng, radius = 10 } = filters ?? {};
    const filtered = (lat !== undefined && lng !== undefined)
      ? entities.filter((e) =>
          e.location?.latitude && e.location?.longitude
            ? this.distanceService.isWithinRadius(lat, lng, e.location.latitude, e.location.longitude, radius)
            : true,
        )
      : entities;

    filtered.forEach((entity, i) => {
      const rawIndex = entities.indexOf(entity);
      if (entity.user) {
        (entity.user as any).items_count = Number(raw[rawIndex]?.user_items_count ?? 0);
      }
    });

    return {
      message: 'Items retrieved successfully',
      data: filtered.map((item) => ItemResponseDto.fromEntity(item)),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Get a single item by ID
   */
  async findOne(id: string): Promise<ServiceResponseDto<ItemResponseDto>> {
    const item = await this.itemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.location', 'location')
      .leftJoinAndSelect('item.user', 'user')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect(
        'item.images',
        'images',
        'images.is_deleted = :images_deleted',
        { images_deleted: false },
      )
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(ui.id)', 'count')
            .from('items', 'ui')
            .where('ui.user_id = user.id AND ui.is_deleted = false'),
        'user_items_count',
      )
      .where('item.id = :id AND item.is_deleted = false', { id })
      .getRawAndEntities();

    if (!item.entities[0]) {
      throw new NotFoundException(`Item with ID ${id} not found`);
    }

    const entity = item.entities[0];
    const raw = item.raw[0];
    if (entity.user) {
      (entity.user as any).items_count = Number(raw?.user_items_count ?? 0);
    }

    // Increment view count
    await this.itemRepository.update(id, {
      view_count: () => 'view_count + 1',
    });

    return {
      message: 'Item retrieved successfully',
      data: ItemResponseDto.fromEntity(entity),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Update an item
   */
  async update(
    userId: string,
    itemId: string,
    updateDto: UpdateItemDto,
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    const item = await this.itemRepository.findOne({
      where: { id: itemId, is_deleted: false },
    });

    if (!item) {
      throw new NotFoundException(`Item with ID ${itemId} not found`);
    }

    // Check ownership
    if (item.user_id !== userId) {
      throw new ForbiddenException('You can only update your own items');
    }

    // Validate price logic
    if (updateDto.is_free && updateDto.price && updateDto.price > 0) {
      throw new BadRequestException(
        'Item cannot be marked as free if price is greater than 0',
      );
    }

    Object.assign(item, updateDto);

    // If marked as free, set price to 0
    if (updateDto.is_free) {
      item.price = 0;
    }

    const updated = await this.itemRepository.save(item);
    return {
      message: 'Item updated successfully',
      data: ItemResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Soft delete an item
   */
  async remove(
    userId: string,
    itemId: string,
    reason?: string,
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    const item = await this.itemRepository.findOne({
      where: { id: itemId, is_deleted: false },
    });

    if (!item) {
      throw new NotFoundException(`Item with ID ${itemId} not found`);
    }

    // Check ownership
    if (item.user_id !== userId) {
      throw new ForbiddenException('You can only delete your own items');
    }

    item.is_deleted = true;
    item.deleted_at = new Date();
    item.deleted_by = userId;
    item.deletion_reason = reason || 'Deleted by owner';
    item.status = ItemStatus.UNAVAILABLE;

    const deleted = await this.itemRepository.save(item);
    return {
      message: 'Item deleted successfully',
      data: ItemResponseDto.fromEntity(deleted),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Admin remove item (no ownership check)
   */
  async adminRemove(
    adminId: string,
    itemId: string,
    reason?: string,
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    const item = await this.itemRepository.findOne({
      where: { id: itemId, is_deleted: false },
    });

    if (!item) {
      throw new NotFoundException(`Item with ID ${itemId} not found`);
    }

    item.is_deleted = true;
    item.deleted_at = new Date();
    item.deleted_by = adminId;
    item.deletion_reason = reason || 'Removed by moderation';
    item.status = ItemStatus.UNAVAILABLE;

    const deleted = await this.itemRepository.save(item);
    return {
      message: 'Item removed successfully',
      data: ItemResponseDto.fromEntity(deleted),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Feature an item (Admin only)
   */
  async feature(
    itemId: string,
    featuredUntil?: Date,
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    const item = await this.itemRepository.findOne({
      where: { id: itemId, is_deleted: false },
    });

    if (!item) {
      throw new NotFoundException(`Item with ID ${itemId} not found`);
    }

    item.is_featured = true;
    item.featured_until = featuredUntil || null;

    const updated = await this.itemRepository.save(item);
    return {
      message: 'Item featured successfully',
      data: ItemResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Unfeature an item (Admin only)
   */
  async unfeature(
    itemId: string,
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    const item = await this.itemRepository.findOne({
      where: { id: itemId, is_deleted: false },
    });

    if (!item) {
      throw new NotFoundException(`Item with ID ${itemId} not found`);
    }

    item.is_featured = false;
    item.featured_until = null;

    const updated = await this.itemRepository.save(item);
    return {
      message: 'Item unfeatured successfully',
      data: ItemResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }
}
