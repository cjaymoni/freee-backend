import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './decorators/roles.decorator';
import { UserRole } from '../user/entities/user.entity';
import { AdminUsersController } from '../admin/admin-users.controller';
import { AppController } from '../app.controller';
import { AuditController } from '../audit/audit.controller';
import { AuthController } from './auth.controller';
import { FirebaseAuthController } from './firebase-auth.controller';
import { CategoryController } from '../category/category.controller';
import { ChatController } from '../chat/chat.controller';
import { HealthController } from '../health/health.controller';
import { ItemRequestController } from '../item-request/item-request.controller';
import { ItemViewController } from '../item-view/item-view.controller';
import { ItemImageController } from '../item/item-image.controller';
import { ItemController } from '../item/item.controller';
import { ModerationController } from '../moderation/moderation.controller';
import { SavedItemController } from '../saved-item/saved-item.controller';
import { SearchController } from '../search/search.controller';
import { UserLocationController } from '../user/user-location.controller';
import { UserPreferenceController } from '../user/user-preference.controller';
import { UserController } from '../user/user.controller';

const { ADMIN, MODERATOR } = UserRole;
const STAFF = [ADMIN, MODERATOR];

/**
 * The back office permission matrix (docs/BACKOFFICE_BUILD_PLAN.md). Every
 * handler that carries @Roles is listed; any other handler must carry none.
 * Handlers that check the role in code (e.g. PATCH /user/:id) are covered by
 * their own controller specs.
 */
const MATRIX: Record<string, UserRole[]> = {
  'AdminUsersController.changeRole': [ADMIN],
  'AuditController.findAll': [ADMIN],
  'AuditController.getEntityHistory': [ADMIN],
  'AuthController.register': [ADMIN],
  'CategoryController.create': [ADMIN],
  'CategoryController.update': [ADMIN],
  'CategoryController.remove': [ADMIN],
  'CategoryController.toggleActive': [ADMIN],
  'ItemController.feature': [ADMIN],
  'ItemController.unfeature': [ADMIN],
  'ModerationController.resolveItemReport': STAFF,
  'ModerationController.resolveUserReport': STAFF,
  'ModerationController.resolveComplaint': STAFF,
  'UserController.findAll': STAFF,
  'UserLocationController.findAllAdmin': STAFF,
};

const CONTROLLERS = [
  AdminUsersController,
  AppController,
  AuditController,
  AuthController,
  FirebaseAuthController,
  CategoryController,
  ChatController,
  HealthController,
  ItemRequestController,
  ItemViewController,
  ItemImageController,
  ItemController,
  ModerationController,
  SavedItemController,
  SearchController,
  UserLocationController,
  UserPreferenceController,
  UserController,
];

function actualRoles() {
  const reflector = new Reflector();
  const roles: Record<string, UserRole[]> = {};
  for (const controller of CONTROLLERS) {
    const proto = controller.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const required = reflector.getAllAndOverride<UserRole[] | undefined>(
        ROLES_KEY,
        [handler, controller],
      );
      if (required) roles[`${controller.name}.${name}`] = [...required].sort();
    }
  }
  return roles;
}

describe('Role-restricted endpoints', () => {
  const actual = actualRoles();

  it.each(Object.entries(MATRIX))('%s allows %j', (handler, roles) => {
    expect(actual[handler]).toEqual([...roles].sort());
  });

  it('restricts no other handler', () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(MATRIX).sort());
  });
});
