import { ArgumentMetadata } from '@nestjs/common';
import { createGlobalPipes } from './pipes/global-pipes';
import { LoginDto } from '../auth/dto/login.dto';
import { UpdateUserDto } from '../user/dto/update-user.dto';
import { normalizeEmail } from './email';

describe('email normalization', () => {
  const [, validation] = createGlobalPipes();
  const parse = (metatype: ArgumentMetadata['metatype'], body: object) =>
    validation.transform(body, { type: 'body', metatype }) as Promise<{
      email?: string;
    }>;

  it('lowercases and trims', () => {
    expect(normalizeEmail('  Ama@Gmail.COM ')).toBe('ama@gmail.com');
    expect(normalizeEmail(null)).toBeUndefined();
  });

  it('reaches services lowercased from request bodies', async () => {
    const login = await parse(LoginDto, {
      email: 'Ama@Gmail.com',
      password: 'secret1',
    });
    const update = await parse(UpdateUserDto, { email: ' Ama@Gmail.com' });

    expect(login.email).toBe('ama@gmail.com');
    expect(update.email).toBe('ama@gmail.com');
  });

  it('treats a blank optional email as not sent', async () => {
    // It used to fail @IsEmail with a 400; now there is nothing to change.
    const update = await parse(UpdateUserDto, { email: '  ' });

    expect(update.email).toBeUndefined();
  });
});
