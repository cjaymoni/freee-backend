import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import {
  ItemEntity,
  ItemStatus,
  ModerationStatus,
  PickupType,
} from './entities/item.entity';
import { ItemImageEntity } from './entities/item-image.entity';
import { CategoryEntity } from '../category/entities/category.entity';
import { LocationEntity } from '../user/entities/location.entity';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemResponseDto } from './dto/item-response.dto';
import { ServiceResponseDto } from '../common/service-response.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UploadImageResponseDto } from '../cloudinary/dto/upload-image-response.dto';
import { SavedItemEntity } from '../saved-item/entities/saved-item.entity';
import { ItemViewService } from '../item-view/item-view.service';
import { SearchService } from '../search/search.service';
import { escapeLike, foldSql, foldText } from '../common/text-fold';
import type { Express } from 'express';
import {
  ITEM_IMAGE_FOLDER,
  isItemImagePublicId,
} from './item-image-upload.options';
import { closeActiveRequests } from '../item-request/close-active-requests';
import { NotificationService } from '../notification/notification.service';
import { listingRemovedNotice } from '../notification/notices';

const EARTH_RADIUS_KM = 6371;

/** Slack on each box edge so rounding never drops a point on the boundary. */
const BOX_SLACK_DEG = 1e-9;

/**
 * Coordinate ranges holding every point within radiusKm of lat/lng, so the
 * locations (latitude, longitude) index can narrow rows before the haversine
 * runs. The longitude range is left out where it would wrap: near a pole
 * and across the antimeridian. Bounds are exact (not the flat-earth
 * approximation, which is too narrow away from the equator).
 */
function boundingBox(
  lat: number,
  lng: number,
  radiusKm: number,
): { min_lat: number; max_lat: number; min_lng?: number; max_lng?: number } {
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const angular = radiusKm / EARTH_RADIUS_KM;
  const dLat = toDeg(angular) + BOX_SLACK_DEG;
  const box = { min_lat: lat - dLat, max_lat: lat + dLat };
  const sinDLng = Math.sin(angular) / Math.cos((lat * Math.PI) / 180);
  if (angular >= Math.PI / 2 || sinDLng >= 1) return box;
  const dLng = toDeg(Math.asin(sinDLng)) + BOX_SLACK_DEG;
  if (lng - dLng < -180 || lng + dLng > 180) return box;
  return { ...box, min_lng: lng - dLng, max_lng: lng + dLng };
}

/**
 * Great-circle (haversine) distance in km from :lat/:lng to the location
 * aliased `alias`; NULL when it has no coordinates. least() keeps rounding
 * from pushing asin() past its domain.
 */
