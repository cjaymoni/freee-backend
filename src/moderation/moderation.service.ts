import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItemService } from '../item/item.service';
import { UserService } from '../user/user.service';
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
    return this.reportedItemRepo.save(report);
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
    return this.reportedUserRepo.save(report);
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
    return this.blockedUserRepo.save(block);
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
    return this.blockedUserRepo.find({
      where: { blockerId, isDeleted: false },
      relations: ['blocked'],
      order: { createdAt: 'DESC' },
    });
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
      await this.itemService.adminRemove(
        reviewerId,
        report.itemId,
        'Removed due to moderation',
      );
    }

    return this.reportedItemRepo.save(report);
  }

  async resolveUserReport(
    id: string,
    dto: ResolveReportDto,
    reviewerId: string,
  ) {
    const report = await this.reportedUserRepo.findOne({ where: { id } });
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
    return this.reportedItemRepo.find({
      where: { ...(status && { status }), ...(reporterId && { reporterId }) },
      relations: reporterId
        ? ['item', 'reporter']
        : ['item', 'reporter', 'reviewer'],
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
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
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
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
