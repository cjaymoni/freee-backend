import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UserRole } from './entities/user.entity';

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
    findOneEntityWithPassword: jest.Mock;
  };

  const USER_ID = '11111111-1111-1111-1111-111111111111';
  const OTHER_ID = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    userService = {
      update: jest.fn().mockResolvedValue({ state: true }),
      remove: jest.fn().mockResolvedValue({ state: true }),
      findOneEntityWithPassword: jest
        .fn()
        .mockResolvedValue({ id: USER_ID, password_hash: null }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: userService },
        { provide: CloudinaryService, useValue: {} },
      ],
    }).compile();
    controller = module.get<UserController>(UserController);
  });

  describe('update', () => {
    it('lets a user edit their own profile fields', async () => {
      await controller.update(
        USER_ID,
        { first_name: 'Ama', bio: 'hi' },
        USER_ID,
        UserRole.USER,
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
      );
      expect(userService.update).toHaveBeenCalledWith(USER_ID, {
        first_name: 'Ama',
      });
      expect(result.warnings?.[0]).toContain('/auth/change-password');
    });

    it('rejects a too-short first password', async () => {
      await expect(
        controller.update(USER_ID, { password: 'x' }, USER_ID, UserRole.USER),
      ).rejects.toThrow('at least 6 characters');
      expect(userService.update).not.toHaveBeenCalled();
    });

    it('lets an admin change role and is_active on another user', async () => {
      await controller.update(
        OTHER_ID,
        { role: 'ADMIN', is_active: false },
        USER_ID,
        UserRole.ADMIN,
      );
      expect(userService.update).toHaveBeenCalledWith(OTHER_ID, {
        role: 'ADMIN',
        is_active: false,
      });
    });

    it.each([[{ role: 'USER' }], [{ is_active: false }]])(
      'stops an admin locking themselves out with %j',
      async (body) => {
        await expect(
          controller.update(USER_ID, body, USER_ID, UserRole.ADMIN),
        ).rejects.toThrow('Admins cannot demote or deactivate themselves');
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
