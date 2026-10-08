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
