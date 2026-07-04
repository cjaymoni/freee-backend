import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';
import { CreateItemRequestDto } from './dto/create-item-request.dto';
import { UpdateItemRequestDto } from './dto/update-item-request.dto';
import { CancelRequestDto } from './dto/cancel-request.dto';
import { ItemEntity, ItemCondition, ItemStatus } from '../item/entities/item.entity';
import { LocationEntity } from '../user/entities/location.entity';
import { ServiceResponseDto } from '../common/service-response.dto';
import { AppError } from '../common/app-error';
import { ItemRequestResponseDto } from './dto/item-request-response.dto';
import { DistanceService } from '../common/distance.service';

@Injectable()
export class ItemRequestService {
  private readonly logger = new Logger(ItemRequestService.name);

  constructor(
    @InjectRepository(ItemRequestEntity)
    private readonly itemRequestRepository: Repository<ItemRequestEntity>,
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
    @InjectRepository(LocationEntity)
    private readonly locationRepository: Repository<LocationEntity>,
    private readonly distanceService: DistanceService,
  ) {}

  /**
   * Transform ItemRequestEntity to ItemRequestResponseDto
   */
  private toResponseDto(entity: ItemRequestEntity): ItemRequestResponseDto {
    const dto = new ItemRequestResponseDto();
    Object.assign(dto, entity);
    return dto;
  }

  /**
   * Generate a random confirmation code
   */
  private generateConfirmationCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Check if user is within 10km of item location
   */
  async isUserWithinRange(
    userId: string,
    itemId: string,
    maxDistanceKm: number = 10,
  ): Promise<{ withinRange: boolean; distance?: number }> {
    // Get user's current/primary location
    const userLocation = await this.locationRepository.findOne({
      where: [
        { user_id: userId, is_current: true, is_deleted: false },
        { user_id: userId, is_primary: true, is_deleted: false },
      ],
      order: { is_current: 'DESC', is_primary: 'DESC' },
    });

    if (!userLocation || !userLocation.latitude || !userLocation.longitude) {
      throw new BadRequestException(
        'User location not found. Please set your location first.',
      );
    }

    // Get item location
    const item = await this.itemRepository.findOne({
      where: { id: itemId },
      relations: ['location'],
    });

    if (!item || !item.location) {
      throw new NotFoundException('Item or item location not found');
    }

    if (!item.location.latitude || !item.location.longitude) {
      throw new BadRequestException('Item location coordinates not available');
    }

    // Calculate distance
    const distance = this.distanceService.calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      item.location.latitude,
      item.location.longitude,
    );

    return {
      withinRange: distance <= maxDistanceKm,
      distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
    };
  }

  async createRequest(
    requesterId: string,
    createItemRequestDto: CreateItemRequestDto,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const { item_id } = createItemRequestDto;
      this.logger.log(
        `User ${requesterId} creating request for item ${item_id}`,
      );

      // Check if item exists and is available
      const item = await this.itemRepository.findOne({
        where: { id: item_id },
        relations: ['user'],
      });

      if (!item) {
        throw new NotFoundException(`Item with ID ${item_id} not found`);
      }

      if (item.condition === ItemCondition.USED) {
        throw new BadRequestException('Items with condition "used" cannot be requested');
      }

      if (item.status !== ItemStatus.AVAILABLE) {
        throw new BadRequestException('Item is not available for request');
      }

      if (item.user_id === requesterId) {
        throw new BadRequestException('Cannot request your own item');
      }

      // Check distance (10km limit)
      const { withinRange, distance } = await this.isUserWithinRange(
        requesterId,
        item_id,
        10,
      );

      if (!withinRange) {
        throw new BadRequestException(
          `Item is too far away. Distance: ${distance}km (max: 10km)`,
        );
      }

      // Check for existing pending request
      const existingRequest = await this.itemRequestRepository.findOne({
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
      const itemRequest = this.itemRequestRepository.create({
        item_id,
        requester_id: requesterId,
        owner_id: item.user_id,
      });

      const result = await this.itemRequestRepository.save(itemRequest);
      this.logger.log(
        `Request ${result.id} created for item ${item_id} by user ${requesterId} (distance: ${distance}km)`,
      );

      return {
        message: 'Request created successfully',
        data: this.toResponseDto(result),
        state: true,
        statusCode: 201,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error creating request: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  async confirmRequest(
    ownerId: string,
    requestId: string,
    updateDto: UpdateItemRequestDto,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      this.logger.log(`Owner ${ownerId} confirming request ${requestId}`);

      const request = await this.itemRequestRepository.findOne({
        where: { id: requestId },
        relations: ['item'],
      });

      if (!request) {
        throw new NotFoundException('Request not found');
      }

      if (request.owner_id !== ownerId) {
        throw new ForbiddenException(
          'Only the item owner can confirm this request',
        );
      }

      if (request.status !== RequestStatus.PENDING) {
        throw new BadRequestException('Only pending requests can be confirmed');
      }

      // Generate confirmation code
      const confirmationCode = this.generateConfirmationCode();

      // Update request
      request.status = RequestStatus.CONFIRMED;
      request.confirmation_code = confirmationCode;

      // Update item status to reserved
      await this.itemRepository.update(
        { id: request.item_id },
        { status: ItemStatus.RESERVED },
      );

      const result = await this.itemRequestRepository.save(request);
      this.logger.log(
        `Request ${requestId} confirmed with code ${confirmationCode}`,
      );

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
      this.logger.log(`User ${userId} cancelling request ${requestId}`);

      const request = await this.itemRequestRepository.findOne({
        where: { id: requestId },
        relations: ['item'],
      });

      if (!request) {
        throw new NotFoundException('Request not found');
      }

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
      request.cancellation_reason = cancelDto.cancellation_reason;

      // If request was confirmed, make item available again
      if (originalStatus === RequestStatus.CONFIRMED) {
        await this.itemRepository.update(
          { id: request.item_id },
          { status: ItemStatus.AVAILABLE },
        );
      }

      const result = await this.itemRequestRepository.save(request);
      this.logger.log(`Request ${requestId} cancelled successfully`);

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
      this.logger.log(
        `Requester ${requesterId} confirming pickup for request ${requestId}`,
      );

      const request = await this.itemRequestRepository.findOne({
        where: { id: requestId },
        relations: ['item'],
      });

      if (!request) {
        throw new NotFoundException('Request not found');
      }

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
      await this.itemRepository.update(
        { id: request.item_id },
        { status: ItemStatus.PICKED_UP },
      );

      const result = await this.itemRequestRepository.save(request);
      this.logger.log(`Pickup confirmed for request ${requestId}`);

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
      this.logger.log(`Fetching requests for user ${userId}, page ${page}`);

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
      this.logger.log(`Fetching requests for owner ${ownerId}, page ${page}`);

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
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      this.logger.log(`Fetching request ${requestId}`);

      const request = await this.itemRequestRepository.findOne({
        where: { id: requestId },
        relations: ['item', 'item.category', 'requester', 'owner'],
      });

      if (!request) {
        throw new NotFoundException('Request not found');
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
