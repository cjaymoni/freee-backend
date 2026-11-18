import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
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
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';
import { CreateItemRequestDto } from './dto/create-item-request.dto';
import { UpdateItemRequestDto } from './dto/update-item-request.dto';
import { CancelRequestDto } from './dto/cancel-request.dto';
import {
  ItemEntity,
  ItemStatus,
  ModerationStatus,
} from '../item/entities/item.entity';
import { UserEntity } from '../user/entities/user.entity';
import { ServiceResponseDto } from '../common/service-response.dto';
import { AppError } from '../common/app-error';
import { ItemRequestResponseDto } from './dto/item-request-response.dto';
import { ItemResponseDto } from '../item/dto/item-response.dto';
import { ItemUserDto } from '../item/dto/item-user.dto';
import { ChatService } from '../chat/chat.service';
import { SystemEvent } from '../chat/entities/message.entity';
import { BlockedUser } from '../moderation/entities/blocked-user.entity';
import { LockNamespace, lockUser } from '../common/advisory-lock';
import { withinLast } from '../common/within-last';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { closeActiveRequests } from './close-active-requests';
import { ChatRealtimeService } from '../chat/chat-realtime.service';
import { ChatEvents } from '../chat/chat.constants';
import { NotificationService } from '../notification/notification.service';
import { pickupConfirmationReminderNotice } from '../notification/notices';
import {
  emitPickupResolved,
  partyAwaitingPickupConfirmation,
  type PickupConfirmationOutcome,
  type PickupConfirmationRequestedPayload,
  type PickupMarkState,
} from './pickup-events';

/** Most pending confirmations one run of the reminder job claims. */
const PICKUP_REMINDER_BATCH = 200;

/** Reminder pushes sent at once, so one run can't open a socket per row. */
const PICKUP_REMINDER_CONCURRENCY = 10;

/**
 * How soon a repeat "Picked up" tap may remind the other party again. A
 * reminder is a lock-screen push, not just a socket event, so this is sized
 * for notifications: one side can't buzz the other's phone by tapping. The
 * sheet can't be dismissed, so an open app is still showing it meanwhile.
 */
const PICKUP_RETAP_REMINDER_COOLDOWN_MS = 5 * 60 * 1000;

/** One row claimed by the reminder job. */
interface PickupReminderRow {
  id: string;
  item_id: string;
  owner_id: string;
  requester_id: string;
  status: RequestStatus;
  pickup_marked_by: string;
  pickup_marked_at: Date;
  item_title: string | null;
}

/*
 * How many wrong pickup codes are allowed per issued code, and how often a
 * locked-out requester may ask for a new one, are platform settings:
 * `requests.max_pickup_code_attempts` and
 * `requests.pickup_code_cooldown_minutes`. Their shipped values - 5 guesses,
 * an hour's wait - are generous enough for typos at the hand-off and far too
 * few to guess one of 32^6 codes, and the registry only lets staff tighten
 * them. Read them through the two helpers below, never from a copy here.
 */

@Injectable()
export class ItemRequestService {
  private readonly logger = new Logger(ItemRequestService.name);

  constructor(
    @InjectRepository(ItemRequestEntity)
    private readonly itemRequestRepository: Repository<ItemRequestEntity>,
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
    private readonly dataSource: DataSource,
    private readonly chatService: ChatService,
    private readonly settings: PlatformSettingsService,
    private readonly realtime: ChatRealtimeService,
    private readonly notifications: NotificationService,
  ) {}

  /** Wrong codes allowed before the owner has to issue a new one. */
  private maxPickupAttempts(): number {
    return this.settings.get('requests.max_pickup_code_attempts');
  }

  /** How long a locked-out requester waits before asking again. */
  private pickupCooldownMs(): number {
    return (
      this.settings.get('requests.pickup_code_cooldown_minutes') * 60 * 1000
    );
  }

