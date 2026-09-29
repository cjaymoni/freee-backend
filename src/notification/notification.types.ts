/**
 * What a notification is about. Each is a key a user can set to false in
 * their `notification_settings` to stop that kind, alongside the channel
 * keys `push` and `email`. A missing key means on.
 */
export enum NotificationCategory {
  CHAT_MESSAGES = 'chat_messages',
  ITEM_REQUESTS = 'item_requests',
  LISTINGS = 'listings',
  ACCOUNT = 'account',
}

export interface Notice {
  category: NotificationCategory;
  title: string;
  body: string;
  /** Extra FCM data for the app to route on. `category` is always added. */
  data?: Record<string, string>;
  /** Also send it by email, when the user has an address. */
  email?: {
    subject: string;
    paragraphs: string[];
    /**
     * About the account itself (suspended, banned, reinstated): sent even to
     * someone who turned emails off, since they need to know.
     */
    transactional?: boolean;
  };
  /**
   * Deliver even though the account is suspended or banned. Only for notices
   * about that very state; everything else waits until it is active again.
   */
  evenIfInactive?: boolean;
}
