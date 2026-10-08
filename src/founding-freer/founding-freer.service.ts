import { StaffInboxService } from '../notification/staff-inbox.service';
import { listingAwaitingReviewEntry } from '../notification/staff-notices';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { ItemService } from '../item/item.service';
import { CreateItemDto } from '../item/dto/create-item.dto';
import { ItemResponseDto } from '../item/dto/item-response.dto';
import { ModerationStatus } from '../item/entities/item.entity';
import { ServiceResponseDto } from '../common/service-response.dto';
import { JoinFoundingFreersDto } from './dto/join-founding-freers.dto';
import { FOUNDING_REVIEW_REASON } from './founding-freer.constants';

@Injectable()
export class FoundingFreerService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly userService: UserService,
    private readonly itemService: ItemService,
    private readonly config: ConfigService,
    private readonly staffInbox: StaffInboxService,
  ) {}

  isOpen(): boolean {
    return String(this.config.get('FOUNDING_FREERS_OPEN')) === 'true';
  }

  async join(userId: string, dto: JoinFoundingFreersDto) {
    this.assertOpen();
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const first = dto.first_name?.trim();
    const last = dto.last_name?.trim();
    // A name typed here never overwrites one the account already has.
    const name =
      !user.first_name && !user.last_name && (first || last)
        ? { first_name: first || null, last_name: last || null }
        : {};

    const since = user.founding_freer_since ?? new Date();
    await this.userRepository.update(userId, {
      ...(name as Partial<UserEntity>),
      is_founding_freer: true,
      founding_freer_since: since,
    });
    await this.userService.invalidateUserCache(user);

    return {
      state: true,
      statusCode: 200,
      message: 'Welcome, Founding Freer',
      data: { is_founding_freer: true, founding_freer_since: since },
    };
  }

  /** Founding listings need a photo and wait for review before going live. */
  async createItem(
    userId: string,
    dto: CreateItemDto,
    files?: Express.Multer.File[],
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    this.assertOpen();
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, is_founding_freer: true },
    });
    if (!user?.is_founding_freer) {
      throw new ForbiddenException('Join the Founding Freers first');
    }
    if (!files?.length) {
      throw new BadRequestException('Add at least one photo of the item');
    }

    const created = await this.itemService.create(userId, dto, files, {
      moderation_status: ModerationStatus.HIDDEN,
      moderation_reason: FOUNDING_REVIEW_REASON,
    });
    void this.staffInbox.toAllStaff(
      listingAwaitingReviewEntry(created.data.id, created.data.title),
      userId,
    );
    return created;
  }

  private assertOpen() {
    if (!this.isOpen()) {
      throw new ForbiddenException('Founding Freers sign-up is closed');
    }
  }
}