  /**
   * Refuses a new request that would put the requester over the caps staff
   * have set. Runs inside the transaction that creates it and locks the
   * requester, so two requests racing cannot both find room under the cap.
   *
   * Lock order: the caller has already taken the item row's write lock (see
   * lockItem), so this advisory lock comes after it. Any other path that
   * takes both must take them in the same order, or two transactions can
   * deadlock holding one each.
   *
   * A cap of 0 means no limit.
   *
   * @throws BadRequestException naming the cap that was reached.
   */
  private async assertWithinRequestLimits(
    manager: EntityManager,
    requesterId: string,
  ): Promise<void> {
    const maxActive = this.settings.get('requests.max_active_per_user');
    const maxPerDay = this.settings.get('requests.max_per_day_per_user');
    if (maxActive === 0 && maxPerDay === 0) return;

    await lockUser(manager, LockNamespace.REQUEST_CAP, requesterId);

    if (maxActive > 0) {
      const active = await manager.count(ItemRequestEntity, {
        where: {
          requester_id: requesterId,
          status: In([RequestStatus.PENDING, RequestStatus.CONFIRMED]),
        },
      });
      if (active >= maxActive) {
        throw new BadRequestException(
          `You can have ${maxActive} open ${maxActive === 1 ? 'request' : 'requests'} at a time. Cancel one to ask for something else.`,
        );
      }
    }

    if (maxPerDay > 0) {
      const made = await manager.count(ItemRequestEntity, {
        where: { requester_id: requesterId, created_at: withinLast('1 day') },
      });
      if (made >= maxPerDay) {
        throw new BadRequestException(
          `You can make ${maxPerDay} ${maxPerDay === 1 ? 'request' : 'requests'} a day. Try again tomorrow.`,
        );
      }
    }
  }

