import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  In,
  DataSource,
  EntityManager,
  QueryFailedError,
} from 'typeorm';
import { randomInt } from 'crypto';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';
import { CreateItemRequestDto } from './dto/create-item-request.dto';
import { UpdateItemRequestDto } from './dto/update-item-request.dto';
import { CancelRequestDto } from './dto/cancel-request.dto';
import { ItemEntity, ItemCondition, ItemStatus } from '../item/entities/item.entity';
import { UserEntity } from '../user/entities/user.entity';
import { ServiceResponseDto } from '../common/service-response.dto';
import { AppError } from '../common/app-error';
import { ItemRequestResponseDto } from './dto/item-request-response.dto';
import { ItemResponseDto } from '../item/dto/item-response.dto';
import { ItemUserDto } from '../item/dto/item-user.dto';

@Injectable()
export class ItemRequestService {
  private readonly logger = new Logger(ItemRequestService.name);

  constructor(
    @InjectRepository(ItemRequestEntity)
    private readonly itemRequestRepository: Repository<ItemRequestEntity>,
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Take the item row's write lock, which is how every state transition below
   * is serialised.
   *
   * The item is the single contended resource: a request's status, the item's
   * status and items.requester_ids all have to move together. Every writer
   * takes this one lock first and no writer takes a second row lock, so the
   * transitions for a given item are strictly ordered and no two of them can
   * deadlock against each other.
   *
   * Relations are deliberately not joined - Postgres rejects FOR UPDATE
   * against the nullable side of an outer join.
   */
  private async lockItem(
    manager: EntityManager,
    itemId: string,
  ): Promise<ItemEntity> {
    const item = await manager.findOne(ItemEntity, {
      where: { id: itemId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!item) {
      throw new NotFoundException(`Item with ID ${itemId} not found`);
    }

    return item;
  }

  /**
   * Resolve which item a request belongs to, so its row can be locked.
   *
   * Read without a lock, which is safe because item_id is set at creation and
   * never changes; every field that can change is read again afterwards by
   * {@link loadRequestUnderLock}.
   */
  private async findRequestItemId(
    manager: EntityManager,
    requestId: string,
  ): Promise<string> {
    const request = await manager.findOne(ItemRequestEntity, {
      where: { id: requestId },
      select: { id: true, item_id: true },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    return request.item_id;
  }

  /**
   * Re-read a request once its item's lock is held. Under READ COMMITTED each
   * statement takes a fresh snapshot, so this read reflects anything a
   * transaction that held the lock before us committed.
   */
  private async loadRequestUnderLock(
    manager: EntityManager,
    requestId: string,
  ): Promise<ItemRequestEntity> {
    const request = await manager.findOne(ItemRequestEntity, {
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    return request;
  }

  /**
   * Transform ItemRequestEntity to ItemRequestResponseDto.
   *
   * Fields are copied one by one rather than with Object.assign: the loaded
   * `requester` / `owner` relations are full UserEntity rows, and assigning
   * them wholesale put every user column - password_hash included - on the
   * wire, and would silently do so again for any column added later.
   */
  private toResponseDto(entity: ItemRequestEntity): ItemRequestResponseDto {
    const dto = new ItemRequestResponseDto();
    dto.id = entity.id;
    dto.item_id = entity.item_id;
    dto.requester_id = entity.requester_id;
    dto.owner_id = entity.owner_id;
    dto.status = entity.status;
    dto.pickup_date = entity.pickup_date ?? null;
    dto.confirmation_code = entity.confirmation_code ?? null;
    dto.is_picked_up = entity.is_picked_up;
    dto.picked_up_at = entity.picked_up_at ?? null;
    dto.cancelled_at = entity.cancelled_at ?? null;
    dto.cancelled_by = entity.cancelled_by ?? null;
    dto.cancellation_reason = entity.cancellation_reason ?? null;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;

    if (entity.item) {
      dto.item = ItemResponseDto.fromEntity(entity.item);
    }

    if (entity.requester) {
      dto.requester = this.toPublicUser(entity.requester);
    }

    if (entity.owner) {
      dto.owner = this.toPublicUser(entity.owner);
    }

    return dto;
  }

  /**
   * The publicly shareable view of a user, matching the shape ItemResponseDto
   * already returns for item owners.
   */
  private toPublicUser(user: UserEntity): ItemUserDto {
    return {
      id: user.id,
      name: [user.first_name, user.last_name].filter(Boolean).join(' '),
      profile_image: user.cloudinary_avatar_url ?? null,
      joined_date: user.member_since,
      phone_number: user.phone_number ?? null,
      items_count: (user as unknown as { items_count?: number }).items_count ?? 0,
    };
  }

  /**
   * Generate a pickup confirmation code from the CSPRNG. Math.random would let
   * anyone who has seen a few codes recover the PRNG state and predict the
   * code for someone else's pickup; randomInt is unbiased over the alphabet.
   */
  private generateConfirmationCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(randomInt(chars.length));
    }
    return code;
  }

  async createRequest(
    requesterId: string,
    createItemRequestDto: CreateItemRequestDto,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const { item_id } = createItemRequestDto;

      const result = await this.dataSource.transaction(async (manager) => {
        // Serialises against every other transition for this item, so the
        // duplicate-request check below cannot be raced.
        const item = await this.lockItem(manager, item_id);

        if (item.condition === ItemCondition.USED) {
          throw new BadRequestException(
            'Items with condition "used" cannot be requested',
          );
        }

        if (item.status !== ItemStatus.AVAILABLE) {
          throw new BadRequestException('Item is not available for request');
        }

        if (item.user_id === requesterId) {
          throw new BadRequestException('Cannot request your own item');
        }

        // Check for existing pending request
        const existingRequest = await manager.findOne(ItemRequestEntity, {
          where: {
            item_id,
            requester_id: requesterId,
            status: In([RequestStatus.PENDING, RequestStatus.CONFIRMED]),
          },
        });

        if (existingRequest) {
          throw new ConflictException(
            'You already have a pending request for this item',
          );
        }

        // Create the request
        const itemRequest = manager.create(ItemRequestEntity, {
          item_id,
          requester_id: requesterId,
          owner_id: item.user_id,
        });

        const saved = await manager.save(itemRequest);

        // Append requester to item's requester_ids
        await manager.query(
          `UPDATE items SET requester_ids = array_append(requester_ids, $1::uuid) WHERE id = $2 AND NOT ($1::uuid = ANY(requester_ids))`,
          [requesterId, item_id],
        );

        return saved;
      });

      this.logger.log(`Request created`);

      return {
        message: 'Request created successfully',
        data: this.toResponseDto(result),
        state: true,
        statusCode: 201,
      };
    } catch (error) {
      // UQ_ITEM_REQUESTS_ACTIVE_PER_REQUESTER. The lock above means the
      // in-code duplicate check normally gets there first, so reaching this is
      // a sign of a write path that skipped the lock - report it as the same
      // 409 the check would have raised rather than a 500.
      if (this.isUniqueViolation(error)) {
        throw new AppError(
          new ConflictException(
            'You already have a pending request for this item',
          ),
        );
      }

      if (error instanceof Error) {
        this.logger.error(
          `Error creating request: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code === '23505'
    );
  }

  async confirmRequest(
    ownerId: string,
    requestId: string,
    updateDto: UpdateItemRequestDto,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const itemId = await this.findRequestItemId(manager, requestId);
        const item = await this.lockItem(manager, itemId);
        const request = await this.loadRequestUnderLock(manager, requestId);

        if (request.owner_id !== ownerId) {
          throw new ForbiddenException(
            'Only the item owner can confirm this request',
          );
        }

        if (request.status !== RequestStatus.PENDING) {
          throw new BadRequestException(
            'Only pending requests can be confirmed',
          );
        }

        // Confirming reserves the item, so an item that is no longer available
        // already has a confirmed request (or has been picked up / withdrawn).
        // Without this check two pending requests could both be confirmed and
        // both holders could then confirm pickup.
        if (item.status !== ItemStatus.AVAILABLE) {
          throw new ConflictException(
            'This item is no longer available to confirm; it already has a confirmed request or is not available',
          );
        }

        // Generate confirmation code
        request.status = RequestStatus.CONFIRMED;
        request.confirmation_code = this.generateConfirmationCode();

        // Update item status to reserved
        await manager.update(
          ItemEntity,
          { id: request.item_id },
          { status: ItemStatus.RESERVED },
        );

        return manager.save(request);
      });

      this.logger.log(`Request confirmed`);

      return {
        message: 'Request confirmed successfully',
        data: this.toResponseDto(result),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error confirming request: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  async cancelRequest(
    userId: string,
    requestId: string,
    cancelDto: CancelRequestDto,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const itemId = await this.findRequestItemId(manager, requestId);
        await this.lockItem(manager, itemId);
        const request = await this.loadRequestUnderLock(manager, requestId);

        // Check if user is either requester or owner
        if (request.requester_id !== userId && request.owner_id !== userId) {
          throw new ForbiddenException('You can only cancel your own requests');
        }

        if (
          ![RequestStatus.PENDING, RequestStatus.CONFIRMED].includes(
            request.status,
          )
        ) {
          throw new BadRequestException('This request cannot be cancelled');
        }

        // Store original status before changing
        const originalStatus = request.status;

        // Update request
        request.status = RequestStatus.CANCELLED;
        request.cancelled_at = new Date();
        request.cancelled_by = userId;
        // Explicit null rather than undefined, which TypeORM would treat as
        // "leave unchanged" instead of writing the column.
        request.cancellation_reason = cancelDto.cancellation_reason ?? null;

        // If request was confirmed, make item available again
        if (originalStatus === RequestStatus.CONFIRMED) {
          await manager.update(
            ItemEntity,
            { id: request.item_id },
            { status: ItemStatus.AVAILABLE },
          );
        }

        const saved = await manager.save(request);

        // Remove requester from item's requester_ids
        await manager.query(
          `UPDATE items SET requester_ids = array_remove(requester_ids, $1::uuid) WHERE id = $2`,
          [request.requester_id, request.item_id],
        );

        return saved;
      });

      this.logger.log(`Request cancelled`);

      return {
        message: 'Request cancelled successfully',
        data: this.toResponseDto(result),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error cancelling request: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  async confirmPickup(
    requesterId: string,
    requestId: string,
    confirmationCode: string,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const itemId = await this.findRequestItemId(manager, requestId);
        await this.lockItem(manager, itemId);
        const request = await this.loadRequestUnderLock(manager, requestId);

        if (request.requester_id !== requesterId) {
          throw new ForbiddenException('Only the requester can confirm pickup');
        }

        if (request.status !== RequestStatus.CONFIRMED) {
          throw new BadRequestException('Request must be confirmed first');
        }

        if (request.confirmation_code !== confirmationCode) {
          throw new BadRequestException('Invalid confirmation code');
        }

        // Update request
        request.is_picked_up = true;
        request.picked_up_at = new Date();
        request.status = RequestStatus.COMPLETED;

        // Update item status
        await manager.update(
          ItemEntity,
          { id: request.item_id },
          { status: ItemStatus.PICKED_UP, picked_by_id: requesterId },
        );

        return manager.save(request);
      });

      this.logger.log(`Pickup confirmed`);

      return {
        message: 'Pickup confirmed successfully',
        data: this.toResponseDto(result),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error confirming pickup: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  async getUserRequests(
    userId: string,
    page: number = 1,
    limit: number = 20,
    statusFilter?: RequestStatus,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto[]>> {
    try {


      const skip = (page - 1) * limit;

      const queryBuilder = this.itemRequestRepository
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.item', 'item')
        .leftJoinAndSelect('item.category', 'category')
        .leftJoinAndSelect('request.requester', 'requester')
        .leftJoinAndSelect('request.owner', 'owner')
        .where('request.requester_id = :userId', { userId })
        .orderBy('request.created_at', 'DESC')
        .skip(skip)
        .take(limit);

      if (statusFilter) {
        queryBuilder.andWhere('request.status = :status', {
          status: statusFilter,
        });
      }

      const [data, total] = await queryBuilder.getManyAndCount();

      return {
        message: 'User requests retrieved successfully',
        data: data.map((item) => this.toResponseDto(item)),
        total,
        page,
        limit,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error fetching user requests: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  async getItemRequests(
    ownerId: string,
    page: number = 1,
    limit: number = 20,
    statusFilter?: RequestStatus,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto[]>> {
    try {


      const skip = (page - 1) * limit;

      const queryBuilder = this.itemRequestRepository
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.item', 'item')
        .leftJoinAndSelect('item.category', 'category')
        .leftJoinAndSelect('request.requester', 'requester')
        .leftJoinAndSelect('request.owner', 'owner')
        .where('request.owner_id = :ownerId', { ownerId })
        .orderBy('request.created_at', 'DESC')
        .skip(skip)
        .take(limit);

      if (statusFilter) {
        queryBuilder.andWhere('request.status = :status', {
          status: statusFilter,
        });
      }

      const [data, total] = await queryBuilder.getManyAndCount();

      return {
        message: 'Item requests retrieved successfully',
        data: data.map((item) => this.toResponseDto(item)),
        total,
        page,
        limit,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error fetching item requests: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  async getRequestById(
    requestId: string,
    userId: string,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const request = await this.itemRequestRepository.findOne({
        where: { id: requestId },
        relations: ['item', 'item.category', 'requester', 'owner'],
      });

      if (!request) {
        throw new NotFoundException('Request not found');
      }

      // The response carries the pickup confirmation code and both parties'
      // details, so it is restricted to the two people involved.
      if (request.requester_id !== userId && request.owner_id !== userId) {
        throw new ForbiddenException(
          'You can only view your own requests',
        );
      }

      return {
        message: 'Request retrieved successfully',
        data: this.toResponseDto(request),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error fetching request: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }
}
