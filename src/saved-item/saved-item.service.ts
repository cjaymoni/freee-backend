import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { SavedItemEntity } from './entities/saved-item.entity';
import { CreateSavedItemDto } from './dto/create-saved-item.dto';
import { ItemEntity, ModerationStatus } from '../item/entities/item.entity';
import { ItemResponseDto } from '../item/dto/item-response.dto';
import { ServiceResponseDto } from '../common/service-response.dto';
import { AppError } from '../common/app-error';
import { SavedItemResponseDto } from './dto/saved-item-response.dto';

@Injectable()
export class SavedItemService {
  private readonly logger = new Logger(SavedItemService.name);

  constructor(
    @InjectRepository(SavedItemEntity)
    private readonly savedItemRepository: Repository<SavedItemEntity>,
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
  ) {}

  /**
   * Transform SavedItemEntity to SavedItemResponseDto
   */
  private toResponseDto(
    entity: SavedItemEntity,
    itemsCount?: Map<string, number>,
  ): SavedItemResponseDto {
    const dto = new SavedItemResponseDto();
    dto.id = entity.id;
    dto.user_id = entity.user_id;
    dto.item_id = entity.item_id;
    dto.is_deleted = entity.is_deleted;
    dto.deleted_at = entity.deleted_at;
    dto.created_at = entity.created_at;
    if (entity.item) {
      const item = {
        ...entity.item,
        // Relations load unfiltered; removed photos are already gone from
        // Cloudinary, so their URLs would be broken.
        images: entity.item.images?.filter((image) => !image.is_deleted),
      } as ItemEntity;
      if (item.user && itemsCount) {
        (item.user as unknown as { items_count: number }).items_count =
          itemsCount.get(item.user_id) ?? 0;
      }
      // The row is the user's save, so the item is saved unless it was
      // just unsaved.
      dto.item = ItemResponseDto.fromEntity(item, !entity.is_deleted);
    }
    return dto;
  }

  /** Active listings per poster, for each item's `user.items_count`. */
  private async countItemsByUser(
    userIds: string[],
  ): Promise<Map<string, number>> {
    if (!userIds.length) return new Map();
    const rows = await this.itemRepository
      .createQueryBuilder('item')
      .select('item.user_id', 'user_id')
      .addSelect('COUNT(item.id)', 'count')
      .where('item.user_id IN (:...userIds)', { userIds })
      .andWhere('item.is_deleted = false')
      .groupBy('item.user_id')
      .getRawMany<{ user_id: string; count: string }>();
    return new Map(rows.map((row) => [row.user_id, Number(row.count)]));
  }

  async saveItem(
    userId: string,
    createSavedItemDto: CreateSavedItemDto,
  ): Promise<ServiceResponseDto<SavedItemResponseDto>> {
    try {
      const { item_id } = createSavedItemDto;

      // Check if item exists
      const item = await this.itemRepository.findOne({
        where: { id: item_id, is_deleted: false },
      });
      if (!item) {
        throw new NotFoundException(`Item with ID ${item_id} not found`);
      }

      // Check if already saved
      const existingSavedItem = await this.savedItemRepository.findOne({
        where: {
          user_id: userId,
          item_id,
          is_deleted: false,
        },
      });

      if (existingSavedItem) {
        throw new ConflictException('Item already saved');
      }

      // Check if previously deleted and restore
      const deletedSavedItem = await this.savedItemRepository.findOne({
        where: {
          user_id: userId,
          item_id,
          is_deleted: true,
        },
      });

      if (deletedSavedItem) {
        deletedSavedItem.is_deleted = false;
        deletedSavedItem.deleted_at = null;
        const restored = await this.savedItemRepository.save(deletedSavedItem);

        return {
          message: 'Item saved successfully',
          data: this.toResponseDto(restored),
          state: true,
          statusCode: 200,
        };
      }

      // Create new saved item
      const savedItem = this.savedItemRepository.create({
        user_id: userId,
        item_id,
      });

      const result = await this.savedItemRepository.save(savedItem);

      return {
        message: 'Item saved successfully',
        data: this.toResponseDto(result),
        state: true,
        statusCode: 201,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Error saving item: ${error.message}`, error.stack);
      }
      throw new AppError(error);
    }
  }

  async unsaveItem(
    userId: string,
    itemId: string,
  ): Promise<ServiceResponseDto<SavedItemResponseDto>> {
    try {
      const savedItem = await this.savedItemRepository.findOne({
        where: {
          user_id: userId,
          item_id: itemId,
          is_deleted: false,
        },
      });

      if (!savedItem) {
        throw new NotFoundException('Saved item not found');
      }

      savedItem.is_deleted = true;
      savedItem.deleted_at = new Date();
      const result = await this.savedItemRepository.save(savedItem);

      return {
        message: 'Item unsaved successfully',
        data: this.toResponseDto(result),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Error unsaving item: ${error.message}`, error.stack);
      }
      throw new AppError(error);
    }
  }

  async getUserSavedItems(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<ServiceResponseDto<SavedItemResponseDto[]>> {
    try {
      const skip = (page - 1) * limit;

      const [items, total] = await this.savedItemRepository.findAndCount({
        where: {
          user_id: userId,
          is_deleted: false,
          // A listing its owner or a moderator removed or hid is no longer there.
          item: {
            is_deleted: false,
            moderation_status: Not(ModerationStatus.HIDDEN),
          },
        },
        relations: [
          'item',
          'item.category',
          'item.location',
          'item.user',
          'item.images',
        ],
        order: {
          created_at: 'DESC',
        },
        skip,
        take: limit,
      });

      this.logger.log(`Found ${items.length} saved items`);

      const itemsCount = await this.countItemsByUser([
        ...new Set(items.map((saved) => saved.item?.user_id).filter(Boolean)),
      ]);

      return {
        message: 'Saved items retrieved successfully',
        data: items.map((item) => this.toResponseDto(item, itemsCount)),
        total,
        page,
        limit,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error fetching saved items: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  async checkIfSaved(
    userId: string,
    itemId: string,
  ): Promise<ServiceResponseDto<{ is_saved: boolean }>> {
    try {
      const savedItem = await this.savedItemRepository.findOne({
        where: {
          user_id: userId,
          item_id: itemId,
          is_deleted: false,
        },
      });

      const isSaved = !!savedItem;

      return {
        message: 'Check completed',
        data: { is_saved: isSaved },
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error checking saved status: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }
}
