import { FOUNDING_REVIEW_REASON } from '../founding-freer/founding-freer.constants';

/**
 * Listings posted in the app start hidden with this reason and wait for a
 * moderator to approve them. The owner sees it on their own listing.
 */
export const LISTING_REVIEW_REASON = 'Waiting for review';

/** Every reason a listing is held for review; the back office queue is these. */
export const REVIEW_REASONS = [LISTING_REVIEW_REASON, FOUNDING_REVIEW_REASON];
