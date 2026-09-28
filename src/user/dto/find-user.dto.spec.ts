import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { FindUserDto } from './find-user.dto';
import { AdminUserQueryDto } from '../../admin/dto/admin-query.dto';

/**
 * FindUserDto is spread into a TypeORM `where`, so anything it lets through
 * becomes a filter. Run with the app's own global pipe settings.
 */
describe('FindUserDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const meta: ArgumentMetadata = { type: 'query', metatype: FindUserDto };
  const parse = (query: Record<string, string>) => pipe.transform(query, meta);

  it.each([
    'password',
    'fcm_token',
    'is_deleted',
    'deleted_by',
    'deletion_reason',
    'failed_login_attempts',
    'account_locked_until',
    'cloudinary_avatar_public_id',
    'created_at',
  ])('refuses %s as a filter', async (field) => {
    await expect(parse({ [field]: 'x' })).rejects.toMatchObject({
      response: { message: [`property ${field} should not exist`] },
    });
  });

  it.each([
    'is_active',
    'is_email_verified',
    'is_phone_verified',
    'notification_enabled',
    'is_onboarded',
    'requires_password_change',
  ])('reads %s from the query string as a boolean', async (field) => {
    await expect(parse({ [field]: 'true' })).resolves.toMatchObject({
      [field]: true,
    });
    await expect(parse({ [field]: 'false' })).resolves.toMatchObject({
      [field]: false,
    });
    await expect(parse({ [field]: '1' })).rejects.toBeDefined();
  });

  it('keeps the profile filters', async () => {
    await expect(
      parse({ first_name: 'Ama', role: 'USER', gender: 'female' }),
    ).resolves.toMatchObject({ first_name: 'Ama', role: 'USER' });
  });

  it('accepts order in any case and refuses anything else', async () => {
    await expect(parse({ order: 'asc' })).resolves.toMatchObject({
      order: 'ASC',
    });
    await expect(parse({})).resolves.toMatchObject({ order: 'DESC' });
    await expect(parse({ order: 'sideways' })).rejects.toBeDefined();
  });
});

describe('Admin query DTOs', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const meta: ArgumentMetadata = { type: 'query', metatype: AdminUserQueryDto };

  it('keep paging defaults and order, without the unused sortBy', async () => {
    await expect(pipe.transform({ order: 'asc' }, meta)).resolves.toMatchObject(
      { page: 1, limit: 20, order: 'ASC' },
    );
    await expect(
      pipe.transform({ sortBy: 'email' }, meta),
    ).rejects.toBeDefined();
  });
});
