# Using Audit Constants

## Import Constants

```typescript
import {
  AuditEntityType,
  AuditAction,
  UserActivityType,
  SystemEventName,
  AuditMetadataKey,
  SystemEventType,
  SystemEventStatus,
} from '../audit/audit.module';
```

## Example Usage

### 1. Item Controller with Constants

```typescript
import {
  AuditEntityType,
  AuditAction,
  UserActivityType,
} from '../audit/audit.module';

@Controller('items')
export class ItemController {
  @Post()
  async create(
    @Body() dto: CreateItemDto,
    @GetUser('userId') userId: string,
    @Req() req: Request,
  ) {
    const item = await this.itemService.create(dto, userId);

    // Using constants for consistency
    await this.auditHelper.logUserAction({
      userId,
      entityType: AuditEntityType.ITEMS, // ✅ Type-safe
      entityId: item.id,
      action: AuditAction.CREATED, // ✅ Consistent
      activityType: UserActivityType.CREATE_ITEM, // ✅ Standardized
      newValues: item,
      request: req,
    });

    return item;
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @GetUser('userId') userId: string,
    @Req() req: Request,
  ) {
    const item = await this.itemService.findOne(id);

    await this.auditHelper.logUserActivity({
      userId,
      activityType: UserActivityType.VIEW_ITEM, // ✅ Consistent
      resourceType: AuditEntityType.ITEMS,
      resourceId: id,
      request: req,
      metadata: {
        [AuditMetadataKey.ITEM_TITLE]: item.title,
        [AuditMetadataKey.ITEM_CATEGORY]: item.category?.name,
      },
    });

    return item;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @GetUser('userId') userId: string,
    @Req() req: Request,
  ) {
    const oldItem = await this.itemService.findOne(id);
    const newItem = await this.itemService.update(id, dto);

    await this.auditHelper.logUserAction({
      userId,
      entityType: AuditEntityType.ITEMS,
      entityId: id,
      action: AuditAction.UPDATED,
      activityType: UserActivityType.UPDATE_ITEM,
      oldValues: oldItem,
      newValues: newItem,
      request: req,
    });

    return newItem;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @GetUser('userId') userId: string,
    @Req() req: Request,
  ) {
    const item = await this.itemService.findOne(id);
    await this.itemService.softDelete(id);

    await this.auditHelper.logCrudOperation({
      userId,
      entityType: AuditEntityType.ITEMS,
      entityId: id,
      action: AuditAction.DELETED,
      oldValues: item,
      request: req,
      metadata: {
        [AuditMetadataKey.REASON]: 'user_requested',
      },
    });

    return { message: 'Item deleted successfully' };
  }
}
```

### 2. Auth Controller with Constants

```typescript
import { UserActivityType } from '../audit/audit.module';

@Controller('auth')
export class AuthController {
  @Post('login')
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {
    try {
      const result = await this.authService.login(loginDto);

      await this.auditHelper.logUserActivity({
        userId: result.user.id,
        activityType: UserActivityType.LOGIN, // ✅ Consistent
        request: req,
        sessionId: result.session?.id,
        metadata: {
          loginMethod: loginDto.email ? 'email' : 'phone',
        },
      });

      return result;
    } catch (error) {
      await this.auditHelper.logUserActivity({
        userId: 'unknown',
        activityType: UserActivityType.LOGIN_FAILED, // ✅ Track failures
        request: req,
        metadata: {
          identifier: loginDto.email || loginDto.phone_number,
          error: error.message,
        },
      });

      throw error;
    }
  }

  @Post('logout')
  async logout(@GetUser('userId') userId: string, @Req() req: Request) {
    await this.authService.logout(userId);

    await this.auditHelper.logUserActivity({
      userId,
      activityType: UserActivityType.LOGOUT,
      request: req,
    });

    return { message: 'Logged out successfully' };
  }
}
```

### 3. System Events with Constants

```typescript
import {
  SystemEventType,
  SystemEventName,
  SystemEventStatus,
} from '../audit/audit.module';

@Injectable()
export class ItemCleanupService {
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredItems() {
    const startTime = Date.now();

    const event = await this.systemEventService.startEvent(
      SystemEventType.SCHEDULED_JOB, // ✅ Type-safe
      SystemEventName.DAILY_ITEM_CLEANUP, // ✅ Consistent name
      'Removing expired featured items',
    );

    try {
      const count = await this.itemService.removeExpiredItems();

      await this.systemEventService.completeEvent(
        event.id,
        count,
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

  @Cron(CronExpression.EVERY_HOUR)
  async syncViewCounts() {
    const startTime = Date.now();

    const event = await this.systemEventService.startEvent(
      SystemEventType.BATCH_PROCESS,
      SystemEventName.VIEW_COUNT_SYNC,
      'Syncing cached view counts to database',
    );

    try {
      const count = await this.itemService.syncViewCounts();
      await this.systemEventService.completeEvent(
        event.id,
        count,
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

### 4. Search Activity with Constants

```typescript
import { UserActivityType, AuditMetadataKey } from '../audit/audit.module';

