# Audit Integration Examples

This document shows practical examples of integrating audit logging into existing controllers.

## Example 1: Item Controller with Full Audit Integration

```typescript
import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { AuditHelperService } from '../audit/audit-helper.service';
import { ItemService } from './item.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { Request } from 'express';

@Controller('items')
@UseGuards(JwtAuthGuard)
export class ItemController {
  constructor(
    private readonly itemService: ItemService,
    private readonly auditHelper: AuditHelperService,
  ) {}

  @Post()
  async create(
    @Body() createItemDto: CreateItemDto,
    @GetUser('userId') userId: string,
    @Req() request: Request,
  ) {
    const item = await this.itemService.create(createItemDto, userId);

    // Log creation with audit and activity
    await this.auditHelper.logUserAction({
      userId,
      entityType: 'items',
      entityId: item.id,
      action: 'created',
      activityType: 'create_item',
      newValues: this.auditHelper.sanitizeData(item),
      request,
      metadata: {
        category: createItemDto.category_id,
        isFeature: createItemDto.is_featured,
      },
    });

    return item;
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @GetUser('userId') userId: string,
    @Req() request: Request,
  ) {
    const item = await this.itemService.findOne(id);

    // Log view activity (not audit log, just analytics)
    await this.auditHelper.logUserActivity({
      userId,
      activityType: 'view_item',
      resourceType: 'items',
      resourceId: id,
      request,
      metadata: {
        itemTitle: item.title,
        categoryId: item.category_id,
        viewCount: item.view_count,
      },
    });

    return item;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateItemDto: UpdateItemDto,
    @GetUser('userId') userId: string,
    @Req() request: Request,
  ) {
    // Get old state for comparison
    const oldItem = await this.itemService.findOne(id);

    // Perform update
    const newItem = await this.itemService.update(id, updateItemDto);

    // Calculate what changed
    const changes = this.auditHelper.getChangedFields(oldItem, newItem);

    // Log with detailed change tracking
    await this.auditHelper.logUserAction({
      userId,
      entityType: 'items',
      entityId: id,
      action: 'updated',
      activityType: 'update_item',
      oldValues: this.auditHelper.sanitizeData(oldItem),
      newValues: this.auditHelper.sanitizeData(newItem),
      request,
      metadata: {
        changedFields: Object.keys(changes),
        changes,
      },
    });

    return newItem;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @GetUser('userId') userId: string,
    @Req() request: Request,
  ) {
    const item = await this.itemService.findOne(id);

    await this.itemService.softDelete(id);

    // Critical action - always log
    await this.auditHelper.logCrudOperation({
      userId,
      entityType: 'items',
      entityId: id,
      action: 'deleted',
      oldValues: this.auditHelper.sanitizeData(item),
      request,
      metadata: {
        deletionType: 'soft',
        itemTitle: item.title,
        reason: 'user_requested',
      },
    });

    return { message: 'Item deleted successfully' };
  }

  @Post(':id/reserve')
  async reserve(
    @Param('id') id: string,
    @GetUser('userId') userId: string,
    @Req() request: Request,
  ) {
    const oldItem = await this.itemService.findOne(id);
    const newItem = await this.itemService.reserve(id);

    // Log important status change
    await this.auditHelper.logUserAction({
      userId,
      entityType: 'items',
      entityId: id,
      action: 'updated',
      activityType: 'reserve_item',
      oldValues: { status: oldItem.status },
      newValues: { status: newItem.status },
      request,
      metadata: {
        previousStatus: oldItem.status,
        newStatus: newItem.status,
      },
    });

    return newItem;
  }
}
```

## Example 2: Auth Controller with Security Auditing

