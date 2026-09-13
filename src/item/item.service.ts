import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItemEntity, ItemStatus, PickupType } from './entities/item.entity';
import { ItemImageEntity } from './entities/item-image.entity';
import { LocationEntity } from '../user/entities/location.entity';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemResponseDto } from './dto/item-response.dto';
import { ServiceResponseDto } from '../common/service-response.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { DistanceService } from '../common/distance.service';
import { SavedItemEntity } from '../saved-item/entities/saved-item.entity';
import { ItemViewService } from '../item-view/item-view.service';
import type { Express } from 'express';

@Injectable()
export class ItemService {
  constructor(
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
    @InjectRepository(ItemImageEntity)
    private readonly imageRepository: Repository<ItemImageEntity>,
    @InjectRepository(SavedItemEntity)
    private readonly savedItemRepository: Repository<SavedItemEntity>,
    @InjectRepository(LocationEntity)
    private readonly locationRepository: Repository<LocationEntity>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly distanceService: DistanceService,
    private readonly itemViewService: ItemViewService,
  ) {}

  private async getSavedItemIds(userId?: string): Promise<Set<string>> {
    if (!userId) return new Set();
    const saved = await this.savedItemRepository.find({
      where: { user_id: userId, is_deleted: false },
      select: ['item_id'],
    });
    return new Set(saved.map((s) => s.item_id));
  }

  /**
   * A pickup date and time only mean anything for a specific-date pickup.
   * Switching the type to anything else — or clearing it — must not leave the
   * old schedule behind on the item.
   *
   * Only acts when the request actually states a type, so a client that never
   * sends pickup_type does not silently lose a date it set earlier.
   */
  private clearScheduleUnlessSpecificDate(
    item: ItemEntity,
    pickupType: PickupType | null | undefined,
  ): void {
    if (pickupType === undefined) return;
    if (pickupType === PickupType.SPECIFIC_DATE) return;

    item.pickup_date = null;
    item.pickup_time = null;
  }

  /**
   * Rejects a half-supplied or ambiguous location before anything is written.
   */
  private assertLocationInputIsCoherent(dto: {
    latitude?: number;
    longitude?: number;
    location_id?: string;
  }): void {
    const hasLatitude = dto.latitude !== undefined;
    const hasLongitude = dto.longitude !== undefined;

    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(
        'latitude and longitude must be provided together',
      );
    }