  /**
   * Take the item row's write lock, which is how every state transition below
   * is serialised.
   *
   * The item is the single contended resource: a request's status, the item's
   * status and items.requester_ids all have to move together. Every writer
   * takes this lock first, so the transitions for a given item are strictly
   * ordered.
   *
   * The lock order everywhere is: item, then the request row (see
   * loadRequestUnderLock), then the advisory request-cap lock in
   * createRequest. closeActiveRequests follows it too, locking its items in
   * id order before touching any request. Keep to it: a path that takes a
   * request before its item can deadlock against any transition.
   *
   * The pickup reminder job is the one writer that takes no item lock. It
   * only stamps pickup_reminded_at, and only with SKIP LOCKED, so it never
   * waits on anything and passes over a row a transition holds.
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
   * Re-read a request once its item's lock is held, and lock the request row
   * too. Under READ COMMITTED each statement takes a fresh snapshot, so this
   * read reflects anything a transaction that held the lock before us
   * committed.
   *
   * The row lock is for the pickup reminder job, the one writer that skips
   * the item lock: with the row locked its SKIP LOCKED claim passes over it,
   * and if the job got there first this read waits and sees its fresh
   * pickup_reminded_at - so a re-tap and a timed reminder can't both push.
   * Always taken after the item lock, and the job takes no item lock, so the
   * order is item then request everywhere.
   *
   * The cost: a reminder that falls due while some transition holds its row
   * (for milliseconds) is skipped by that run of the job and sent by the
   * next, up to 10 minutes later.
   */
  private async loadRequestUnderLock(
    manager: EntityManager,
    requestId: string,
  ): Promise<ItemRequestEntity> {
    const request = await manager.findOne(ItemRequestEntity, {
      where: { id: requestId },
      lock: { mode: 'pessimistic_write' },
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
   *
   * The pickup code goes to the owner only. It belongs to the code-entry
   * pickup, which is switched off: completion now needs both parties to say
   * the item was picked up. It is kept, owner-only, so that flow can return.
   */
  private toResponseDto(
    entity: ItemRequestEntity,
    viewerId: string,
  ): ItemRequestResponseDto {
    const dto = new ItemRequestResponseDto();
    dto.id = entity.id;
    dto.item_id = entity.item_id;
    dto.requester_id = entity.requester_id;
    dto.owner_id = entity.owner_id;
    dto.status = entity.status;
    dto.pickup_date = entity.pickup_date ?? null;
    dto.confirmation_code =
      viewerId === entity.owner_id ? (entity.confirmation_code ?? null) : null;
    dto.pickup_locked =
      (entity.pickup_attempts ?? 0) >= this.maxPickupAttempts();
    dto.pickup_marked_by = entity.pickup_marked_by ?? null;
    dto.pickup_marked_at = entity.pickup_marked_at ?? null;
    dto.awaiting_pickup_confirmation =
      partyAwaitingPickupConfirmation(entity) === viewerId;
    dto.is_picked_up = entity.is_picked_up;
    dto.picked_up_at = entity.picked_up_at ?? null;
    dto.cancelled_at = entity.cancelled_at ?? null;
    dto.cancelled_by = entity.cancelled_by ?? null;
    dto.cancellation_reason = entity.cancellation_reason ?? null;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;

    if (entity.item) {
      // Sorted here rather than in SQL: ordering by a joined column under
      // skip/take makes TypeORM's pagination count one request per image.
      entity.item.images?.sort((a, b) => a.display_order - b.display_order);
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
      items_count:
        (user as unknown as { items_count?: number }).items_count ?? 0,
      is_founding_freer: user.is_founding_freer ?? false,
    };
  }

  /**
   * Generate a pickup confirmation code from the CSPRNG. Math.random would let
   * anyone who has seen a few codes recover the PRNG state and predict the
   * code for someone else's pickup; randomInt is unbiased over the alphabet.
   *
   * The code is read out or shown at the hand-off, so 0/O and 1/I are left
   * out to avoid misreads.
   */
  private generateConfirmationCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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

        if (
          item.is_deleted ||
          item.status !== ItemStatus.AVAILABLE ||
          item.moderation_status === ModerationStatus.HIDDEN
        ) {
          throw new BadRequestException('Item is not available for request');
        }

        if (item.user_id === requesterId) {
          throw new BadRequestException('Cannot request your own item');
        }

        // A request opens a thread with the owner and pushes them a card, so
        // it is a new approach like a chat message and obeys blocks the same
        // way, in either direction and with the same neutral wording.
        const blocked = await manager.exists(BlockedUser, {
          where: [
            {
              blockerId: item.user_id,
              blockedId: requesterId,
              isDeleted: false,
            },
            {
              blockerId: requesterId,
              blockedId: item.user_id,
              isDeleted: false,
            },
          ],
        });
        if (blocked) {
          throw new ForbiddenException(
            'You can no longer exchange messages with this user',
          );
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

        await this.assertWithinRequestLimits(manager, requesterId);

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

      // Posts the "You've requested for this item" card into the two users'
      // thread. Deliberately after the transaction and non-throwing: the
      // request is already committed, and a chat failure must not undo it.
      await this.chatService.createSystemMessage({
        actorId: result.requester_id,
        otherUserId: result.owner_id,
        event: SystemEvent.ITEM_REQUESTED,
        itemId: result.item_id,
        requestId: result.id,
      });

      return {
        message: 'Request created successfully',
        data: this.toResponseDto(result, requesterId),
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
        // A hidden listing is under review; nothing moves until it's restored.
        if (item.moderation_status === ModerationStatus.HIDDEN) {
          throw new ConflictException(
            'This listing has been hidden by moderators and cannot be confirmed',
          );
        }
        if (item.is_deleted || item.status !== ItemStatus.AVAILABLE) {
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

      await this.chatService.createSystemMessage({
        actorId: result.owner_id,
        otherUserId: result.requester_id,
        event: SystemEvent.REQUEST_CONFIRMED,
        itemId: result.item_id,
        requestId: result.id,
      });

      return {
        message: 'Request confirmed successfully',
        data: this.toResponseDto(result, ownerId),
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
      const outcome = await this.dataSource.transaction(async (manager) => {
        const itemId = await this.findRequestItemId(manager, requestId);
        const item = await this.lockItem(manager, itemId);
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
        const hadPendingPickup =
          partyAwaitingPickupConfirmation(request) !== null;

        // Update request
        request.status = RequestStatus.CANCELLED;
        this.clearPickupMark(request);
        request.cancelled_at = new Date();
        request.cancelled_by = userId;
        // Explicit null rather than undefined, which TypeORM would treat as
        // "leave unchanged" instead of writing the column.
        request.cancellation_reason = cancelDto.cancellation_reason ?? null;

        // If request was confirmed, make item available again - but never a
        // deleted one, which would then be requestable and handed over again.
        if (originalStatus === RequestStatus.CONFIRMED && !item.is_deleted) {
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

        return { saved, hadPendingPickup };
      });

      this.logger.log(`Request cancelled`);

      // A confirm sheet still up on the other phone has nothing left to answer.
      if (outcome.hadPendingPickup) {
        this.emitPickupResolved(outcome.saved, 'cancelled');
      }
      const result = outcome.saved;

      await this.chatService.createSystemMessage({
        actorId: userId,
        otherUserId:
          userId === result.requester_id
            ? result.owner_id
            : result.requester_id,
        event: SystemEvent.REQUEST_CANCELLED,
        itemId: result.item_id,
        requestId: result.id,
      });

      return {
        message: 'Request cancelled successfully',
        data: this.toResponseDto(result, userId),
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
      const outcome = await this.dataSource.transaction(async (manager) => {
        const itemId = await this.findRequestItemId(manager, requestId);
        const item = await this.lockItem(manager, itemId);
        const request = await this.loadRequestUnderLock(manager, requestId);

        if (request.requester_id !== requesterId) {
          throw new ForbiddenException('Only the requester can confirm pickup');
        }

        if (item.is_deleted) {
          throw new ConflictException('This item has been removed');
        }

        // A confirmed request holds the item's reservation; anything else
        // means it was already handed over or released.
        if (item.status !== ItemStatus.RESERVED) {
          throw new ConflictException('This item is no longer reserved');
        }

        if (request.status !== RequestStatus.CONFIRMED) {
          throw new BadRequestException('Request must be confirmed first');
        }

        if (request.pickup_attempts >= this.maxPickupAttempts()) {
          throw new HttpException(
            'Too many wrong codes. Ask the owner for a new pickup code',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        if (request.confirmation_code !== confirmationCode) {
          // Counted here and refused after the commit: throwing inside the
          // transaction would roll the count back with it.
          request.pickup_attempts += 1;
          await manager.save(request);
          return { wrongCode: true as const, request };
        }

        // Completing by code also answers a "Picked up" still waiting on
        // either side, whose sheet has to close.
        const hadPendingPickup =
          partyAwaitingPickupConfirmation(request) !== null;
        const completed = await this.completePickup(manager, request);
        return {
          wrongCode: false as const,
          request: completed,
          hadPendingPickup,
        };
      });

      if (outcome.wrongCode) {
        const remaining =
          this.maxPickupAttempts() - outcome.request.pickup_attempts;
        throw new BadRequestException(
          remaining > 0
            ? `Invalid confirmation code. ${remaining} attempt${remaining === 1 ? '' : 's'} left`
            : 'Invalid confirmation code. No attempts left: ask the owner for a new pickup code',
        );
      }
      const result = outcome.request;

      this.logger.log(`Pickup confirmed`);

      await this.chatService.createSystemMessage({
        actorId: result.requester_id,
        otherUserId: result.owner_id,
        event: SystemEvent.PICKUP_CONFIRMED,
        itemId: result.item_id,
        requestId: result.id,
      });
      if (outcome.hadPendingPickup) {
        this.emitPickupResolved(result, 'confirmed');
      }

      return {
        message: 'Pickup confirmed successfully',
        data: this.toResponseDto(result, requesterId),
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

  // ---------------------------------------------------------------------------
  // Two-sided pickup: one party taps "Picked up", the other confirms
  // ---------------------------------------------------------------------------

  /**
   * Hand the item over: complete the request, mark the item picked up by the
   * requester, and close every other request still waiting on it. Runs in
   * the caller's transaction with the item lock held.
   */
  private async completePickup(
    manager: EntityManager,
    request: ItemRequestEntity,
  ): Promise<ItemRequestEntity> {
    request.is_picked_up = true;
    request.picked_up_at = new Date();
    request.status = RequestStatus.COMPLETED;

    await manager.update(
      ItemEntity,
      { id: request.item_id },
      { status: ItemStatus.PICKED_UP, picked_by_id: request.requester_id },
    );

    const completed = await manager.save(request);

    // Everyone else still waiting can never be confirmed now; close their
    // requests instead of leaving them pending forever.
    await closeActiveRequests(
      manager,
      { itemIds: [request.item_id] },
      request.owner_id,
      'Item was picked up by another requester',
    );

    return completed;
  }

  private isParty(request: ItemRequestEntity, userId: string): boolean {
    return request.requester_id === userId || request.owner_id === userId;
  }

  /**
   * A retry after the pickup already completed - a double tap, or a resend
   * after a dropped response. Answered with the finished request rather than
   * an error, since the caller already got what they asked for.
   */
  private isCompletedFor(request: ItemRequestEntity, userId: string): boolean {
    return (
      this.isParty(request, userId) &&
      request.status === RequestStatus.COMPLETED
    );
  }

  /** Explicit nulls: TypeORM treats undefined as "leave the column alone". */
  private clearPickupMark(request: ItemRequestEntity): void {
    request.pickup_marked_by = null;
    request.pickup_marked_at = null;
    request.pickup_reminded_at = null;
  }

  /**
   * Checks shared by marking, confirming and declining a pickup. Either party
   * may do any of them; the item has to still be reserved by this request.
   */
  private assertPickupCanBeSettled(
    item: ItemEntity,
    request: ItemRequestEntity,
    userId: string,
  ): void {
    if (!this.isParty(request, userId)) {
      throw new ForbiddenException(
        'Only the two people in this request can settle its pickup',
      );
    }
    if (item.is_deleted) {
      throw new ConflictException('This item has been removed');
    }
    if (request.status !== RequestStatus.CONFIRMED) {
      throw new BadRequestException('Request must be confirmed first');
    }
    // A confirmed request holds the item's reservation; anything else means
    // it was already handed over or released.
    if (item.status !== ItemStatus.RESERVED) {
      throw new ConflictException('This item is no longer reserved');
    }
  }

  /**
   * Same-party second tap, or the other party's turn: either way the caller
   * must be the one the mark is waiting on.
   */
  private assertAwaitingCaller(
    request: ItemRequestEntity,
    userId: string,
  ): void {
    if (!request.pickup_marked_by) {
      throw new BadRequestException(
        'Nobody has marked this item as picked up yet',
      );
    }
    if (request.pickup_marked_by === userId) {
      throw new BadRequestException(
        'You marked this as picked up; the other person has to confirm it',
      );
    }
  }

  /** Raise the confirm sheet on every device of the party who must answer. */
  private emitPickupConfirmationRequested(
    request: PickupMarkState & {
      id: string;
      item_id: string;
      pickup_marked_at: Date | null;
    },
    itemTitle: string | null,
  ): void {
    const awaiting = partyAwaitingPickupConfirmation(request);
    if (!awaiting || !request.pickup_marked_by || !request.pickup_marked_at) {
      return;
    }
    const payload: PickupConfirmationRequestedPayload = {
      request_id: request.id,
      item_id: request.item_id,
      item_title: itemTitle,
      marked_by: request.pickup_marked_by,
      marked_at: request.pickup_marked_at,
    };
    this.realtime.emitToUser(
      awaiting,
      ChatEvents.PICKUP_CONFIRMATION_REQUESTED,
      payload,
    );
  }

  /** See {@link emitPickupResolved}. */
  private emitPickupResolved(
    request: ItemRequestEntity,
    outcome: PickupConfirmationOutcome,
  ): void {
    emitPickupResolved(this.realtime, [request], outcome);
  }

  /**
   * One party says the item has been picked up. The other party is asked to
   * confirm with a chat card, a push and a socket event that raises the
   * confirm sheet; the request stays confirmed until they answer.
   *
   * If the other party had already marked it, this is them agreeing and the
   * pickup completes. Tapping again after marking sends the other party a
   * reminder - socket event and push - at most once per
   * PICKUP_RETAP_REMINDER_COOLDOWN_MS, and the next timed one is a full interval
   * later. A tap after the pickup completed returns the completed request.
   *
   * @throws ForbiddenException when the caller is not one of the two parties.
   * @throws BadRequestException when the request is not confirmed.
   * @throws ConflictException when the item was removed or is not reserved.
   */
  async markPickedUp(
    userId: string,
    requestId: string,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const outcome = await this.dataSource.transaction(async (manager) => {
        const itemId = await this.findRequestItemId(manager, requestId);
        const item = await this.lockItem(manager, itemId);
        const request = await this.loadRequestUnderLock(manager, requestId);

        if (this.isCompletedFor(request, userId)) {
          return { kind: 'already_completed' as const, request, item };
        }

        this.assertPickupCanBeSettled(item, request, userId);

        if (request.pickup_marked_by === userId) {
          const lastRaised = (
            request.pickup_reminded_at ?? request.pickup_marked_at
          )?.getTime();
          if (
            lastRaised !== undefined &&
            Date.now() - lastRaised < PICKUP_RETAP_REMINDER_COOLDOWN_MS
          ) {
            return { kind: 'already_marked' as const, request, item };
          }
          request.pickup_reminded_at = new Date();
          const reraised = await manager.save(request);
          return {
            kind: 'reraised' as const,
            request: reraised,
            item,
            // Built here, inside the transaction, so a mark with no time -
            // broken data - rolls the stamp back and fails loudly instead of
            // postponing the reminder with nothing sent.
            reminder: this.toReminderRow(reraised, item.title ?? null),
          };
        }

        if (request.pickup_marked_by) {
          const completed = await this.completePickup(manager, request);
          return { kind: 'completed' as const, request: completed, item };
        }

        request.pickup_marked_by = userId;
        request.pickup_marked_at = new Date();
        request.pickup_reminded_at = null;
        const marked = await manager.save(request);
        return { kind: 'marked' as const, request: marked, item };
      });

      const { request, item } = outcome;

      if (outcome.kind === 'already_completed') {
        return {
          message: 'Pickup confirmed successfully',
          data: this.toResponseDto(request, userId),
          state: true,
          statusCode: 200,
        };
      }

      const otherUserId =
        userId === request.owner_id ? request.requester_id : request.owner_id;

      if (outcome.kind === 'completed') {
        this.logger.log(`Pickup confirmed by both parties`);
        await this.chatService.createSystemMessage({
          actorId: userId,
          otherUserId,
          event: SystemEvent.PICKUP_CONFIRMED,
          itemId: request.item_id,
          requestId: request.id,
        });
        this.emitPickupResolved(request, 'confirmed');
        return {
          message: 'Pickup confirmed successfully',
          data: this.toResponseDto(request, userId),
          state: true,
          statusCode: 200,
        };
      }

      if (outcome.kind === 'marked') {
        this.logger.log(`Pickup marked, awaiting the other party`);
        await this.chatService.createSystemMessage({
          actorId: userId,
          otherUserId,
          event: SystemEvent.PICKUP_MARKED,
          itemId: request.item_id,
          requestId: request.id,
        });
        this.emitPickupConfirmationRequested(request, item.title ?? null);
      } else if (outcome.kind === 'reraised') {
        // A re-tap stands in for the next timed reminder, so it delivers like
        // one: the push matters most when the other app is closed.
        await this.remindPickupConfirmation(outcome.reminder);
      }

      return {
        message: 'Waiting for the other person to confirm the pickup',
        data: this.toResponseDto(request, userId),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error marking pickup for request ${requestId}: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * The party the pickup is waiting on agrees it happened: the request
   * completes and the item is marked picked up by the requester. A retry
   * after it completed returns the completed request without repeating the
   * card or events.
   *
   * @throws BadRequestException when nothing is waiting on the caller.
   * @throws ForbiddenException / ConflictException as for {@link markPickedUp}.
   */
  async confirmPickedUp(
    userId: string,
    requestId: string,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const { request: result, isReplay } = await this.dataSource.transaction(
        async (manager) => {
          const itemId = await this.findRequestItemId(manager, requestId);
          const item = await this.lockItem(manager, itemId);
          const request = await this.loadRequestUnderLock(manager, requestId);

          if (this.isCompletedFor(request, userId)) {
            return { request, isReplay: true };
          }

          this.assertPickupCanBeSettled(item, request, userId);
          this.assertAwaitingCaller(request, userId);

          const completed = await this.completePickup(manager, request);
          return { request: completed, isReplay: false };
        },
      );

      if (isReplay) {
        return {
          message: 'Pickup confirmed successfully',
          data: this.toResponseDto(result, userId),
          state: true,
          statusCode: 200,
        };
      }

      this.logger.log(`Pickup confirmed by both parties`);

      await this.chatService.createSystemMessage({
        actorId: userId,
        otherUserId:
          userId === result.owner_id ? result.requester_id : result.owner_id,
        event: SystemEvent.PICKUP_CONFIRMED,
        itemId: result.item_id,
        requestId: result.id,
      });
      this.emitPickupResolved(result, 'confirmed');

      return {
        message: 'Pickup confirmed successfully',
        data: this.toResponseDto(result, userId),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error confirming pickup for request ${requestId}: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * The party the pickup is waiting on says it did not happen. The mark is
   * cleared and the item stays reserved for this request: either side can
   * tap "Picked up" again later, or cancel. With no mark left to clear - a
   * retry after a decline that went through - it returns the request as it
   * is, without repeating the card or events.
   *
   * @throws BadRequestException when the caller is the one who marked it.
   * @throws ForbiddenException / ConflictException as for {@link markPickedUp}.
   */
  async declinePickedUp(
    userId: string,
    requestId: string,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const { request: result, isReplay } = await this.dataSource.transaction(
        async (manager) => {
          const itemId = await this.findRequestItemId(manager, requestId);
          const item = await this.lockItem(manager, itemId);
          const request = await this.loadRequestUnderLock(manager, requestId);

          this.assertPickupCanBeSettled(item, request, userId);
          if (!request.pickup_marked_by) {
            return { request, isReplay: true };
          }
          this.assertAwaitingCaller(request, userId);

          this.clearPickupMark(request);
          return { request: await manager.save(request), isReplay: false };
        },
      );

      if (isReplay) {
        return {
          message: 'Pickup not confirmed; the item is still reserved',
          data: this.toResponseDto(result, userId),
          state: true,
          statusCode: 200,
        };
      }

      this.logger.log(`Pickup declined`);

      await this.chatService.createSystemMessage({
        actorId: userId,
        otherUserId:
          userId === result.owner_id ? result.requester_id : result.owner_id,
        event: SystemEvent.PICKUP_DECLINED,
        itemId: result.item_id,
        requestId: result.id,
      });
      this.emitPickupResolved(result, 'declined');

      return {
        message: 'Pickup not confirmed; the item is still reserved',
        data: this.toResponseDto(result, userId),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error declining pickup for request ${requestId}: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * Pickups the other party marked that the user still has to answer, oldest
   * first. The app calls this on launch and raises the confirm sheet for each,
   * which is what keeps the sheet coming back until it is answered.
   */
  async getPendingPickupConfirmations(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto[]>> {
    try {
      const [data, total] = await this.itemRequestRepository
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.item', 'item')
        .leftJoinAndSelect(
          'item.images',
          'images',
          'images.is_deleted = :imagesDeleted',
          { imagesDeleted: false },
        )
        .leftJoinAndSelect('request.requester', 'requester')
        .leftJoinAndSelect('request.owner', 'owner')
        .where('request.status = :status', { status: RequestStatus.CONFIRMED })
        .andWhere('request.pickup_marked_by IS NOT NULL')
        .andWhere('request.pickup_marked_by <> :userId', { userId })
        .andWhere(
          '(request.owner_id = :userId OR request.requester_id = :userId)',
          { userId },
        )
        .orderBy('request.pickup_marked_at', 'ASC')
        // A tie-break, so equal timestamps can't swap between pages.
        .addOrderBy('request.id', 'ASC')
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount();

      return {
        message: 'Pending pickup confirmations retrieved successfully',
        data: data.map((request) => this.toResponseDto(request, userId)),
        total,
        page,
        limit,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error fetching pending pickup confirmations: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * Keep nudging whoever has a pickup confirmation waiting on them: a push,
   * and the sheet raised again on any open app, every
   * `requests.pickup_reminder_minutes` until they answer.
   *
   * Rows are claimed with one UPDATE ... RETURNING over a SKIP LOCKED
   * subquery, so two instances running this job never remind the same person
   * twice for one interval. Times are compared in UTC on the database clock,
   * matching how the columns are stored (see tz.ts).
   *
   * @returns how many reminders were sent.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sendPickupConfirmationReminders(): Promise<number> {
    const [rows] = await this.dataSource.query<[PickupReminderRow[], number]>(
      `UPDATE item_requests AS r
          SET pickup_reminded_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
         FROM items AS i
        WHERE i.id = r.item_id
          AND r.status = $1
          AND r.pickup_marked_by IS NOT NULL
          AND r.id IN (
            SELECT id FROM item_requests
             WHERE status = $1
               AND pickup_marked_by IS NOT NULL
               AND COALESCE(pickup_reminded_at, pickup_marked_at)
                   <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - make_interval(mins => $2)
             ORDER BY COALESCE(pickup_reminded_at, pickup_marked_at)
             LIMIT $3
             FOR UPDATE SKIP LOCKED
          )
      -- Must match PickupReminderRow, which toReminderRow also builds.
      RETURNING r.id, r.item_id, r.owner_id, r.requester_id, r.status,
                r.pickup_marked_by, r.pickup_marked_at, i.title AS item_title`,
      [
        RequestStatus.CONFIRMED,
        this.settings.get('requests.pickup_reminder_minutes'),
        PICKUP_REMINDER_BATCH,
      ],
    );

    for (let i = 0; i < rows.length; i += PICKUP_REMINDER_CONCURRENCY) {
      await Promise.all(
        rows
          .slice(i, i + PICKUP_REMINDER_CONCURRENCY)
          .map((row) => this.remindPickupConfirmation(row)),
      );
    }

    if (rows.length) {
      this.logger.log(`Sent ${rows.length} pickup confirmation reminder(s)`);
    }
    return rows.length;
  }

  /**
   * A {@link PickupReminderRow} built from a loaded request, so a re-tap
   * delivers through the same remindPickupConfirmation as the cron. The cron
   * builds its rows from its RETURNING list instead; keep the two in step.
   *
   * @throws Error when the request has no mark, which no caller should pass.
   */
  private toReminderRow(
    request: ItemRequestEntity,
    itemTitle: string | null,
  ): PickupReminderRow {
    if (!request.pickup_marked_by || !request.pickup_marked_at) {
      throw new Error(
        `Pickup reminder for request ${request.id} has no mark to remind about`,
      );
    }
    return {
      id: request.id,
      item_id: request.item_id,
      owner_id: request.owner_id,
      requester_id: request.requester_id,
      status: request.status,
      pickup_marked_by: request.pickup_marked_by,
      pickup_marked_at: request.pickup_marked_at,
      item_title: itemTitle,
    };
  }

  private async remindPickupConfirmation(
    row: PickupReminderRow,
  ): Promise<void> {
    const awaiting = partyAwaitingPickupConfirmation(row);
    if (!awaiting) return;

    this.emitPickupConfirmationRequested(row, row.item_title);
    // An open app already gets the sheet from the socket event above.
    await this.notifications.notify(
      awaiting,
      pickupConfirmationReminderNotice({
        requestId: row.id,
        itemId: row.item_id,
        itemTitle: row.item_title,
      }),
      { skipDevicesOf: this.realtime.foregroundSessions(awaiting) },
    );
  }

  /**
   * Replace a confirmed request's pickup code and clear its wrong attempts.
   * This is how a requester locked out by the pickup attempt cap gets
   * another go, and lets an owner retire a code they think was seen by
   * someone else. The old code stops working immediately.
   */
  async regeneratePickupCode(
    ownerId: string,
    requestId: string,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const itemId = await this.findRequestItemId(manager, requestId);
        await this.lockItem(manager, itemId);
        const request = await this.loadRequestUnderLock(manager, requestId);

        if (request.owner_id !== ownerId) {
          throw new ForbiddenException(
            'Only the item owner can issue a new pickup code',
          );
        }

        if (request.status !== RequestStatus.CONFIRMED) {
          throw new BadRequestException(
            'Only confirmed requests have a pickup code',
          );
        }

        request.confirmation_code = this.generateConfirmationCode();
        request.pickup_attempts = 0;
        // A later lockout is a new problem; the requester can ask straight away.
        request.pickup_code_requested_at = null;

        return manager.save(request);
      });

      this.logger.log(`Pickup code regenerated`);

      return {
        message: 'New pickup code issued',
        data: this.toResponseDto(result, ownerId),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error regenerating pickup code: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * Requester side of {@link regeneratePickupCode}: ask the owner for a new
   * code after being locked out. Only nudges the owner with a chat card (and
   * its push); the code itself is still only ever issued to the owner.
   */
  async requestNewPickupCode(
    requesterId: string,
    requestId: string,
  ): Promise<ServiceResponseDto<ItemRequestResponseDto>> {
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const itemId = await this.findRequestItemId(manager, requestId);
        await this.lockItem(manager, itemId);
        const request = await this.loadRequestUnderLock(manager, requestId);

        if (request.requester_id !== requesterId) {
          throw new ForbiddenException(
            'Only the requester can ask for a new pickup code',
          );
        }

        if (request.status !== RequestStatus.CONFIRMED) {
          throw new BadRequestException(
            'Only confirmed requests have a pickup code',
          );
        }

        if (request.pickup_attempts < this.maxPickupAttempts()) {
          throw new BadRequestException(
            'You can still enter the pickup code the owner gives you',
          );
        }

        const now = Date.now();
        const cooldownMs = this.pickupCooldownMs();
        const lastAsked = request.pickup_code_requested_at?.getTime();
        if (lastAsked !== undefined && now - lastAsked < cooldownMs) {
          const minutes = Math.ceil((lastAsked + cooldownMs - now) / 60_000);
          throw new HttpException(
            `The owner has already been asked. You can ask again in ${minutes} minute${minutes === 1 ? '' : 's'}`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        request.pickup_code_requested_at = new Date(now);

        return manager.save(request);
      });

      this.logger.log(`New pickup code requested`);

      await this.chatService.createSystemMessage({
        actorId: result.requester_id,
        otherUserId: result.owner_id,
        event: SystemEvent.PICKUP_CODE_REQUESTED,
        itemId: result.item_id,
        requestId: result.id,
      });

      return {
        message: 'The owner has been asked for a new pickup code',
        data: this.toResponseDto(result, requesterId),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error requesting new pickup code: ${error.message}`,
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
        // The Profile collection card shows the item's photo and who posted
        // it, so both come back on the nested item.
        .leftJoinAndSelect(
          'item.images',
          'images',
          'images.is_deleted = :imagesDeleted',
          { imagesDeleted: false },
        )
        .leftJoinAndSelect('item.user', 'poster')
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
        data: data.map((item) => this.toResponseDto(item, userId)),
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
        data: data.map((item) => this.toResponseDto(item, ownerId)),
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

      // The response carries both parties' details (and, for the owner, the
      // pickup code), so it is restricted to the two people involved.
      if (request.requester_id !== userId && request.owner_id !== userId) {
        throw new ForbiddenException('You can only view your own requests');
      }

      return {
        message: 'Request retrieved successfully',
        data: this.toResponseDto(request, userId),
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
