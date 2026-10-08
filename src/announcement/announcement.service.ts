import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AppError } from '../common/app-error';
import {
  AnnouncementEntity,
  AnnouncementLevel,
} from './entities/announcement.entity';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

export type AnnouncementState = 'live' | 'scheduled' | 'ended' | 'off';

/** Where a banner stands right now. */
export function announcementState(
  a: Pick<AnnouncementEntity, 'is_active' | 'active_from' | 'active_until'>,
  now = new Date(),
): AnnouncementState {
  if (!a.is_active) return 'off';
  if (a.active_from > now) return 'scheduled';
  if (a.active_until && a.active_until <= now) return 'ended';
  return 'live';
}

@Injectable()
export class AnnouncementService {
  constructor(
    @InjectRepository(AnnouncementEntity)
    private readonly announcements: Repository<AnnouncementEntity>,
  ) {}

  /** What the apps show now, newest first. */
  active(now = new Date()): Promise<AnnouncementEntity[]> {
    return this.announcements
      .createQueryBuilder('a')
      .where('a.is_active = true')
      .andWhere('a.active_from <= :now', { now })
      .andWhere(
        new Brackets((w) =>
          w
            .where('a.active_until IS NULL')
            .orWhere('a.active_until > :now', { now }),
        ),
      )
      .orderBy('a.active_from', 'DESC')
      .getMany();
  }

  list(page: number, limit: number) {
    return this.announcements.findAndCount({
      relations: ['creator'],
      order: { created_at: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async create(
    dto: CreateAnnouncementDto,
    createdBy: string,
  ): Promise<AnnouncementEntity> {
    const row = this.announcements.create({
      message: dto.message,
      level: dto.level ?? AnnouncementLevel.INFO,
      active_from: dto.active_from ? new Date(dto.active_from) : new Date(),
      active_until: dto.active_until ? new Date(dto.active_until) : null,
      is_active: dto.is_active ?? true,
      created_by: createdBy,
    });
    assertDates(row);
    const saved = await this.announcements.save(row);
    return this.get(saved.id);
  }

  /** @returns the banner before and after the change. */
  async update(id: string, dto: UpdateAnnouncementDto) {
    const before = await this.get(id);
    const after = this.announcements.merge(
      this.announcements.create({ ...before }),
      {
        ...(dto.message !== undefined && { message: dto.message }),
        ...(dto.level !== undefined && { level: dto.level }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        ...(dto.active_from !== undefined && {
          active_from: new Date(dto.active_from),
        }),
        ...(dto.active_until !== undefined && {
          active_until: dto.active_until ? new Date(dto.active_until) : null,
        }),
      },
    );
    assertDates(after);
    await this.announcements.update(id, {
      message: after.message,
      level: after.level,
      is_active: after.is_active,
      active_from: after.active_from,
      active_until: after.active_until,
    });
    return { before, after: await this.get(id) };
  }

  async remove(id: string): Promise<AnnouncementEntity> {
    const row = await this.get(id);
    await this.announcements.delete(id);
    return row;
  }

  private async get(id: string): Promise<AnnouncementEntity> {
    const row = await this.announcements.findOne({
      where: { id },
      relations: ['creator'],
    });
    if (!row) throw new AppError(new NotFoundException('Banner not found'));
    return row;
  }
}

function assertDates(
  a: Pick<AnnouncementEntity, 'active_from' | 'active_until'>,
) {
  if (a.active_until && a.active_until <= a.active_from) {
    throw new AppError(
      new BadRequestException('The end has to be after the start'),
    );
  }
}
