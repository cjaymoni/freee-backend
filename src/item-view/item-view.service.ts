import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, MoreThan } from 'typeorm';
import { ItemViewEntity } from './entities/item-view.entity';
import { CreateItemViewDto } from './dto/create-item-view.dto';
import { ItemEntity } from '../item/entities/item.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ServiceResponseDto } from '../common/service-response.dto';
import { AppError } from '../common/app-error';
import { ItemViewResponseDto } from './dto/item-view-response.dto';
import { SystemEventService } from '../audit/system-event.service';
import { SystemEventType } from '../audit/entities/system-event.entity';

@Injectable()
export class ItemViewService {
  private readonly logger = new Logger(ItemViewService.name);

  constructor(
    @InjectRepository(ItemViewEntity)
    private readonly itemViewRepository: Repository<ItemViewEntity>,
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
    private readonly systemEventService: SystemEventService,
  ) {}

  /**
   * Transform ItemViewEntity to ItemViewResponseDto
   */
  private toResponseDto(entity: ItemViewEntity): ItemViewResponseDto {
    const dto = new ItemViewResponseDto();
    Object.assign(dto, entity);
    return dto;
  }

  async createView(
    createItemViewDto: CreateItemViewDto,
    ipAddress: string,
    viewerId?: string,
  ): Promise<ServiceResponseDto<ItemViewResponseDto>> {
    try {
      const { item_id, device_type, referrer, view_duration_seconds } =
        createItemViewDto;

      this.logger.log(`Recording view for item ${item_id}`);

      const item = await this.itemRepository.findOne({ where: { id: item_id } });
      if (!item) {
        throw new NotFoundException(`Item with ID ${item_id} not found`);
      }

      // Deduplicate: 1 unique view per user (or IP for anonymous) per item, ever
      const existing = await this.itemViewRepository.findOne({
        where: viewerId
          ? { item_id, viewer_id: viewerId }
          : { item_id, ip_address: ipAddress, viewer_id: IsNull() },
      });

      if (existing) {
        return {
          message: 'View already recorded',
          data: this.toResponseDto(existing),
          state: true,
          statusCode: 200,
        };
      }

      const itemView = this.itemViewRepository.create({
        item_id,
        viewer_id: viewerId || null,
        ip_address: ipAddress,
        device_type: device_type || 'unknown',
        referrer: referrer || null,
        view_duration_seconds: view_duration_seconds || null,
      });

      const result = await this.itemViewRepository.save(itemView);
      this.logger.log(`View recorded for item ${item_id}`);

      return {
        message: 'View recorded successfully',
        data: this.toResponseDto(result),
        state: true,
        statusCode: 201,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error recording view: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  async getItemViewStats(
    itemId: string,
    days: number = 30,
  ): Promise<ServiceResponseDto<any>> {
    try {
      this.logger.log(`Fetching view stats for item ${itemId}`);

      const item = await this.itemRepository.findOne({ where: { id: itemId } });
      if (!item) {
        throw new NotFoundException(`Item with ID ${itemId} not found`);
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Total views
      const totalViews = await this.itemViewRepository.count({
        where: {
          item_id: itemId,
          created_at: MoreThan(startDate),
        },
      });

      // Unique viewers
      const uniqueViewersResult = await this.itemViewRepository
        .createQueryBuilder('view')
        .select('COUNT(DISTINCT view.viewer_id)', 'count')
        .where('view.item_id = :itemId', { itemId })
        .andWhere('view.created_at > :startDate', { startDate })
        .andWhere('view.viewer_id IS NOT NULL')
        .getRawOne<{ count: string }>();

      // Anonymous views
      const anonymousViews = await this.itemViewRepository
        .createQueryBuilder('view')
        .where('view.item_id = :itemId', { itemId })
        .andWhere('view.created_at > :startDate', { startDate })
        .andWhere('view.viewer_id IS NULL')
        .getCount();

      // Average duration
      const avgDurationResult = await this.itemViewRepository
        .createQueryBuilder('view')
        .select('AVG(view.view_duration_seconds)', 'avg')
        .where('view.item_id = :itemId', { itemId })
        .andWhere('view.created_at > :startDate', { startDate })
        .andWhere('view.view_duration_seconds IS NOT NULL')
        .getRawOne<{ avg: string }>();

      // Views by device type
      const viewsByDevice = await this.itemViewRepository
        .createQueryBuilder('view')
        .select('view.device_type', 'device')
        .addSelect('COUNT(*)', 'count')
        .where('view.item_id = :itemId', { itemId })
        .andWhere('view.created_at > :startDate', { startDate })
        .groupBy('view.device_type')
        .getRawMany<{ device: string; count: string }>();

      // Views by date
      const viewsByDate = await this.itemViewRepository
        .createQueryBuilder('view')
        .select('DATE(view.created_at)', 'date')
        .addSelect('COUNT(*)', 'count')
        .where('view.item_id = :itemId', { itemId })
        .andWhere('view.created_at > :startDate', { startDate })
        .groupBy('DATE(view.created_at)')
        .orderBy('date', 'ASC')
        .getRawMany<{ date: string; count: string }>();

      const stats = {
        total_views: totalViews,
        unique_viewers: parseInt(uniqueViewersResult?.count || '0'),
        anonymous_views: anonymousViews,
        average_duration_seconds: parseFloat(avgDurationResult?.avg || '0'),
        views_by_device: viewsByDevice.reduce<Record<string, number>>(
          (acc, curr) => {
            acc[curr.device] = parseInt(curr.count);
            return acc;
          },
          {},
        ),
        views_by_date: viewsByDate.map((v) => ({
          date: v.date,
          count: parseInt(v.count),
        })),
      };

      this.logger.log(`Stats retrieved for item ${itemId}`);

      return {
        message: 'Statistics retrieved successfully',
        data: stats,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error fetching view stats: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  async getUserViewHistory(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<ServiceResponseDto<ItemViewResponseDto[]>> {
    try {
      this.logger.log(
        `Fetching view history for user ${userId}, page ${page}, limit ${limit}`,
      );
      const skip = (page - 1) * limit;

      const [items, total] = await this.itemViewRepository.findAndCount({
        where: { viewer_id: userId },
        relations: ['item', 'item.category', 'item.user'],
        order: { created_at: 'DESC' },
        skip,
        take: limit,
      });

      this.logger.log(`Found ${items.length} views for user ${userId}`);

      return {
        message: 'View history retrieved successfully',
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
          `Error fetching view history: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * Cron job to update item view counts hourly
   * This aggregates views from item_views table to items.view_count
   */
  @Cron(CronExpression.EVERY_HOUR)
  async updateItemViewCounts() {
    const startTime = Date.now();
    const event = await this.systemEventService.startEvent(
      SystemEventType.SCHEDULED_JOB,
      'Update Item View Counts',
      'Hourly aggregation of view counts from item_views to items table',
    );

    try {
      this.logger.log('Starting hourly view count update...');

      // Get all items with their view counts
      const viewCounts = await this.itemViewRepository
        .createQueryBuilder('view')
        .select('view.item_id', 'item_id')
        .addSelect('COUNT(*)', 'count')
        .groupBy('view.item_id')
        .getRawMany<{ item_id: string; count: string }>();

      // Update each item's view count
      for (const { item_id, count } of viewCounts) {
        await this.itemRepository.update(
          { id: item_id },
          { view_count: parseInt(count) },
        );
      }

      const duration = Date.now() - startTime;
      await this.systemEventService.completeEvent(
        event.id,
        viewCounts.length,
        duration,
      );

      this.logger.log(
        `Updated view counts for ${viewCounts.length} items in ${duration}ms`,
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      await this.systemEventService.failEvent(event.id, errorMessage, duration);
      this.logger.error('Error updating view counts:', error);
    }
  }
}