const haversineKm = (
  alias: string,
) => `${EARTH_RADIUS_KM} * 2 * asin(least(1, sqrt(
  power(sin(radians(${alias}.latitude - CAST(:lat AS double precision)) / 2), 2) +
  cos(radians(CAST(:lat AS double precision))) * cos(radians(${alias}.latitude)) *
  power(sin(radians(${alias}.longitude - CAST(:lng AS double precision)) / 2), 2)
)))`;

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
    private readonly itemViewService: ItemViewService,
    private readonly dataSource: DataSource,
    private readonly searchService: SearchService,
    private readonly notifications: NotificationService,
  ) {}

  /** Live listings per sharer, shown as items_count on each item's card. */
  private async getItemsCountByUser(
    userIds: string[],
  ): Promise<Map<string, number>> {
    const unique = [...new Set(userIds)];
    if (!unique.length) return new Map();
    const rows = await this.itemRepository
      .createQueryBuilder('item')
      .select('item.user_id', 'user_id')
      .addSelect('COUNT(*)', 'count')
      .where('item.user_id IN (:...userIds)', { userIds: unique })
      .andWhere('item.is_deleted = false')
      .groupBy('item.user_id')
      .getRawMany<{ user_id: string; count: string }>();
    return new Map(rows.map((row) => [row.user_id, Number(row.count)]));
  }

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

  /** A category_id must name a live category; the FK alone would be a 500. */
  private async assertCategoryUsable(categoryId: string): Promise<void> {
    const exists = await this.dataSource
      .getRepository(CategoryEntity)
      .exists({ where: { id: categoryId, is_deleted: false } });
    if (!exists) {
      throw new BadRequestException(`Category ${categoryId} not found`);
    }
  }

  /**
   * A client-sent location_id must be the caller's own saved location, or a
   * temporary (ownerless) one that no other live item points at. Temporary
   * rows are edited in place when the item's coordinates change, so sharing
   * one with somebody else's item would let that edit move their item.
   */
  private async assertLocationUsable(
    userId: string,
    locationId: string,
    itemId?: string,
  ): Promise<void> {
    const location = await this.locationRepository.findOne({
      where: { id: locationId, is_deleted: false },
    });
    if (!location) {
      throw new BadRequestException(`Location ${locationId} not found`);
    }
    if (location.user_id === userId) return;

    const usedElsewhere =
      location.user_id !== null ||
      (await this.itemRepository.exists({
        where: {
          location_id: locationId,
          is_deleted: false,
          ...(itemId && { id: Not(itemId) }),
        },
      }));
    if (usedElsewhere) {
      throw new ForbiddenException('You can only use your own locations');
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
    current?: { itemId: string; locationId: string | null },
  ): Promise<string> {
    if (current?.locationId) {
      const location = await this.locationRepository.findOne({
        where: { id: current.locationId, is_deleted: false },
      });
      // Never edit a row another live item also points at (possible for
      // rows shared before assertLocationUsable existed): moving this item
      // must not move theirs.
      const shared =
        !!location &&
        (await this.itemRepository.exists({
          where: {
            location_id: location.id,
            is_deleted: false,
            id: Not(current.itemId),
          },
        }));

      if (location && location.user_id === null && !shared) {
        location.latitude = latitude;
        location.longitude = longitude;
        const updated = await this.locationRepository.save(location);
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
   * Upload files to Cloudinary. A file that fails to upload is skipped rather
   * than failing the whole request, and is named in `failed` so the caller can
   * tell the client what did not save. Nothing is written to the database
   * here, so a later failure only leaves Cloudinary assets to clean up.
   */
  private async uploadFiles(
    files: Express.Multer.File[],
  ): Promise<{ uploaded: UploadImageResponseDto[]; failed: string[] }> {
    const results = await Promise.all(
      files.map((file, i) =>
        this.cloudinaryService
          .uploadImage(file, { folder: ITEM_IMAGE_FOLDER })
          .catch((error) => {
            console.error(
              `Failed to upload file at index ${i} to Cloudinary:`,
              error,
            );
            return file.originalname || `image ${i + 1}`;
          }),
      ),
    );

    const uploaded: UploadImageResponseDto[] = [];
    const failed: string[] = [];
    for (const result of results) {
      if (typeof result === 'string') {
        failed.push(result);
      } else {
        uploaded.push(result);
      }
    }
    return { uploaded, failed };
  }

  /**
   * Delete assets uploaded for a request that was then rolled back. Best
   * effort: a delete that fails is only logged, so the cleanup never hides the
   * error that caused it.
   */
  private async discardUploads(
    uploaded: UploadImageResponseDto[],
  ): Promise<void> {
    await Promise.all(
      uploaded.map((upload) =>
        this.cloudinaryService.deleteImage(upload.publicId).catch((error) => {
          console.error(
            `Failed to clean up Cloudinary asset ${upload.publicId}:`,
            error,
          );
        }),
      ),
    );
  }

  /**
   * Save an item together with its image changes as one unit, and return it
   * with its resulting images in display order, along with the names of any
   * uploads that did not make it. Called on every update so the response
   * always carries the current images, even when the request changed none of
   * them.
   *
   * Replacement files are uploaded before anything is written, then the item,
   * the removals and the new images are committed in a single transaction. So
   * an edit that would be left with no images once its uploads fail is
   * rejected with the existing images untouched, and a database failure after
   * upload rolls everything back and deletes the orphaned Cloudinary assets.
   */
  private async saveWithImages(
    item: ItemEntity,
    removeImageIds?: string[],
    files?: Express.Multer.File[],
  ): Promise<{ item: ItemEntity; failed: string[] }> {
    const existing = item.id
      ? await this.imageRepository.find({
          where: { item_id: item.id, is_deleted: false },
          order: { display_order: 'ASC', created_at: 'ASC' },
        })
      : [];

    const byId = new Map(existing.map((image) => [image.id, image]));
    const toRemove = [...new Set(removeImageIds ?? [])].map((id) => {
      const image = byId.get(id);
      if (!image) {
        throw new NotFoundException(
          `Image with ID ${id} not found on item ${item.id}`,
        );
      }
      return image;
    });

    // Mirrors the rule enforced when deleting a single image: an item that
    // has images must keep at least one, unless this request replaces them.
    const removesAll =
      existing.length > 0 && toRemove.length === existing.length;
    const uploadCount = files?.length ?? 0;
    if (removesAll && uploadCount === 0) {
      throw new BadRequestException(
        'Cannot remove every image. Items must have at least one image.',
      );
    }

    const { uploaded, failed } =
      uploadCount > 0
        ? await this.uploadFiles(files!)
        : { uploaded: [], failed: [] };

    if (removesAll && uploaded.length === 0) {
      throw new BadRequestException(
        'None of the replacement images could be uploaded, so the existing images were kept. Please try again.',
      );
    }

    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const saved = await manager.getRepository(ItemEntity).save(item);
        const imageRepository = manager.getRepository(ItemImageEntity);

        const deletedAt = new Date();
        for (const image of toRemove) {
          image.is_deleted = true;
          image.deleted_at = deletedAt;
        }

        const removed = new Set(toRemove);
        const added = uploaded.map((upload) =>
          imageRepository.create({
            item_id: saved.id,
            cloudinary_public_id: upload.publicId,
            cloudinary_url: upload.secureUrl,
            cloudinary_secure_url: upload.secureUrl,
            cloudinary_format: upload.format,
            width: upload.width,
            height: upload.height,
            size_bytes: upload.bytes,
            is_primary: false,
          }),
        );
        const images = [
          ...existing.filter((image) => !removed.has(image)),
          ...added,
        ];

        // Renumbered so removals and failed uploads leave no gaps, with
        // exactly one primary: the first surviving one, or else the first.
        const primary = images.find((image) => image.is_primary) ?? images[0];
        const changed = [...toRemove];
        images.forEach((image, index) => {
          const isPrimary = image === primary;
          if (
            added.includes(image) ||
            image.display_order !== index ||
            image.is_primary !== isPrimary
          ) {
            image.display_order = index;
            image.is_primary = isPrimary;
            changed.push(image);
          }
        });

        if (changed.length > 0) await imageRepository.save(changed);

        saved.images = images;
        return saved;
      });

      // Only after the commit, so a rollback never strands rows pointing at
      // deleted assets.
      await this.cloudinaryService.deleteImagesQuietly(
        toRemove
          .map((image) => image.cloudinary_public_id)
          .filter(isItemImagePublicId),
      );
      return { item: saved, failed };
    } catch (error) {
      await this.discardUploads(uploaded);
      throw error;
    }
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
  /**
   * `moderation` starts the listing in a moderation state other than
   * visible, set before the first save so it is never briefly public.
   */
  async create(
    userId: string,
    createDto: CreateItemDto,
    files?: Express.Multer.File[],
    moderation?: {
      moderation_status: ModerationStatus;
      moderation_reason: string;
    },
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    // Validate price logic
    if (createDto.is_free && createDto.price && createDto.price > 0) {
      throw new BadRequestException(
        'Item cannot be marked as free if price is greater than 0',
      );
    }

    this.assertLocationInputIsCoherent(createDto);
    if (createDto.category_id) {
      await this.assertCategoryUsable(createDto.category_id);
    }
    if (createDto.location_id) {
      await this.assertLocationUsable(userId, createDto.location_id);
    }

    const { latitude, longitude, ...fields } = createDto;

    const item = this.itemRepository.create({
      ...fields,
      user_id: userId,
      price: createDto.is_free ? 0 : createDto.price || 0,
      // Left unset, the column defaults to true - so an item posted with a
      // price and no is_free would be listed as free.
      is_free: createDto.is_free ?? !(createDto.price && createDto.price > 0),
      ...moderation,
    });

    if (latitude !== undefined && longitude !== undefined) {
      item.location_id = await this.resolveCoordinates(latitude, longitude);
    }

    this.clearScheduleUnlessSpecificDate(item, createDto.pickup_type);

    const { item: saved, failed } = await this.saveWithImages(
      item,
      undefined,
      files,
    );

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
    query?: string;
    page?: number;
    limit?: number;
    /** Identifies the searcher for popular terms: a user ID, or an IP. */
    searcher_key?: string;
  }): Promise<ServiceResponseDto<ItemResponseDto[]>> {
    const query = this.itemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.location', 'location')
      .leftJoinAndSelect('item.user', 'user')
      .leftJoinAndSelect(
        'item.category',
        'category',
        'category.is_deleted = false',
      )
      .leftJoinAndSelect(
        'item.images',
        'images',
        'images.is_deleted = :images_deleted',
        { images_deleted: false },
      )
      .where('item.is_deleted = :is_deleted', { is_deleted: false });

    // Hidden listings are out of the app, except in their owner's own list.
    const ownList = !!filters?.user_id && filters.user_id === filters.viewer_id;
    if (!ownList) {
      query.andWhere('item.moderation_status != :hidden', {
        hidden: ModerationStatus.HIDDEN,
      });
    }

    if (filters?.user_id) {
      query.andWhere('item.user_id = :user_id', { user_id: filters.user_id });
    }

    if (filters?.category_id) {
      // A top-level category also matches its subcategories. Only live ones:
      // the join drops deleted categories, so an item left in a deleted
      // subcategory no longer counts towards its parent.
      query.andWhere(
        '(item.category_id = :category_id OR category.parent_category_id = :category_id)',
        { category_id: filters.category_id },
      );
    }

    if (filters?.status) {
      query.andWhere('item.status = :status', { status: filters.status });
    }

    // featured_until ends a feature on its own; nothing clears the flag.
    // Compared with a bound JS date, not now(): the column has no time zone
    // and is written from JS dates, so both sides are serialised alike
    // whatever the server's zone.
    const featured =
      'item.is_featured = true AND (item.featured_until IS NULL OR item.featured_until > :featured_now)';
    const featured_now = new Date();

    if (filters?.is_featured !== undefined) {
      query.andWhere(
        filters.is_featured ? `(${featured})` : `NOT (${featured})`,
        { featured_now },
      );
    }

    if (filters?.is_free !== undefined) {
      query.andWhere('item.is_free = :is_free', { is_free: filters.is_free });
    }

    const search = filters?.query?.trim();
    if (search) {
      query.andWhere(
        `(${foldSql('item.title')} LIKE :search OR ${foldSql("COALESCE(item.description, '')")} LIKE :search)`,
        { search: `%${escapeLike(foldText(search))}%` },
      );

      // Only the first page counts, so paging through results is not
      // mistaken for searching again.
      if ((filters?.page ?? 1) === 1 && filters?.searcher_key) {
        void this.searchService.record(search, filters.searcher_key);
      }
    }

    // Every item is listed; a radius only narrows the list when one is sent.
    const { lat, lng, radius } = filters ?? {};
    const located = lat !== undefined && lng !== undefined;
    if (located && radius !== undefined) {
      const box = boundingBox(lat, lng, radius);
      const inBox =
        box.min_lng === undefined
          ? 'l.latitude BETWEEN :min_lat AND :max_lat'
          : 'l.latitude BETWEEN :min_lat AND :max_lat AND l.longitude BETWEEN :min_lng AND :max_lng';
      const locations = (where: string) =>
        query
          .subQuery()
          .select('l.id')
          .from(LocationEntity, 'l')
          .where(where)
          .getQuery();
      // Items without coordinates stay in: a listing is not left out of
      // nearby results just because its sharer gave no location. Each case
      // is its own subquery, not one OR over the joined row, so Postgres
      // can serve the nearby one from the locations index.
      query.andWhere(
        `(item.location_id IS NULL
          OR item.location_id IN ${locations('l.latitude IS NULL OR l.longitude IS NULL')}
          OR item.location_id IN ${locations(`${inBox} AND ${haversineKm('l')} <= :radius`)})`,
        { lat, lng, radius, ...box },
      );
    }

    // Ranked nearest first when the requester sends a location, with items
    // lacking coordinates after every located one; then featured items, then
    // newest. The rank keys are selected under their own aliases because
    // TypeORM's paging (below) can only order by selected columns.
    if (located) {
      query
        .addSelect(haversineKm('location'), 'rank_distance_km')
        .setParameters({ lat, lng })
        .addOrderBy('rank_distance_km', 'ASC', 'NULLS LAST');
    }
    query
      .addSelect(`CASE WHEN ${featured} THEN 1 ELSE 0 END`, 'rank_featured')
      .setParameters({ featured_now })
      .addOrderBy('rank_featured', 'DESC');

    // Paged in SQL, after every filter, so total and each page only count
    // matching items. skip/take rather than offset/limit: TypeORM then pages
    // on distinct listings, which the images join would otherwise multiply.
    // The id breaks created_at ties so no item repeats or drops across pages.
    const paginate =
      filters?.page !== undefined || filters?.limit !== undefined;
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    query.addOrderBy('item.created_at', 'DESC').addOrderBy('item.id', 'DESC');
    if (paginate) query.skip((page - 1) * limit).take(limit);

    const [pageItems, total] = await query.getManyAndCount();

    const [savedIds, itemsCountByUser] = await Promise.all([
      this.getSavedItemIds(filters?.viewer_id),
      this.getItemsCountByUser(pageItems.map((item) => item.user_id)),
    ]);
    pageItems.forEach((entity) => {
      if (entity.user) {
        (entity.user as any).items_count =
          itemsCountByUser.get(entity.user_id) ?? 0;
      }
    });

    return {
      message: 'Items retrieved successfully',
      data: pageItems.map((item) =>
        ItemResponseDto.fromEntity(item, savedIds.has(item.id)),
      ),
      total,
      ...(paginate ? { page, limit } : {}),
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
      .leftJoinAndSelect(
        'item.category',
        'category',
        'category.is_deleted = false',
      )
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
    // Same answer as a missing item, so a hidden listing can't be probed.
    if (
      entity.moderation_status === ModerationStatus.HIDDEN &&
      entity.user_id !== viewerId
    ) {
      throw new NotFoundException(`Item with ID ${id} not found`);
    }
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
    if (updateDto.category_id && updateDto.category_id !== item.category_id) {
      await this.assertCategoryUsable(updateDto.category_id);
    }
    if (updateDto.location_id && updateDto.location_id !== item.location_id) {
      await this.assertLocationUsable(userId, updateDto.location_id, item.id);
    }

    // reserved / picked_up are owned by the request flow, which holds the item
    // lock while it moves them. Letting the owner flip a reserved item back to
    // available here would allow a second confirm and a second pickup; to
    // release a reservation, the owner cancels the confirmed request instead.
    if (updateDto.status !== undefined && updateDto.status !== item.status) {
      const ownerSettable = [ItemStatus.AVAILABLE, ItemStatus.UNAVAILABLE];
      if (
        !ownerSettable.includes(updateDto.status) ||
        !ownerSettable.includes(item.status)
      ) {
        throw new ConflictException(
          'Status can only be switched between available and unavailable; reserved and picked-up items change through their requests',
        );
      }
    }

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
    } else if (
      updateDto.is_free === undefined &&
      updateDto.price !== undefined &&
      updateDto.price > 0
    ) {
      // Pricing a free item without saying otherwise makes it not free.
      item.is_free = false;
    }

    this.clearScheduleUnlessSpecificDate(item, updateDto.pickup_type);

    if (latitude !== undefined && longitude !== undefined) {
      item.location_id = await this.resolveCoordinates(latitude, longitude, {
        itemId: item.id,
        locationId: item.location_id,
      });
    }

    // Saved with the image changes, so a bad image ID or a failed
    // replacement rejects the whole edit instead of leaving the other fields
    // already persisted.
    const { item: updated, failed } = await this.saveWithImages(
      item,
      remove_image_ids,
      files,
    );
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

    const deleted = await this.softDeleteWithImages(
      item,
      userId,
      reason || 'Deleted by owner',
    );
    return {
      message: 'Item deleted successfully',
      data: ItemResponseDto.fromEntity(deleted),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Soft-delete an item and its images in one transaction, then remove the
   * image files from Cloudinary once the change has committed.
   */
  private async softDeleteWithImages(
    item: ItemEntity,
    deletedBy: string,
    reason: string,
  ): Promise<ItemEntity> {
    const deletedAt = new Date();
    item.is_deleted = true;
    item.deleted_at = deletedAt;
    item.deleted_by = deletedBy;
    item.deletion_reason = reason;
    item.status = ItemStatus.UNAVAILABLE;

    const { deleted, images } = await this.dataSource.transaction(
      async (manager) => {
        const images = await manager
          .getRepository(ItemImageEntity)
          .find({ where: { item_id: item.id, is_deleted: false } });
        if (images.length) {
          await manager
            .getRepository(ItemImageEntity)
            .update(
              { id: In(images.map((image) => image.id)) },
              { is_deleted: true, deleted_at: deletedAt },
            );
        }
        const deleted = await manager.getRepository(ItemEntity).save(item);
        // Otherwise a later cancel would flip the deleted item back to
        // available and it could be requested and handed over again.
        await closeActiveRequests(
          manager,
          { itemIds: [item.id] },
          deletedBy,
          'Item was removed',
        );
        return { deleted, images };
      },
    );

    await this.cloudinaryService.deleteImagesQuietly(
      images
        .map((image) => image.cloudinary_public_id)
        .filter(isItemImagePublicId),
    );
    return deleted;
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

    const deleted = await this.softDeleteWithImages(
      item,
      adminId,
      reason || 'Removed by moderation',
    );
    void this.notifications.notify(
      item.user_id,
      listingRemovedNotice(item, reason),
    );
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

    if (
      featuredUntil &&
      (Number.isNaN(featuredUntil.getTime()) || featuredUntil <= new Date())
    ) {
      throw new BadRequestException('featured_until must be a future date');
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
