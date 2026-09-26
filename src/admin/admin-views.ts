import { ItemEntity } from '../item/entities/item.entity';
import { UserEntity } from '../user/entities/user.entity';

/**
 * What the back office gets for a user. Picked field by field rather than
 * spreading the entity, so tokens (fcm_token, firebase_uid) and credential
 * state never leave through an admin endpoint.
 */
export function toAdminUser(user: UserEntity) {
  return {
    id: user.id,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    email: user.email ?? null,
    phone_number: user.phone_number ?? null,
    avatar_url: user.cloudinary_avatar_url ?? null,
    role: user.role,
    is_active: user.is_active,
    account_status: user.account_status,
    status_reason: user.status_reason ?? null,
    suspended_until: user.suspended_until ?? null,
    status_changed_by: user.status_changed_by ?? null,
    status_changed_at: user.status_changed_at ?? null,
    is_email_verified: user.is_email_verified,
    is_phone_verified: user.is_phone_verified,
    is_onboarded: user.is_onboarded,
    member_since: user.member_since ?? null,
    last_active: user.last_active ?? null,
    created_at: user.created_at,
  };
}

export type AdminUser = ReturnType<typeof toAdminUser>;

/** The few user fields shown wherever someone is referenced. */
export function toUserRef(user: UserEntity | null | undefined) {
  if (!user) return null;
  return {
    id: user.id,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    avatar_url: user.cloudinary_avatar_url ?? null,
    account_status: user.account_status,
  };
}

export function toAdminItem(
  item: ItemEntity,
  counts?: { requests: number; pending_requests: number },
) {
  const images = (item.images ?? [])
    .filter((i) => !i.is_deleted)
    .sort(
      (a, b) =>
        Number(b.is_primary) - Number(a.is_primary) ||
        (a.display_order ?? 0) - (b.display_order ?? 0),
    );
  return {
    id: item.id,
    title: item.title,
    description: item.description ?? null,
    condition: item.condition,
    quantity: item.quantity,
    status: item.status,
    moderation_status: item.moderation_status,
    moderation_reason: item.moderation_reason ?? null,
    moderated_by: item.moderated_by ?? null,
    moderated_at: item.moderated_at ?? null,
    is_featured: item.is_featured,
    featured_until: item.featured_until ?? null,
    view_count: item.view_count,
    is_deleted: item.is_deleted,
    deleted_at: item.deleted_at ?? null,
    deletion_reason: item.deletion_reason ?? null,
    pickup_type: item.pickup_type ?? null,
    pickup_date: item.pickup_date ?? null,
    pickup_time: item.pickup_time ?? null,
    created_at: item.created_at,
    updated_at: item.updated_at,
    category: item.category
      ? { id: item.category.id, name: item.category.name }
      : null,
    location: item.location
      ? {
          city: item.location.city ?? null,
          area: item.location.area ?? null,
          region: item.location.region ?? null,
          country_code: item.location.country_code ?? null,
        }
      : null,
    owner: toUserRef(item.user),
    images: images.map((i) => ({
      id: i.id,
      url: i.cloudinary_secure_url,
      is_primary: i.is_primary,
    })),
    requests_count: counts?.requests ?? 0,
    pending_requests_count: counts?.pending_requests ?? 0,
  };
}

export type AdminItem = ReturnType<typeof toAdminItem>;
