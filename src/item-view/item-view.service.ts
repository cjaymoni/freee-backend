import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
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

  /**
   * Record a view, deduplicated to 1 unique view per viewer (or per IP for
   * anonymous viewers) per item, ever.
   *
   * The insert relies on the partial unique indexes on item_views
   * (UQ_ITEM_VIEWS_ITEM_VIEWER / UQ_ITEM_VIEWS_ITEM_IP_ANON) so that
   * concurrent requests for the same viewer/item cannot both insert a row.
   * items.view_count is only incremented when a row was actually inserted,
   * which keeps it in step with the hourly aggregation in
   * {@link updateItemViewCounts}.
   */
  async recordUniqueView(params: {
    itemId: string;
    viewerId?: string | null;
    ipAddress: string;
    deviceType?: string | null;
    referrer?: string | null;
    viewDurationSeconds?: number | null;
  }): Promise<{ isNew: boolean; view: ItemViewEntity }> {
    const { itemId, ipAddress } = params;
    const viewerId = params.viewerId || null;

    const inserted = await this.itemViewRepository
      .createQueryBuilder()
      .insert()
      .into(ItemViewEntity)
      .values({
        item_id: itemId,
        viewer_id: viewerId,
        ip_address: ipAddress,
        device_type: params.deviceType || 'unknown',
        referrer: params.referrer || null,
        view_duration_seconds: params.viewDurationSeconds ?? null,
      })
      .orIgnore()
      .returning('*')
      .execute();

    const row = (inserted.raw as ItemViewEntity[])?.[0];

    if (row) {
      await this.itemRepository.increment({ id: itemId }, 'view_count', 1);
      return { isNew: true, view: row };
    }

    // Conflict: this viewer has already been counted for this item.
    const existing = await this.itemViewRepository.findOne({
      where: viewerId
        ? { item_id: itemId, viewer_id: viewerId }
        : { item_id: itemId, ip_address: ipAddress, viewer_id: IsNull() },
    });

    if (!existing) {
      // Should be unreachable: the insert was rejected by a unique index, so a
      // matching row must exist unless it was deleted in between.
      throw new ConflictException(
        `Unable to record view for item ${itemId}`,
      );
    }

    return { isNew: false, view: existing };
  }

  async createView(
    createItemViewDto: CreateItemViewDto,
    ipAddress: string,
    viewerId?: string,
  ): Promise<ServiceResponseDto<ItemViewResponseDto>> {
    try {
      const { item_id, device_type, referrer, view_duration_seconds } =
        createItemViewDto;

      const item = await this.itemRepository.findOne({ where: { id: item_id } });
      if (!item) {
        throw new NotFoundException(`Item with ID ${item_id} not found`);
      }

      const { isNew, view } = await this.recordUniqueView({
        itemId: item_id,
        viewerId,
        ipAddress,
        deviceType: device_type,
        referrer,
        viewDurationSeconds: view_duration_seconds,
      });

      if (!isNew) {
        return {
          message: 'View already recorded',
          data: this.toResponseDto(view),
          state: true,
          statusCode: 200,
        };
      }

      return {
        message: 'View recorded successfully',
        data: this.toResponseDto(view),
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

      const skip = (page - 1) * limit;

      const [items, total] = await this.itemViewRepository.findAndCount({
        where: { viewer_id: userId },
        relations: ['item', 'item.category', 'item.user'],
        order: { created_at: 'DESC' },
        skip,
        take: limit,
      });

      this.logger.log(`Found ${items.length} views`);

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

      // Resync every item's view_count from item_views in a single statement.
      // Items with no view rows are reset to 0 so stale counts cannot linger.
      const result: unknown = await this.itemRepository.query(`
        UPDATE items i
        SET view_count = c.count
        FROM (
          SELECT i2.id, COALESCE(v.count, 0)::int AS count
          FROM items i2
          LEFT JOIN (
            SELECT item_id, COUNT(*) AS count
            FROM item_views
            GROUP BY item_id
          ) v ON v.item_id = i2.id
        ) c
        WHERE i.id = c.id AND i.view_count <> c.count
      `);

      // node-postgres returns [rows, rowCount] for UPDATE via TypeORM's query()
      const updatedCount = Array.isArray(result)
        ? Number(result[1] ?? 0)
        : 0;

      const duration = Date.now() - startTime;
      await this.systemEventService.completeEvent(
        event.id,
        updatedCount,
        duration,
      );

      this.logger.log(
        `Updated view counts for ${updatedCount} items in ${duration}ms`,
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
