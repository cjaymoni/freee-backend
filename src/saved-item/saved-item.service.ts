import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedItemEntity } from './entities/saved-item.entity';
import { CreateSavedItemDto } from './dto/create-saved-item.dto';
import { ItemEntity } from '../item/entities/item.entity';
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
  private toResponseDto(entity: SavedItemEntity): SavedItemResponseDto {
    const dto = new SavedItemResponseDto();
    Object.assign(dto, entity);
    return dto;
  }

  async saveItem(
    userId: string,
    createSavedItemDto: CreateSavedItemDto,
  ): Promise<ServiceResponseDto<SavedItemResponseDto>> {
    try {
      const { item_id } = createSavedItemDto;
      this.logger.log(`User ${userId} attempting to save item ${item_id}`);

      // Check if item exists
      const item = await this.itemRepository.findOne({
        where: { id: item_id },
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
        this.logger.log(`Item ${item_id} restored for user ${userId}`);
        return {
          message: 'Item saved successfully',
          data: restored,
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
      this.logger.log(`Item ${item_id} saved for user ${userId}`);

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
      this.logger.log(`User ${userId} attempting to unsave item ${itemId}`);

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

      this.logger.log(`Item ${itemId} unsaved for user ${userId}`);

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
      this.logger.log(
        `Fetching saved items for user ${userId}, page ${page}, limit ${limit}`,
      );
      const skip = (page - 1) * limit;

      const [items, total] = await this.savedItemRepository.findAndCount({
        where: {
          user_id: userId,
          is_deleted: false,
        },
        relations: ['item', 'item.category', 'item.location', 'item.user'],
        order: {
          created_at: 'DESC',
        },
        skip,
        take: limit,
      });

      this.logger.log(`Found ${items.length} saved items for user ${userId}`);

      return {
        message: 'Saved items retrieved successfully',
        data: items.map((item) => this.toResponseDto(item)),
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
