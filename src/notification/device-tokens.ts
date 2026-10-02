import { applyDecorators } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { EntityManager } from 'typeorm';
import { UserSessionEntity } from '../auth/entities/user-session.entity';

/** What `user_sessions.fcm_token` can hold. FCM tokens are ~160 characters. */
export const MAX_FCM_TOKEN_LENGTH = 255;

/** Validation for an FCM token in a request body. */
export const IsFcmToken = () =>
  applyDecorators(
    IsString(),
    IsNotEmpty({ message: 'fcm_token must not be empty' }),
    MaxLength(MAX_FCM_TOKEN_LENGTH),
  );

/**
 * A token belongs to one install: take it off every other live session, so
 * a phone that switched accounts stops getting the previous one's pushes.
 *
 * Ended sessions keep theirs. A socket stays open across refreshes, so the
 * session it connected with may have ended since; its token is still how
 * that socket's device is told apart when deciding who needs a push.
 */
export async function releaseFcmToken(
  manager: EntityManager,
  fcmToken: string,
  keepSessionToken: string,
): Promise<void> {
  await manager
    .createQueryBuilder()
    .update(UserSessionEntity)
    .set({ fcm_token: () => 'NULL' })
    .where('fcm_token = :fcmToken', { fcmToken })
    .andWhere('session_token <> :keepSessionToken', { keepSessionToken })
    .andWhere('is_active = true')
    .execute();
}
