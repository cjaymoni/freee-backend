import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { STAFF_ROLES, UserRole } from '../user/entities/user.entity';
import { AdminItemsService } from './admin-items.service';
import { AdminItemQueryDto } from './dto/admin-query.dto';
import { OptionalReasonDto, ReasonDto } from './dto/moderation-action.dto';

/**
 * Listings as staff see them: hidden and removed ones included. Featuring and
 * removing stay on /items (admin only); these actions are all reversible.
 */
@ApiTags('Admin - Listings')
@ApiBearerAuth()
@Controller('admin/items')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class AdminItemsController {
  constructor(private readonly adminItemsService: AdminItemsService) {}

  @Get()
  @ApiOperation({ summary: 'Search and filter every listing (staff)' })
  list(@Query() query: AdminItemQueryDto) {
    return this.adminItemsService.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'A listing with its sharer, requests (in order) and reports (staff)',
  })
  @ApiParam({ name: 'id', description: 'Listing ID' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminItemsService.detail(id);
  }

  @Post(':id/hide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hide a listing from the app (staff)',
    description:
      'The owner still sees it, marked hidden with the reason. New requests and confirmations are refused until it is restored.',
  })
  @ApiResponse({
    status: 409,
    description: 'Already hidden',
    type: ErrorResponseDto,
  })
  hide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    return this.adminItemsService.hide(
      { userId, role },
      id,
      dto.reason,
      request,
    );
  }

  @Post(':id/flag')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Flag a listing for review (staff)',
    description: 'It stays visible in the app.',
  })
  flag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    return this.adminItemsService.flag(
      { userId, role },
      id,
      dto.reason,
      request,
    );
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make a hidden or flagged listing visible again (staff)',
  })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalReasonDto,
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Req() request: Request,
  ) {
    return this.adminItemsService.restore(
      { userId, role },
      id,
      dto.reason,
      request,
    );
  }
}