@Get('search')
async search(@Query() searchDto: SearchItemsDto, @GetUser('userId') userId: string, @Req() req: Request) {
  const result = await this.itemService.search(searchDto);

  await this.auditHelper.logUserActivity({
    userId,
    activityType: UserActivityType.SEARCH_ITEMS,
    resourceType: AuditEntityType.ITEMS,
    request: req,
    metadata: {
      [AuditMetadataKey.SEARCH_TERM]: searchDto.q,
      [AuditMetadataKey.SEARCH_FILTERS]: {
        categoryId: searchDto.category_id,
        locationId: searchDto.location_id,
        condition: searchDto.condition,
      },
      [AuditMetadataKey.RESULTS_COUNT]: result.items.length,
    },
  });

  return result;
}
```

### 5. Admin Actions with Constants

```typescript
import { AuditEntityType, AuditAction, UserActivityType, AuditMetadataKey } from '../audit/audit.module';

@Patch('role')
@Roles(UserRole.ADMIN)
async changeUserRole(
  @Body() body: { userId: string; newRole: UserRole },
  @GetUser('userId') adminId: string,
  @Req() req: Request,
) {
  const oldUser = await this.userService.findOne(body.userId);
  const newUser = await this.userService.updateRole(body.userId, body.newRole);

  // Critical admin action
  await this.auditHelper.logCrudOperation({
    userId: adminId,
    entityType: AuditEntityType.USERS,
    entityId: body.userId,
    action: AuditAction.UPDATED,
    oldValues: { role: oldUser.role },
    newValues: { role: newUser.role },
    request: req,
    metadata: {
      [AuditMetadataKey.CRITICAL_ACTION]: 'role_change',
      [AuditMetadataKey.PERFORMED_BY]: adminId,
      [AuditMetadataKey.TARGET_USER]: body.userId,
      [AuditMetadataKey.PREVIOUS_ROLE]: oldUser.role,
      [AuditMetadataKey.NEW_ROLE]: body.newRole,
      [AuditMetadataKey.PERMANENT]: true, // Keep forever
    },
  });

  return newUser;
}
```

## Benefits of Using Constants

1. **Type Safety** - Autocomplete and compile-time checking
2. **Consistency** - Same activity names across the app
3. **Refactoring** - Easy to rename/reorganize
4. **Documentation** - Self-documenting code
5. **Querying** - Standardized values for filtering
6. **Analytics** - Consistent data for reporting

## Querying with Constants

```typescript
// Find all item creations
const logs = await this.auditService.findAll({
  entityType: AuditEntityType.ITEMS,
  action: AuditAction.CREATED,
});

// Find all login failures
const failures = await this.userActivityService.getUserActivity(userId, {
  activityType: UserActivityType.LOGIN_FAILED,
});

// Monitor failed cron jobs
const failedJobs = await this.systemEventService.findAll({
  eventType: SystemEventType.SCHEDULED_JOB,
  status: SystemEventStatus.FAILED,
});
```

## Adding New Constants

When adding new features, add corresponding constants:

```typescript
// In audit.constants.ts
export enum AuditEntityType {
  // ... existing
  PAYMENTS = 'payments',
  TRANSACTIONS = 'transactions',
}

export enum UserActivityType {
  // ... existing
  INITIATE_PAYMENT = 'initiate_payment',
  COMPLETE_PAYMENT = 'complete_payment',
  REFUND_PAYMENT = 'refund_payment',
}
```

Then use them in your new controllers:

```typescript
@Post('payment')
async createPayment(@Body() dto: CreatePaymentDto, @GetUser('userId') userId: string) {
  const payment = await this.paymentService.create(dto);

  await this.auditHelper.logUserAction({
    userId,
    entityType: AuditEntityType.PAYMENTS, // ✅ New constant
    entityId: payment.id,
    action: AuditAction.CREATED,
    activityType: UserActivityType.INITIATE_PAYMENT, // ✅ New constant
    newValues: this.auditHelper.sanitizeData(payment),
  });

  return payment;
}
```

## Best Practices

1. **Always use constants** instead of string literals
2. **Import from audit.module** for consistency
3. **Add new constants** when adding new features
4. **Document custom metadata** in constants file
5. **Use metadata keys** for structured data
