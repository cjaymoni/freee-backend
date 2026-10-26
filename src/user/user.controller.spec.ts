import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UserRole } from './entities/user.entity';
import { NotificationService } from '../notification/notification.service';

const SESSION = 'session-token-1';

describe('UserController', () => {
  let controller: UserController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: CloudinaryService,
          useValue: { uploadImage: jest.fn() },
        },
        { provide: NotificationService, useValue: {} },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

describe('UserController authorization', () => {
  let controller: UserController;
  let userService: {
    update: jest.Mock;
    remove: jest.Mock;
    findOne: jest.Mock;
    findOneEntityWithPassword: jest.Mock;
  };
  let notifications: {
    registerDevice: jest.Mock;
    unregisterDevice: jest.Mock;
  };

  const USER_ID = '11111111-1111-1111-1111-111111111111';
  const OTHER_ID = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    userService = {
      update: jest.fn().mockResolvedValue({ state: true }),
      remove: jest.fn().mockResolvedValue({ state: true }),
      findOne: jest.fn().mockResolvedValue({ state: true, data: {} }),
      findOneEntityWithPassword: jest
        .fn()
        .mockResolvedValue({ id: USER_ID, password_hash: null }),
    };
    notifications = {
      registerDevice: jest.fn().mockResolvedValue(true),
      unregisterDevice: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: userService },
        { provide: CloudinaryService, useValue: {} },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();
    controller = module.get<UserController>(UserController);
  });

  describe('device tokens', () => {
    it('registers the FCM token on the calling session', async () => {
      const result = await controller.updateFcmToken(USER_ID, SESSION, {
        fcm_token: 'fcm-1',
      });
      expect(notifications.registerDevice).toHaveBeenCalledWith(
        USER_ID,
        SESSION,
        'fcm-1',
      );
      expect(userService.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        state: true,
        message: 'FCM token updated successfully',
      });
    });

    it('answers 401 when the session is no longer live', async () => {
      notifications.registerDevice.mockResolvedValueOnce(false);
      await expect(
        controller.updateFcmToken(USER_ID, SESSION, { fcm_token: 'fcm-1' }),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('forgets the token of the calling session only', async () => {
      await controller.removeFcmToken(USER_ID, SESSION);
      expect(notifications.unregisterDevice).toHaveBeenCalledWith(
        USER_ID,
        SESSION,
      );
    });

    it('takes fcm_token out of a profile update and registers it', async () => {
      await controller.update(
        USER_ID,
        { first_name: 'Ama', fcm_token: 'fcm-2' },
        USER_ID,
        UserRole.USER,
        SESSION,
      );
      expect(notifications.registerDevice).toHaveBeenCalledWith(
        USER_ID,
        SESSION,
        'fcm-2',
      );
      expect(userService.update).toHaveBeenCalledWith(USER_ID, {
        first_name: 'Ama',
      });
    });

    it("never stores a token an admin sends for someone else's profile", async () => {
      await controller.update(
        OTHER_ID,
        { fcm_token: 'fcm-3' },
        USER_ID,
        UserRole.ADMIN,
        SESSION,
      );
      expect(notifications.registerDevice).not.toHaveBeenCalled();
      const [, sent] = userService.update.mock.calls[0] as [string, object];
      expect(sent).not.toHaveProperty('fcm_token');
    });
  });

  describe('update', () => {
    it('lets a user edit their own profile fields', async () => {
      await controller.update(
        USER_ID,
        { first_name: 'Ama', bio: 'hi' },
        USER_ID,
        UserRole.USER,
        SESSION,
      );
      expect(userService.update).toHaveBeenCalledWith(USER_ID, {
        first_name: 'Ama',
        bio: 'hi',
      });
    });

    it("rejects a user editing someone else's profile", async () => {
      await expect(
        controller.update(
          OTHER_ID,
          { first_name: 'x' },
          USER_ID,
          UserRole.USER,
          SESSION,
        ),
      ).rejects.toThrow('You can only update your own profile');
      expect(userService.update).not.toHaveBeenCalled();
    });

    it.each([
      [{ email: 'new@example.com' }],
      [{ phone_number: '+233201234567' }],
      [{ password: 'hunter22' }],
      [{ cloudinary_avatar_url: 'https://example.com/a.png' }],
    ])('lets a user set their own %j', async (body) => {
      const result = await controller.update(
        USER_ID,
        body,
        USER_ID,
        UserRole.USER,
        SESSION,
      );
      expect(userService.update).toHaveBeenCalledWith(USER_ID, body);
      expect(result.warnings).toBeUndefined();
    });

    it.each([
      ['role', 'ADMIN'],
      ['is_active', true],
      ['is_email_verified', true],
      ['is_phone_verified', true],
      ['firebase_uid', 'someone-else'],
      ['is_deleted', true],
      ['deleted_at', new Date()],
      ['failed_login_attempts', 0],
      ['account_locked_until', new Date()],
      ['member_since', new Date('2001-01-01')],
      ['cloudinary_avatar_public_id', 'avatars/user_someone-else'],
      ['requires_password_change', false],
    ])(
      'ignores non-profile field %s from a user and says so',
      async (field, value) => {
        const result = await controller.update(
          USER_ID,
          { first_name: 'Ama', [field]: value },
          USER_ID,
          UserRole.USER,
          SESSION,
        );
        expect(userService.update).toHaveBeenCalledWith(USER_ID, {
          first_name: 'Ama',
        });
        expect(result.warnings?.[0]).toContain(field);
      },
    );

    it('ignores a password change when the account already has one', async () => {
      userService.findOneEntityWithPassword.mockResolvedValue({
        id: USER_ID,
        password_hash: 'hash',
      });
      const result = await controller.update(
        USER_ID,
        { first_name: 'Ama', password: 'x-new-pass' },
        USER_ID,
        UserRole.USER,
        SESSION,
      );
      expect(userService.update).toHaveBeenCalledWith(USER_ID, {
        first_name: 'Ama',
      });
      expect(result.warnings?.[0]).toContain('/auth/change-password');
    });

    it('rejects a too-short first password', async () => {
      await expect(
        controller.update(
          USER_ID,
          { password: 'x' },
          USER_ID,
          UserRole.USER,
          SESSION,
        ),
      ).rejects.toThrow('at least 6 characters');
      expect(userService.update).not.toHaveBeenCalled();
    });

    it('lets an admin edit profile fields on another user', async () => {
      await controller.update(
        OTHER_ID,
        { first_name: 'Ama' },
        USER_ID,
        UserRole.ADMIN,
        SESSION,
      );
      expect(userService.update).toHaveBeenCalledWith(OTHER_ID, {
        first_name: 'Ama',
      });
    });

    it.each([true, false])(
      'refuses an admin setting is_active=%s here',
      async (is_active) => {
        await expect(
          controller.update(
            OTHER_ID,
            { is_active },
            USER_ID,
            UserRole.ADMIN,
            SESSION,
          ),
        ).rejects.toMatchObject({ status: 400 });
        expect(userService.update).not.toHaveBeenCalled();
      },
    );

    it.each([UserRole.USER, UserRole.MODERATOR, UserRole.ADMIN])(
      'refuses an admin setting role %s here',
      async (role) => {
        await expect(
          controller.update(
            OTHER_ID,
            { role },
            USER_ID,
            UserRole.ADMIN,
            SESSION,
          ),
        ).rejects.toMatchObject({ status: 400 });
        expect(userService.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('remove', () => {
    it('lets a user delete their own account', async () => {
      await controller.remove(USER_ID, USER_ID, UserRole.USER);
      expect(userService.remove).toHaveBeenCalledWith(USER_ID, USER_ID);
    });

    it("rejects a user deleting someone else's account", () => {
      expect(() => controller.remove(OTHER_ID, USER_ID, UserRole.USER)).toThrow(
        'You can only delete your own account',
      );
      expect(userService.remove).not.toHaveBeenCalled();
    });

    it('lets an admin delete any account', async () => {
      await controller.remove(OTHER_ID, USER_ID, UserRole.ADMIN);
      expect(userService.remove).toHaveBeenCalledWith(OTHER_ID, USER_ID);
    });
  });
});
