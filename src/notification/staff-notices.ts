import { StaffNotificationType } from './entities/staff-notification.entity';
import { StaffEntry } from './staff-inbox.service';

/**
 * The words of each back office inbox entry. Links are back office paths.
 * Reasons and subjects are user-typed; the back office renders them as text.
 */

export const itemReportedEntry = (reason: string): StaffEntry => ({
  type: StaffNotificationType.ITEM_REPORTED,
  title: 'A listing was reported',
  body: reason,
  link: '/reports/listings',
});

export const userReportedEntry = (reason: string): StaffEntry => ({
  type: StaffNotificationType.USER_REPORTED,
  title: 'A user was reported',
  body: reason,
  link: '/reports/users',
});

export const complaintReceivedEntry = (subject: string): StaffEntry => ({
  type: StaffNotificationType.COMPLAINT_RECEIVED,
  title: 'New support message',
  body: subject,
  link: '/support',
});

export const listingAwaitingReviewEntry = (
  itemId: string,
  title: string,
): StaffEntry => ({
  type: StaffNotificationType.LISTING_AWAITING_REVIEW,
  title: 'A listing is waiting for review',
  body: title,
  link: `/listings/${itemId}`,
});

export const roleChangedEntry = (role: string): StaffEntry => ({
  type: StaffNotificationType.ROLE_CHANGED,
  title: 'Your role was changed',
  body: `You are now ${role === 'ADMIN' ? 'an admin' : role === 'MODERATOR' ? 'a moderator' : 'a regular user'}.`,
  link: null,
});

export const takenOverEntry = (
  what: 'listing report' | 'user report' | 'support message',
  outcome: string,
): StaffEntry => ({
  type: StaffNotificationType.TAKEN_OVER,
  title: `A ${what} you were reviewing was ${outcome}`,
  body: 'Another staff member closed it.',
  link:
    what === 'listing report'
      ? '/reports/listings'
      : what === 'user report'
        ? '/reports/users'
        : '/support',
});

/**
 * The freed email is in the body: by now the old account no longer has it,
 * and it is how staff find the new account (search users by email).
 */
export const accountSplitEntry = (
  oldUserId: string,
  email: string,
): StaffEntry => ({
  type: StaffNotificationType.ACCOUNT_SPLIT,
  title: 'A user may now have two accounts',
  body:
    `Check if it's the same person: ${email} now belongs to a new account. ` +
    'It was never verified on this one, which can no longer sign in with ' +
    'it. Search users for the email to find the new account.',
  link: `/users/${oldUserId}`,
});
