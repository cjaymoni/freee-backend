import { NotificationCategory, Notice } from './notification.types';

/**
 * The words of each notice about an account or a listing, kept together so
 * push and email say the same thing. Reasons are staff-typed text; the mail
 * service escapes them.
 */

const when = (date: Date) =>
  `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const reasonLine = (reason?: string | null) =>
  reason ? [`Reason: ${reason}`] : [];

export function accountSuspendedNotice(
  until: Date | null,
  reason?: string | null,
): Notice {
  const lasts = until ? `until ${when(until)}` : 'until a moderator lifts it';
  return {
    category: NotificationCategory.ACCOUNT,
    title: 'Your account has been suspended',
    body: `You can't share or request items ${lasts}. You can still send an appeal.`,
    data: { type: 'account_status', status: 'suspended' },
    evenIfInactive: true,
    email: {
      subject: 'Your Freeee account has been suspended',
      transactional: true,
      paragraphs: [
        `Your account has been suspended ${lasts}.`,
        ...reasonLine(reason),
        'While it is suspended you cannot share or request items. If you think this is a mistake, you can send an appeal from the app.',
      ],
    },
  };
}

/** Email only in practice: a ban ends every session, so no device is left. */
export function accountBannedNotice(reason?: string | null): Notice {
  return {
    category: NotificationCategory.ACCOUNT,
    title: 'Your account has been banned',
    body: 'Your account can no longer be used.',
    data: { type: 'account_status', status: 'banned' },
    evenIfInactive: true,
    email: {
      subject: 'Your Freeee account has been banned',
      transactional: true,
      paragraphs: [
        'Your account has been banned and can no longer be used.',
        ...reasonLine(reason),
      ],
    },
  };
}

export function accountReinstatedNotice(expired: boolean): Notice {
  const why = expired
    ? 'Your suspension has ended.'
    : 'A moderator has lifted the restriction on your account.';
  return {
    category: NotificationCategory.ACCOUNT,
    title: 'Your account is active again',
    body: `${why} You can share and request items again.`,
    data: { type: 'account_status', status: 'active' },
    email: {
      subject: 'Your Freeee account is active again',
      transactional: true,
      paragraphs: [why, 'You can share and request items again.'],
    },
  };
}

export function listingHiddenNotice(
  item: { id: string; title: string },
  reason?: string | null,
): Notice {
  return {
    category: NotificationCategory.LISTINGS,
    title: 'Your listing was hidden',
    body: `"${item.title}" was hidden by a moderator${reason ? `: ${reason}` : '.'}`,
    data: { type: 'listing_moderation', status: 'hidden', item_id: item.id },
  };
}

export function listingEditedNotice(
  item: { id: string; title: string },
  reason?: string | null,
): Notice {
  return {
    category: NotificationCategory.LISTINGS,
    title: 'Your listing was edited',
    body: `A moderator edited "${item.title}"${reason ? `: ${reason}` : '.'}`,
    data: { type: 'listing_moderation', status: 'edited', item_id: item.id },
  };
}

export function listingRestoredNotice(item: {
  id: string;
  title: string;
}): Notice {
  return {
    category: NotificationCategory.LISTINGS,
    title: 'Your listing is visible again',
    body: `"${item.title}" is back in the app.`,
    data: { type: 'listing_moderation', status: 'visible', item_id: item.id },
  };
}

/** A Founding Freer listing passing its pre-launch review. */
export function listingApprovedNotice(item: {
  id: string;
  title: string;
}): Notice {
  return {
    category: NotificationCategory.LISTINGS,
    title: 'Your listing was approved',
    body: `"${item.title}" is live on Freeee.`,
    data: { type: 'listing_moderation', status: 'visible', item_id: item.id },
  };
}

export function listingRemovedNotice(
  item: { id: string; title: string },
  reason?: string | null,
): Notice {
  return {
    category: NotificationCategory.LISTINGS,
    title: 'Your listing was removed',
    body: `"${item.title}" was removed by a moderator${reason ? `: ${reason}` : '.'}`,
    data: { type: 'listing_moderation', status: 'removed', item_id: item.id },
  };
}

export function complaintAnsweredNotice(
  complaintId: string,
  status: string,
  response: string,
): Notice {
  const outcome = status === 'resolved' ? 'resolved' : 'reviewed';
  return {
    category: NotificationCategory.ACCOUNT,
    title: `Your complaint has been ${outcome}`,
    body: response || 'Open the app to see the reply.',
    data: { type: 'complaint', status, complaint_id: complaintId },
    // Complaints often come from suspended accounts, which need it most.
    evenIfInactive: true,
    email: {
      subject: `Your Freeee complaint has been ${outcome}`,
      transactional: true,
      paragraphs: [`Outcome: ${status}`, ...(response ? [response] : [])],
    },
  };
}