```typescript
import {
  Controller,
  Post,
  Body,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuditHelperService } from '../audit/audit-helper.service';
import { LoginDto } from './dto/login.dto';
import { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditHelper: AuditHelperService,
  ) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto, @Req() request: Request) {
    try {
      const result = await this.authService.login(loginDto);

      // Log successful login
      await this.auditHelper.logUserActivity({
        userId: result.user.id,
        activityType: 'login',
        request,
        sessionId: result.session?.id,
        metadata: {
          loginMethod: loginDto.email ? 'email' : 'phone',
          success: true,
        },
      });

      return result;
    } catch (error) {
      // Log failed login attempt
      await this.auditHelper.logUserActivity({
        userId: 'unknown',
        activityType: 'login_failed',
        request,
        metadata: {
          loginMethod: loginDto.email ? 'email' : 'phone',
          identifier: loginDto.email || loginDto.phone_number,
          error: error.message,
        },
      });

      throw error;
    }
  }

  @Post('logout')
  async logout(@GetUser('userId') userId: string, @Req() request: Request) {
    await this.authService.logout(userId);

    await this.auditHelper.logUserActivity({
      userId,
      activityType: 'logout',
      request,
      metadata: {
        logoutType: 'user_initiated',
      },
    });

    return { message: 'Logged out successfully' };
  }
}
```

## Example 3: User Controller with Profile Changes

```typescript
import { Controller, Patch, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { AuditHelperService } from '../audit/audit-helper.service';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { Request } from 'express';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly auditHelper: AuditHelperService,
  ) {}

  @Patch('profile')
  async updateProfile(
    @Body() updateUserDto: UpdateUserDto,
    @GetUser('userId') userId: string,
    @Req() request: Request,
  ) {
    const oldUser = await this.userService.findOne(userId);
    const newUser = await this.userService.updateProfile(userId, updateUserDto);

    // Sanitize sensitive data
    const sanitizedOld = this.auditHelper.sanitizeData(oldUser);
    const sanitizedNew = this.auditHelper.sanitizeData(newUser);

    await this.auditHelper.logCrudOperation({
      userId,
      entityType: 'users',
      entityId: userId,
      action: 'updated',
      oldValues: sanitizedOld,
      newValues: sanitizedNew,
      request,
      metadata: {
        updateType: 'profile',
      },
    });

    return sanitizedNew;
  }

  @Patch('role')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async changeUserRole(
    @Body() body: { userId: string; newRole: UserRole },
    @GetUser('userId') adminId: string,
    @Req() request: Request,
  ) {
    const oldUser = await this.userService.findOne(body.userId);
    const newUser = await this.userService.updateRole(
      body.userId,
      body.newRole,
    );

    // Critical action - log with extra detail
    await this.auditHelper.logCrudOperation({
      userId: adminId,
      entityType: 'users',
      entityId: body.userId,
      action: 'updated',
      oldValues: { role: oldUser.role },
      newValues: { role: newUser.role },
      request,
      metadata: {
        criticalAction: 'role_change',
        performedBy: adminId,
        targetUser: body.userId,
        oldRole: oldUser.role,
        newRole: body.newRole,
        permanent: true, // Flag to keep this log permanently
      },
    });

    return newUser;
  }
}
```

## Example 4: Category Controller with Admin Actions

```typescript
import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/entities/user.entity';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { AuditHelperService } from '../audit/audit-helper.service';
import { CategoryService } from './category.service';
import { Request } from 'express';

@Controller('categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class CategoryController {
  constructor(
    private readonly categoryService: CategoryService,
    private readonly auditHelper: AuditHelperService,
  ) {}

  @Post()
  async create(
    @Body() createCategoryDto: CreateCategoryDto,
    @GetUser('userId') userId: string,
    @Req() request: Request,
  ) {
    const category = await this.categoryService.create(createCategoryDto);

    // Admin action - log it
    await this.auditHelper.logCrudOperation({
      userId,
      entityType: 'categories',
      entityId: category.id,
      action: 'created',
      newValues: category,
      request,
      metadata: {
        adminAction: true,
        parentCategoryId: createCategoryDto.parent_category_id,
      },
    });

    return category;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @GetUser('userId') userId: string,
    @Req() request: Request,
  ) {
    const category = await this.categoryService.findOne(id);

    await this.categoryService.remove(id);

    // Critical admin action
    await this.auditHelper.logCrudOperation({
      userId,
      entityType: 'categories',
      entityId: id,
      action: 'deleted',
      oldValues: category,
      request,
      metadata: {
        adminAction: true,
        criticalAction: 'category_deletion',
        categoryName: category.name,
        hadSubcategories: category.subcategories?.length > 0,
        permanent: true,
      },
    });

    return { message: 'Category deleted successfully' };
  }
}
```