    if (hasLatitude && dto.location_id !== undefined) {
      throw new BadRequestException(
        'Provide either location_id or latitude/longitude, not both',
      );
    }
  }

  /**
   * Turn posted coordinates into a location the item can point at.
   *
   * The row is deliberately left unattached to any user, so posting an item
   * never adds an entry to the poster's saved locations. An item whose current
   * location is one of these throwaway rows has it updated in place rather
   * than orphaned; a saved location is never mutated, only pointed away from.
   */
  private async resolveCoordinates(
    latitude: number,
    longitude: number,
    currentLocationId?: string | null,
  ): Promise<string> {
    if (currentLocationId) {
      const current = await this.locationRepository.findOne({
        where: { id: currentLocationId, is_deleted: false },
      });

      if (current && current.user_id === null) {
        current.latitude = latitude;
        current.longitude = longitude;
        const updated = await this.locationRepository.save(current);
        return updated.id;
      }
    }

    const location = this.locationRepository.create({
      user_id: null,
      latitude,
      longitude,
    });
    const saved = await this.locationRepository.save(location);
    return saved.id;
  }

  /**
   * Upload files to Cloudinary and persist them as images of an item. A file
   * that fails to upload is skipped rather than failing the whole request, and
   * is named in `failed` so the caller can tell the client what did not save.
   */
  private async uploadImages(
    itemId: string,
    files: Express.Multer.File[],
    startOrder: number,
  ): Promise<{ images: ItemImageEntity[]; failed: string[] }> {
    const results = await Promise.all(
      files.map((file, i) =>
        this.cloudinaryService
          .uploadImage(file, { folder: 'items' })
          .then((uploadResult) =>
            this.imageRepository.create({
              item_id: itemId,
              cloudinary_public_id: uploadResult.publicId,
              cloudinary_url: uploadResult.secureUrl,
              cloudinary_secure_url: uploadResult.secureUrl,
              cloudinary_format: uploadResult.format,
              width: uploadResult.width,
              height: uploadResult.height,
              size_bytes: uploadResult.bytes,
              is_primary: false,
            }),
          )
          .catch((error) => {
            console.error(`Failed to upload file at index ${i} to Cloudinary:`, error);
            return file.originalname || `image ${i + 1}`;
          }),
      ),
    );

    const imageEntities: ItemImageEntity[] = [];
    const failed: string[] = [];
    for (const result of results) {
      if (typeof result === 'string') {
        failed.push(result);
      } else {
        // Numbered over the uploads that survived, so a failure in the middle
        // does not leave a hole in the item's display order.
        result.display_order = startOrder + imageEntities.length;
        imageEntities.push(result);
      }
    }

    if (imageEntities.length === 0) return { images: [], failed };

    return { images: await this.imageRepository.save(imageEntities), failed };
  }

  /**
   * Remove the requested images and append any newly uploaded ones, then
   * return the item's resulting image list in display order, along with the
   * names of any uploads that did not make it. Called on every update so the
   * response always carries the current images, even when the request changed
   * none of them.
   */
  private async applyImageChanges(
    itemId: string,
    removeImageIds?: string[],
    files?: Express.Multer.File[],
  ): Promise<{ images: ItemImageEntity[]; failed: string[] }> {
    const existing = await this.imageRepository.find({
      where: { item_id: itemId, is_deleted: false },
      order: { display_order: 'ASC', created_at: 'ASC' },
    });

    let remaining = existing;
    let failed: string[] = [];
    const uploadCount = files?.length ?? 0;

    const idsToRemove = [...new Set(removeImageIds ?? [])];
    if (idsToRemove.length > 0) {
      const byId = new Map(existing.map((image) => [image.id, image]));
      const toRemove = idsToRemove.map((id) => {
        const image = byId.get(id);
        if (!image) {
          throw new NotFoundException(
            `Image with ID ${id} not found on item ${itemId}`,
          );
        }
        return image;
      });

      // Mirrors the rule enforced when deleting a single image: an item that
      // has images must keep at least one, unless this request replaces them.
      if (toRemove.length === existing.length && uploadCount === 0) {
        throw new BadRequestException(
          'Cannot remove every image. Items must have at least one image.',
        );
      }

      const deletedAt = new Date();
      for (const image of toRemove) {
        image.is_deleted = true;
        image.deleted_at = deletedAt;
      }
      await this.imageRepository.save(toRemove);

      const removed = new Set(toRemove.map((image) => image.id));
      remaining = existing.filter((image) => !removed.has(image.id));
    }

    if (uploadCount > 0) {
      const nextOrder = remaining.reduce(
        (max, image) => Math.max(max, image.display_order + 1),
        0,
      );
      const uploaded = await this.uploadImages(itemId, files!, nextOrder);
      remaining = [...remaining, ...uploaded.images];
      failed = uploaded.failed;
    }

    // Removing the primary image, or adding the first ever image, leaves the
    // item without one.
    if (remaining.length > 0 && !remaining.some((image) => image.is_primary)) {
      remaining[0].is_primary = true;
      await this.imageRepository.save(remaining[0]);
    }

    return { images: remaining, failed };
  }

  /**
   * Turns skipped uploads into a message and warnings the client can show,
   * so a partial success is never reported as a clean one.
   */
  private describeFailedUploads(
    successMessage: string,
    attempted: number,
    failed: string[],
  ): Pick<ServiceResponseDto<unknown>, 'message' | 'warnings'> {
    if (failed.length === 0) return { message: successMessage };

    return {
      message: `${successMessage}, but ${failed.length} of ${attempted} images failed to upload`,
      warnings: failed.map(
        (name) => `Image "${name}" could not be uploaded and was not saved.`,
      ),
    };
  }

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

    this.assertLocationInputIsCoherent(createDto);

    const { latitude, longitude, ...fields } = createDto;

    const item = this.itemRepository.create({
      ...fields,
      user_id: userId,
      price: createDto.is_free ? 0 : createDto.price || 0,
    });

    if (latitude !== undefined && longitude !== undefined) {
      item.location_id = await this.resolveCoordinates(latitude, longitude);
    }

    this.clearScheduleUnlessSpecificDate(item, createDto.pickup_type);

    const saved = await this.itemRepository.save(item);

    const { images, failed } = await this.applyImageChanges(
      saved.id,
      undefined,
      files,
    );
    saved.images = images;

    return {
      ...this.describeFailedUploads(
        'Item created successfully',
        files?.length ?? 0,
        failed,
      ),
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
    viewer_id?: string;
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
    const savedIds = await this.getSavedItemIds(filters?.viewer_id);

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
      data: filtered.map((item) => ItemResponseDto.fromEntity(item, savedIds.has(item.id))),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Get a single item by ID
   */
  async findOne(
    id: string,
    viewerId?: string,
    ipAddress?: string,
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
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

    const savedIds = await this.getSavedItemIds(viewerId);

    // Record the view. Deduplicated to one view per viewer (or per IP for
    // anonymous viewers) per item, so repeat requests do not inflate the count.
    const { isNew } = await this.itemViewService.recordUniqueView({
      itemId: id,
      viewerId,
      ipAddress: ipAddress || 'unknown',
    });

    if (isNew) {
      entity.view_count = Number(entity.view_count ?? 0) + 1;
    }

    return {
      message: 'Item retrieved successfully',
      data: ItemResponseDto.fromEntity(entity, savedIds.has(entity.id)),
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
    files?: Express.Multer.File[],
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

    this.assertLocationInputIsCoherent(updateDto);

    const { remove_image_ids, latitude, longitude, ...fields } = updateDto;

    // Only copy fields the client actually sent. The validation pipe builds the
    // DTO instance with every declared field present, so unsent optional fields
    // arrive as `undefined` and would otherwise wipe the loaded entity values.
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        (item as unknown as Record<string, unknown>)[key] = value;
      }
    }

    // If marked as free, set price to 0
    if (updateDto.is_free) {
      item.price = 0;
    }

    this.clearScheduleUnlessSpecificDate(item, updateDto.pickup_type);

    if (latitude !== undefined && longitude !== undefined) {
      item.location_id = await this.resolveCoordinates(
        latitude,
        longitude,
        item.location_id,
      );
    }

    // Applied before the item is saved so a bad image ID rejects the whole
    // edit instead of leaving the other fields already persisted.
    const { images, failed } = await this.applyImageChanges(
      itemId,
      remove_image_ids,
      files,
    );

    const updated = await this.itemRepository.save(item);
    updated.images = images;
    return {
      ...this.describeFailedUploads(
        'Item updated successfully',
        files?.length ?? 0,
        failed,
      ),
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
