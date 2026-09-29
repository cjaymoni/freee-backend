import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';
import { UpdateFcmTokenDto } from '../user/dto/update-fcm-token.dto';
import { UpdateUserDto } from '../user/dto/update-user.dto';
import { UserResponseDto } from '../user/dto/user-response.dto';
import { LoginDto } from '../auth/dto/login.dto';
import { FirebaseAuthDto } from '../auth/dto/firebase-auth.dto';
import { MAX_FCM_TOKEN_LENGTH } from './device-tokens';

describe('FCM token validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const check = (metatype: ArgumentMetadata['metatype'], body: object) =>
    pipe.transform(body, { type: 'body', metatype });
  const login = { email: 'ama@gmail.com', password: 'secret1' };

  it.each([
    ['PATCH /users/fcm-token', UpdateFcmTokenDto, {}],
    ['PATCH /users/:id', UpdateUserDto, {}],
    ['a password login', LoginDto, login],
    ['a Firebase login', FirebaseAuthDto, { idToken: 'id' }],
  ])('rejects an empty or oversized token in %s', async (_, dto, rest) => {
    await expect(check(dto, { ...rest, fcm_token: '' })).rejects.toBeDefined();
    await expect(
      check(dto, { ...rest, fcm_token: 'x'.repeat(MAX_FCM_TOKEN_LENGTH + 1) }),
    ).rejects.toBeDefined();
    await expect(
      check(dto, { ...rest, fcm_token: 'x'.repeat(MAX_FCM_TOKEN_LENGTH) }),
    ).resolves.toBeDefined();
  });

  it('lets a login leave the token out', async () => {
    await expect(check(LoginDto, login)).resolves.toBeDefined();
    await expect(
      check(FirebaseAuthDto, { idToken: 'id' }),
    ).resolves.toBeDefined();
  });
});

describe('UserResponseDto', () => {
  it('never returns the legacy push token copied from the entity', () => {
    const dto = Object.assign(new UserResponseDto(), {
      id: 'u1',
      email: 'ama@example.com',
      fcm_token: 'fcm-secret',
    });

    const body = instanceToPlain(dto);

    expect(body).toMatchObject({ id: 'u1', email: 'ama@example.com' });
    expect(body).not.toHaveProperty('fcm_token');
  });
});
