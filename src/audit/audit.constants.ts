/**
 * Standardized constants for audit logging
 * Use these constants throughout the application for consistency
 */

/**
 * Entity types for audit logs
 */
export enum AuditEntityType {
  USERS = 'users',
  ITEMS = 'items',
  CATEGORIES = 'categories',
  LOCATIONS = 'locations',
  USER_PREFERENCES = 'user_preferences',
  ITEM_IMAGES = 'item_images',
  MESSAGES = 'messages',
  CONVERSATIONS = 'conversations',
  REVIEWS = 'reviews',
  REPORTS = 'reports',
}

/**
 * Action types for audit logs
 */
export enum AuditAction {
  CREATED = 'created',
  UPDATED = 'updated',
  DELETED = 'deleted',
  VIEWED = 'viewed',
  RESTORED = 'restored',
  ARCHIVED = 'archived',
}

/**
 * User activity types for analytics
 */
export enum UserActivityType {
  // Authentication
  LOGIN = 'login',
  LOGOUT = 'logout',
  LOGIN_FAILED = 'login_failed',
  PASSWORD_RESET = 'password_reset',
  EMAIL_VERIFIED = 'email_verified',
  PHONE_VERIFIED = 'phone_verified',

  // Item Activities
  CREATE_ITEM = 'create_item',
  UPDATE_ITEM = 'update_item',
  DELETE_ITEM = 'delete_item',
  VIEW_ITEM = 'view_item',
  SEARCH_ITEMS = 'search',
  RESERVE_ITEM = 'reserve_item',
  UNRESERVE_ITEM = 'unreserve_item',
  FEATURE_ITEM = 'feature_item',
  SHARE_ITEM = 'share_item',

  // Image Activities
  UPLOAD_IMAGE = 'upload_image',
  DELETE_IMAGE = 'delete_image',
  SET_PRIMARY_IMAGE = 'set_primary_image',

  // User Profile
  UPDATE_PROFILE = 'update_profile',
  UPDATE_AVATAR = 'update_avatar',
  UPDATE_PREFERENCES = 'update_preferences',
  UPDATE_LOCATION = 'update_location',

  // Social Activities
  SEND_MESSAGE = 'send_message',
  VIEW_CONVERSATION = 'view_conversation',
  CREATE_REVIEW = 'create_review',
  REPORT_ITEM = 'report_item',
  REPORT_USER = 'report_user',

  // Browsing
  VIEW_CATEGORY = 'view_category',
  VIEW_USER_PROFILE = 'view_user_profile',
  BROWSE_ITEMS = 'browse_items',

  // Admin Activities
  ADMIN_LOGIN = 'admin_login',
  ADMIN_ACTION = 'admin_action',
  MODERATE_CONTENT = 'moderate_content',
  BAN_USER = 'ban_user',
  UNBAN_USER = 'unban_user',
}

/**
 * System event names for monitoring
 */
export enum SystemEventName {
  // Scheduled Jobs
  DAILY_ITEM_CLEANUP = 'daily_item_cleanup',
  WEEKLY_USER_STATS = 'weekly_user_stats',
  MONTHLY_REPORT = 'monthly_report',
  EXPIRED_ITEMS_REMOVAL = 'expired_items_removal',
  SESSION_CLEANUP = 'session_cleanup',

  // Batch Processes
  BULK_ITEM_UPDATE = 'bulk_item_update',
  USER_EXPORT = 'user_export',
  DATA_MIGRATION = 'data_migration',
  IMAGE_OPTIMIZATION = 'image_optimization',
  VIEW_COUNT_SYNC = 'view_count_sync',

  // System Alerts
  HIGH_ERROR_RATE = 'high_error_rate',
  DATABASE_SLOW_QUERY = 'database_slow_query',
  LOW_STORAGE_SPACE = 'low_storage_space',
  API_RATE_LIMIT_EXCEEDED = 'api_rate_limit_exceeded',
  SUSPICIOUS_ACTIVITY_DETECTED = 'suspicious_activity_detected',
}

/**
 * Metadata keys for additional context
 */
export enum AuditMetadataKey {
  // General
  REASON = 'reason',
  DURATION = 'duration',
  ERROR_CODE = 'errorCode',

  // Item Context
  ITEM_TITLE = 'itemTitle',
  ITEM_CATEGORY = 'itemCategory',
  ITEM_PRICE = 'itemPrice',
  ITEM_STATUS = 'itemStatus',

  // Search Context
  SEARCH_TERM = 'searchTerm',
  SEARCH_FILTERS = 'searchFilters',
  RESULTS_COUNT = 'resultsCount',

  // User Context
  USER_ROLE = 'userRole',
  PREVIOUS_ROLE = 'previousRole',
  NEW_ROLE = 'newRole',

  // Admin Context
  PERFORMED_BY = 'performedBy',
  TARGET_USER = 'targetUser',
  ADMIN_ACTION = 'adminAction',
  CRITICAL_ACTION = 'criticalAction',
  PERMANENT = 'permanent',

  // Change Context
  CHANGED_FIELDS = 'changedFields',
  CHANGES = 'changes',
  OLD_VALUE = 'oldValue',
  NEW_VALUE = 'newValue',
}
