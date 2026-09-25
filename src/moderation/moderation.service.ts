import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ItemService } from '../item/item.service';
import { UserService } from '../user/user.service';
import { isStaff } from '../user/entities/user.entity';
import { ReportedItem } from './entities/reported-item.entity';
import { ReportedUser } from './entities/reported-user.entity';
import { BlockedUser } from './entities/blocked-user.entity';
import { ModerationComplaint } from './entities/moderation-complaint.entity';
import { CreateReportedItemDto } from './dto/create-reported-item.dto';
import { CreateReportedUserDto } from './dto/create-reported-user.dto';
import { CreateBlockedUserDto } from './dto/create-blocked-user.dto';
import { ActionTaken, ResolveReportDto } from './dto/resolve-report.dto';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { ResolveComplaintDto } from './dto/resolve-complaint.dto';

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Most urgent first, newest first within a priority. Sorting the varchar
 * column in SQL would be alphabetical: urgent, medium, low, high. The lists
 * aren't paged, so ranking in memory is exact. Sorts in place.
 */
function byPriority<T extends { priority: string }>(reports: T[]): T[] {
  // Array.prototype.sort is stable, so the createdAt order is kept within
  // each priority.
  return reports.sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority] ?? Number.MAX_SAFE_INTEGER) -
      (PRIORITY_RANK[b.priority] ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * Reports and blocks name their target by id with a foreign key, so an id
 * that doesn't exist fails the insert (23503). Answer that as a 404 rather
 * than a 500.
 */
async function saveOr404<T>(save: Promise<T>, message: string): Promise<T> {
  try {
    return await save;
  } catch (error) {
    if (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code === '23503'
    ) {
      throw new NotFoundException(message);
    }
    throw error;
  }
}

@Injectable()
export class ModerationService {
  constructor(
    @InjectRepository(ReportedItem)
    private reportedItemRepo: Repository<ReportedItem>,
    @InjectRepository(ReportedUser)
    private reportedUserRepo: Repository<ReportedUser>,
    @InjectRepository(BlockedUser)
    private blockedUserRepo: Repository<BlockedUser>,
    @InjectRepository(ModerationComplaint)
    private complaintRepo: Repository<ModerationComplaint>,
    @Inject(forwardRef(() => ItemService))
    private itemService: ItemService,
    @Inject(forwardRef(() => UserService))
    private userService: UserService,
  ) {}

  async reportItem(dto: CreateReportedItemDto, reporterId: string) {
    const report = this.reportedItemRepo.create({
      ...dto,
      reporterId,
      priority: dto.priority || 'medium',
    });
    return saveOr404(this.reportedItemRepo.save(report), 'Item not found');
  }

  async reportUser(dto: CreateReportedUserDto, reporterId: string) {
    if (dto.reportedUserId === reporterId) {
      throw new BadRequestException('Cannot report yourself');
    }
    const report = this.reportedUserRepo.create({
      ...dto,
      reporterId,
      priority: dto.priority || 'medium',
    });
    return saveOr404(this.reportedUserRepo.save(report), 'User not found');
  }

  async blockUser(dto: CreateBlockedUserDto, blockerId: string) {
    if (dto.blockedId === blockerId) {
      throw new BadRequestException('Cannot block yourself');
    }
    const existing = await this.blockedUserRepo.findOne({
      where: { blockerId, blockedId: dto.blockedId, isDeleted: false },
    });
    if (existing) {
      throw new BadRequestException('User already blocked');
    }
    const block = this.blockedUserRepo.create({ ...dto, blockerId });
    return saveOr404(this.blockedUserRepo.save(block), 'User not found');
  }

  async unblockUser(blockedId: string, blockerId: string) {
    const block = await this.blockedUserRepo.findOne({
      where: { blockerId, blockedId, isDeleted: false },
    });
    if (!block) {
      throw new NotFoundException('Block not found');
    }
    block.isDeleted = true;
    block.deletedAt = new Date();
    return this.blockedUserRepo.save(block);
  }

  async getBlockedUsers(blockerId: string) {
    const blocks = await this.blockedUserRepo.find({
      where: { blockerId, isDeleted: false },
      relations: ['blocked'],
      order: { createdAt: 'DESC' },
    });
    // Anyone can block any user id, so the embedded user must be the public
    // profile only - never email, fcm_token, date_of_birth, lockout state...
    // Field names are kept as before so existing clients keep parsing.
    return blocks.map(({ blocked, ...block }) => ({
      ...block,
      blocked: blocked && {
        id: blocked.id,
        first_name: blocked.first_name,
        last_name: blocked.last_name,
        cloudinary_avatar_url: blocked.cloudinary_avatar_url,
      },
    }));
  }

  async resolveItemReport(
    id: string,
    dto: ResolveReportDto,
    reviewerId: string,
  ) {
    const report = await this.reportedItemRepo.findOne({ where: { id } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    Object.assign(report, {
      ...dto,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      resolvedAt: ['resolved', 'dismissed'].includes(dto.status)
        ? new Date()
        : null,
    });

    if (dto.actionTaken === ActionTaken.ITEM_REMOVED) {
      try {
        await this.itemService.adminRemove(
          reviewerId,
          report.itemId,
          'Removed due to moderation',
        );
      } catch (error) {
        // adminRemove only finds live items, and reports reference items by
        // foreign key, so a 404 means an earlier report (or the owner)
        // already removed it. The outcome this report asks for holds, so it
        // still gets resolved instead of being stuck in the queue.
        if (!(error instanceof NotFoundException)) throw error;
      }
    }

    return this.reportedItemRepo.save(report);
  }

  async resolveUserReport(
    id: string,
    dto: ResolveReportDto,
    reviewerId: string,
  ) {
    const report = await this.reportedUserRepo.findOne({
      where: { id },
      relations: ['reportedUser'],
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    Object.assign(report, {
      ...dto,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      resolvedAt: ['resolved', 'dismissed'].includes(dto.status)
        ? new Date()
        : null,
    });

    // item_removed is the pre-user_suspended way of suspending from a user
    // report; still honoured so existing admin tooling keeps working.
    if (
      dto.actionTaken === ActionTaken.USER_SUSPENDED ||
      dto.actionTaken === ActionTaken.ITEM_REMOVED
    ) {
      // Moderators resolve reports too; neither they nor an admin may lock a
      // staff account out from a report.
      if (isStaff(report.reportedUser?.role)) {
        throw new ForbiddenException(
          'Staff accounts cannot be suspended from a report',
        );
      }
      await this.userService.update(report.reportedUserId, {
        is_active: false,
      });
    }

    return this.reportedUserRepo.save(report);
  }

  /**
   * All item reports for admins. Pass `reporterId` to list only the reports a
   * regular user filed; the reviewing admin is then left out.
   */
  async getItemReports(status?: string, reporterId?: string) {
    const reports = await this.reportedItemRepo.find({
      where: { ...(status && { status }), ...(reporterId && { reporterId }) },
      relations: reporterId
        ? ['item', 'reporter']
        : ['item', 'reporter', 'reviewer'],
      order: { createdAt: 'DESC' },
    });
    return byPriority(reports);
  }

  /**
   * All user reports for admins. Pass `reporterId` to list only the reports a
   * regular user filed; the reported user is then reduced to public profile
   * fields and the reviewing admin is left out.
   */
  async getUserReports(status?: string, reporterId?: string) {
    const reports = await this.reportedUserRepo.find({
      where: { ...(status && { status }), ...(reporterId && { reporterId }) },
      relations: reporterId
        ? ['reportedUser', 'reporter']
        : ['reportedUser', 'reporter', 'reviewer'],
      order: { createdAt: 'DESC' },
    });
    byPriority(reports);
    if (!reporterId) return reports;

    return reports.map((report) => ({
      ...report,
      reportedUser: report.reportedUser && {
        id: report.reportedUser.id,
        first_name: report.reportedUser.first_name,
        last_name: report.reportedUser.last_name,
        cloudinary_avatar_url: report.reportedUser.cloudinary_avatar_url,
      },
    }));
  }

  async createComplaint(dto: CreateComplaintDto, userId: string) {
    const complaint = this.complaintRepo.create({ ...dto, userId });
    return this.complaintRepo.save(complaint);
  }

  async resolveComplaint(
    id: string,
    dto: ResolveComplaintDto,
    reviewerId: string,
  ) {
    const complaint = await this.complaintRepo.findOne({ where: { id } });
    if (!complaint) {
      throw new NotFoundException('Complaint not found');
    }
    Object.assign(complaint, {
      ...dto,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      resolvedAt: ['resolved', 'rejected'].includes(dto.status)
        ? new Date()
        : null,
    });
    return this.complaintRepo.save(complaint);
  }

  /** All complaints for admins, or only `userId`'s own for a regular user. */
  async getComplaints(status?: string, userId?: string) {
    return this.complaintRepo.find({
      where: { ...(status && { status }), ...(userId && { userId }) },
      relations: userId ? ['user'] : ['user', 'reviewer'],
      order: { createdAt: 'DESC' },
    });
  }

  async getUserComplaints(userId: string) {
    return this.complaintRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }
}
