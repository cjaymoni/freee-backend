import { Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';

export type Identifier = 'email' | 'phone_number';

/** The account that gave a value up, as its cached copies are keyed. */
export type ReleasedHolder = Pick<UserEntity, 'id' | 'firebase_uid'>;

export const VERIFIED_FLAG = {
  email: 'is_email_verified',
  phone_number: 'is_phone_verified',
} as const;

/**
 * Make room for `userId` to hold `value`, which the caller has proven they
 * own. Another account holding it unverified gives it up, so nobody can
 * pre-claim a victim's email or number and lock them out of linking it.
 *
 * @returns false when another account holds it verified and keeps it;
 * otherwise the account, if any, that gave it up.
 */
export async function claimVerifiedIdentifier(
  repo: Repository<UserEntity>,
  field: Identifier,
  value: string,
  userId: string,
): Promise<{ releasedFrom?: ReleasedHolder } | false> {
  const holder = await repo.findOne({ where: { [field]: value } });
  if (!holder || holder.id === userId) return {};
  if (holder[VERIFIED_FLAG[field]]) return false;
  // Only while still unverified: a verification committed since the read
  // keeps the value with its holder.
  const released = await repo.update(
    { id: holder.id, [VERIFIED_FLAG[field]]: false },
    { [field]: null },
  );
  return released.affected
    ? { releasedFrom: { id: holder.id, firebase_uid: holder.firebase_uid } }
    : false;
}