## Example 5: System Events for Batch Operations

```typescript
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  SystemEventService,
  SystemEventType,
} from '../audit/system-event.service';
import { ItemService } from './item.service';

@Injectable()
export class ItemCleanupService {
  constructor(
    private readonly itemService: ItemService,
    private readonly systemEventService: SystemEventService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredItems() {
    const startTime = Date.now();

    // Start tracking the event
    const event = await this.systemEventService.startEvent(
      SystemEventType.SCHEDULED_JOB,
      'Daily Item Cleanup',
      'Removing expired featured items and unavailable items older than 30 days',
    );

    try {
      // Perform cleanup
      const expiredFeatured = await this.itemService.removeExpiredFeatured();
      const oldUnavailable = await this.itemService.removeOldUnavailable();
      const totalAffected = expiredFeatured + oldUnavailable;

      // Mark as completed
      await this.systemEventService.completeEvent(
        event.id,
        totalAffected,
        Date.now() - startTime,
      );

      console.log(`✅ Cleanup completed: ${totalAffected} items processed`);
    } catch (error) {
      // Mark as failed
      await this.systemEventService.failEvent(
        event.id,
        error.message,
        Date.now() - startTime,
      );

      console.error(`❌ Cleanup failed:`, error);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateItemViewCounts() {
    const startTime = Date.now();

    const event = await this.systemEventService.startEvent(
      SystemEventType.BATCH_PROCESS,
      'Update Item View Counts',
      'Syncing cached view counts to database',
    );

    try {
      const updatedCount = await this.itemService.syncViewCounts();

      await this.systemEventService.completeEvent(
        event.id,
        updatedCount,
        Date.now() - startTime,
      );
    } catch (error) {
      await this.systemEventService.failEvent(
        event.id,
        error.message,
        Date.now() - startTime,
      );
    }
  }
}
```

## Example 6: Search Activity Logging

```typescript
@Get('search')
async search(
  @Query() searchDto: SearchItemsDto,
  @GetUser('userId') userId: string,
  @Req() request: Request,
) {
  const startTime = Date.now();

  const result = await this.itemService.search(searchDto);

  // Log search activity for analytics
  await this.auditHelper.logUserActivity({
    userId,
    activityType: 'search',
    resourceType: 'items',
    request,
    metadata: {
      searchTerm: searchDto.q,
      categoryId: searchDto.category_id,
      locationId: searchDto.location_id,
      resultsCount: result.items.length,
      totalResults: result.total,
      duration: Date.now() - startTime,
      filters: {
        condition: searchDto.condition,
        isFree: searchDto.is_free,
        minPrice: searchDto.min_price,
        maxPrice: searchDto.max_price,
      },
    },
  });

  return result;
}
```

## Key Takeaways

1. **Use `AuditHelperService`** for consistent logging across controllers
2. **Log critical actions** like deletions, role changes, and admin operations
3. **Capture old and new values** for important updates
4. **Sanitize sensitive data** before logging (passwords, tokens, etc.)
5. **Log user activities** for analytics (views, searches, etc.)
6. **Track system events** for batch jobs and cron tasks
7. **Include metadata** for context (search terms, filters, etc.)
8. **Flag permanent logs** for critical actions that should never be deleted

## When to Audit

| Action           | Audit Log | Activity Log | System Event |
| ---------------- | --------- | ------------ | ------------ |
| Item created     | ✅        | ✅           | ❌           |
| Item updated     | ✅        | ✅           | ❌           |
| Item deleted     | ✅        | ✅           | ❌           |
| Item viewed      | ❌        | ✅           | ❌           |
| Search performed | ❌        | ✅           | ❌           |
| User login       | ❌        | ✅           | ❌           |
| Role changed     | ✅        | ✅           | ❌           |
| Batch cleanup    | ❌        | ❌           | ✅           |
| Cron job         | ❌        | ❌           | ✅           |
| System alert     | ❌        | ❌           | ✅           |
