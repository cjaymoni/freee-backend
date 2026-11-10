/**
 * Every platform setting staff can change from the back office, with the
 * value the code falls back to when the database has nothing stored.
 *
 * A setting never loosens a bound the shipped code enforced, for two
 * separate reasons.
 *
 * Where a hard limit already exists in code or at a third party - Cloudinary's
 * 10 MB, the longest message a DTO accepts, the largest page a list endpoint
 * serves - the setting's `max` is that same limit. Anything looser would have
 * to pass validation compiled into decorators, which cannot read the
 * database, so it would be promised here and refused at the edge.
 * `settings.registry.spec.ts` asserts each of those pairings against the
 * constant itself, so moving one and not the other fails the build.
 *
 * Where the limit is a security bound - rate limits, one-time code budgets,
 * lockouts - the range stops at the value the code shipped with, so the knob
 * only ever tightens. An admin tuning the platform cannot weaken the control
 * that stops credential stuffing or code guessing; raising one of those
 * ceilings is a deliberate code change and a deploy, which is where that
 * decision belongs. For a window, "tighter" means longer, so the shipped
 * value is its `min`.
 */

/** The groups the back office renders as sections, in display order. */
export const SETTING_GROUPS = [
  'listings',
  'requests',
  'chat',
  'rate_limits',
  'auth',
  'platform',
] as const;

export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const GROUP_LABELS: Record<SettingGroup, string> = {
  listings: 'Listings',
  requests: 'Requests',
  chat: 'Chat',
  rate_limits: 'Rate limits',
  auth: 'Sign-in and codes',
  platform: 'Platform',
};

export const GROUP_DESCRIPTIONS: Record<SettingGroup, string> = {
  listings: 'What a user may post, and whether staff see it first.',
  requests: 'How many items a user may ask for, and the pickup code.',
  chat: 'Limits on messages and their attachments.',
  rate_limits: 'How often one caller may hit the sign-in endpoints.',
  auth: 'Sign-in attempts, lockouts, and one-time codes.',
  platform: 'Everything else that applies across the app.',
};

interface BaseDefinition {
  group: SettingGroup;
  /** Short name shown next to the field. */
  label: string;
  /** One sentence telling staff what changing it does. */
  description: string;
}

interface NumberDefinition extends BaseDefinition {
  type: 'number';
  default: number;
  min: number;
  max: number;
  /** Shown after the input, e.g. "per user" or "MB". */
  unit: string;
  /** What 0 means, when it is allowed and does not mean "none". */
  zeroMeans?: string;
}

interface BooleanDefinition extends BaseDefinition {
  type: 'boolean';
  default: boolean;
}

export type SettingDefinition = NumberDefinition | BooleanDefinition;

export type { NumberDefinition };

const UNLIMITED = 'No limit';

/**
 * The catalogue. Keys are stored verbatim in `platform_settings.key`, so
 * renaming one orphans its stored value and silently restores the default -
 * add a new key instead.
 */
export const SETTINGS = {
  'listings.max_active_per_user': {
    group: 'listings',
    type: 'number',
    label: 'Listings up per user',
    description:
      'How many listings one user may have up at once, counting the ones still waiting for review. A listing taken down, hidden by a moderator, or already picked up does not count, so reaching the cap is always something the user can act on by withdrawing a listing.',
    default: 0,
    min: 0,
    max: 1000,
    unit: 'listings',
    zeroMeans: UNLIMITED,
  },
  'listings.max_per_day_per_user': {
    group: 'listings',
    type: 'number',
    label: 'New listings per day',
    description:
      'How many listings one user may post in a rolling 24 hours. Catches bulk spam that the active cap alone would allow. Off until you set it.',
    default: 0,
    min: 0,
    max: 1000,
    unit: 'per day',
    zeroMeans: UNLIMITED,
  },
  'listings.max_images': {
    group: 'listings',
    type: 'number',
    label: 'Images per listing',
    description:
      'How many photos one listing may carry in total. Adding photos to a listing that is already at the limit is refused unless the same edit removes some.',
    default: 10,
    min: 1,
    max: 10,
    unit: 'images',
  },
  'listings.max_image_mb': {
    group: 'listings',
    type: 'number',
    label: 'Listing photo size',
    description:
      'The largest photo accepted on a listing. Cloudinary refuses anything above 10 MB on the current plan.',
    default: 10,
    min: 1,
    max: 10,
    unit: 'MB',
  },
  'listings.hold_new_for_review': {
    group: 'listings',
    type: 'boolean',
    label: 'Hold new listings for review',
    description:
      'New listings stay hidden until a moderator approves them. Switch off and they go live the moment they are posted.',
    default: true,
  },

  'requests.max_active_per_user': {
    group: 'requests',
    type: 'number',
    label: 'Open requests per user',
    description:
      'How many items one user may have pending or confirmed at the same time.',
    default: 0,
    min: 0,
    max: 500,
    unit: 'requests',
    zeroMeans: UNLIMITED,
  },
  'requests.max_per_day_per_user': {
    group: 'requests',
    type: 'number',
    label: 'New requests per day',
    description:
      'How many items one user may ask for in a rolling 24 hours, cancelled ones included. Off until you set it.',
    default: 0,
    min: 0,
    max: 500,
    unit: 'per day',
    zeroMeans: UNLIMITED,
  },
  'requests.max_pickup_code_attempts': {
    group: 'requests',
    type: 'number',
    label: 'Pickup code attempts',
    description:
      'Wrong pickup codes a requester may submit before the owner has to issue a new one. This bounds guessing a pickup code, so it can only be lowered.',
    default: 5,
    min: 1,
    max: 5,
    unit: 'attempts',
  },
  'requests.pickup_code_cooldown_minutes': {
    group: 'requests',
    type: 'number',
    label: 'Wait before a new pickup code',
    description:
      'How long a locked-out requester waits before they may ask for a fresh code. It can only be lengthened: a longer wait is the tighter setting.',
    default: 60,
    min: 60,
    max: 1440,
    unit: 'minutes',
  },

  'chat.max_message_length': {
    group: 'chat',
    type: 'number',
    label: 'Message length',
    description: 'The longest chat message the server accepts.',
    default: 4000,
    min: 100,
    max: 4000,
    unit: 'characters',
  },
  'chat.max_image_mb': {
    group: 'chat',
    type: 'number',
    label: 'Chat image size',
    description:
      'The largest image sent in a chat. Cloudinary refuses anything above 10 MB on the current plan.',
    default: 10,
    min: 1,
    max: 10,
    unit: 'MB',
  },

  'rate_limits.requests_per_window': {
    group: 'rate_limits',
    type: 'number',
    label: 'Sign-in requests per window',
    description:
      'How many sign-in and registration requests one caller may make inside the window below before the API answers 429. This is the baseline for the auth endpoints; the ones that send codes carry their own tighter limits below. It can only be lowered: loosening it is a code change.',
    default: 100,
    min: 10,
    max: 100,
    unit: 'requests',
  },
  'rate_limits.window_seconds': {
    group: 'rate_limits',
    type: 'number',
    label: 'Window length',
    description:
      'The period the sign-in request count above is measured over. It can only be lengthened: a longer window with the same count is a tighter limit, not a looser one.',
    default: 60,
    min: 60,
    max: 3600,
    unit: 'seconds',
  },

  'auth.max_login_attempts': {
    group: 'auth',
    type: 'number',
    label: 'Failed sign-ins before lockout',
    description:
      'Wrong passwords in a row before the account is locked for the time below. It can only be lowered.',
    default: 5,
    min: 1,
    max: 5,
    unit: 'attempts',
  },
  'auth.lockout_minutes': {
    group: 'auth',
    type: 'number',
    label: 'Lockout length',
    description:
      'How long a locked account stays locked. It can only be lengthened: a longer lockout is the tighter setting.',
    default: 30,
    min: 30,
    max: 1440,
    unit: 'minutes',
  },
  'auth.code_ttl_minutes': {
    group: 'auth',
    type: 'number',
    label: 'Sign-in code lifetime',
    description:
      'How long an emailed one-time code stays usable. It can only be shortened.',
    default: 10,
    min: 1,
    max: 10,
    unit: 'minutes',
  },
  'auth.max_attempts_per_code': {
    group: 'auth',
    type: 'number',
    label: 'Guesses per code',
    description:
      'Wrong guesses against a single one-time code before it is burned. It can only be lowered.',
    default: 5,
    min: 1,
    max: 5,
    unit: 'guesses',
  },
  'auth.max_code_guesses_per_day': {
    group: 'auth',
    type: 'number',
    label: 'Guesses per email per day',
    description:
      'Total guesses against one email address in a rolling 24 hours, across every code sent to it. This is what bounds guessing a six-digit code, so it can only be lowered.',
    default: 30,
    min: 1,
    max: 30,
    unit: 'guesses',
  },
  'auth.max_codes_per_day': {
    group: 'auth',
    type: 'number',
    label: 'Codes per email per day',
    description:
      'How many one-time codes one email address may be sent in a rolling 24 hours. It can only be lowered.',
    default: 20,
    min: 1,
    max: 20,
    unit: 'codes',
  },
  'auth.max_codes_per_ip_per_hour': {
    group: 'auth',
    type: 'number',
    label: 'Codes per IP per hour',
    description:
      'How many codes one IP address may request for the same email in an hour. It can only be lowered.',
    default: 5,
    min: 1,
    max: 5,
    unit: 'codes',
  },

  'platform.founding_freers_open': {
    group: 'platform',
    type: 'boolean',
    label: 'Founding Freers sign-up open',
    description:
      'Whether people can still join the pre-launch Founding Freers programme.',
    default: false,
  },
  'platform.max_page_size': {
    group: 'platform',
    type: 'number',
    label: 'Largest page',
    description:
      'The most rows any list endpoint returns in one page. Lower it if large pages are straining the database.',
    default: 100,
    min: 10,
    max: 100,
    unit: 'rows',
  },
  'platform.popular_search_window_days': {
    group: 'platform',
    type: 'number',
    label: 'Popular searches window',
    description:
      'How far back the popular search terms are counted. A shorter window reacts faster; a longer one is steadier.',
    default: 7,
    min: 1,
    max: 90,
    unit: 'days',
  },
  'platform.push_idle_days': {
    group: 'platform',
    type: 'number',
    label: 'Stop pushing to idle devices after',
    description:
      "A device that has not opened the app in this long is skipped when sending push. It stops dead installs burning send quota, and stops a phone that changed hands without the server hearing of it showing the old account's notifications for ever. That second reason is why it can only be shortened.",
    default: 90,
    min: 7,
    max: 90,
    unit: 'days',
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;

/** The value type a key holds: `number` or `boolean`. */
export type SettingValue<K extends SettingKey> =
  (typeof SETTINGS)[K]['type'] extends 'boolean' ? boolean : number;

export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

const KEY_SET = new Set<string>(SETTING_KEYS);

/**
 * A Set rather than a property lookup, so inherited names such as
 * "toString" are not mistaken for settings.
 */
export const isSettingKey = (key: string): key is SettingKey =>
  KEY_SET.has(key);

const DEFINITIONS: Record<SettingKey, SettingDefinition> = SETTINGS;

export const definitionOf = (key: SettingKey): SettingDefinition =>
  DEFINITIONS[key];

/**
 * A number setting's definition, with its range and default narrowed to
 * numbers.
 *
 * @throws Error when the key names a boolean setting. Callers pass a literal
 * key, so that is a programming mistake, not a runtime condition.
 */
export function numberDefinitionOf(key: SettingKey): NumberDefinition {
  const definition = definitionOf(key);
  if (definition.type !== 'number') {
    throw new Error(`${key} is not a number setting`);
  }
  return definition;
}

/** A fresh copy of every default, so callers can mutate it safely. */
export function defaultSettings(): SettingValues {
  const values = {} as SettingValues;
  for (const key of SETTING_KEYS) {
    (values as Record<string, number | boolean>)[key] =
      definitionOf(key).default;
  }
  return values;
}

/**
 * Reads a value out of its stored text form.
 *
 * @returns the parsed value, or `null` when the text is not a value this key
 * accepts - a stored row left over from an older range, say. The caller falls
 * back to the default rather than letting a bad row break the app.
 */
export function parseSettingValue(
  key: SettingKey,
  stored: string,
): number | boolean | null {
  const definition = definitionOf(key);
  if (definition.type === 'boolean') {
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return null;
  }
  // Number('') and Number('  ') are both 0, which for a cap whose minimum is
  // 0 would read an empty row as "no limit" instead of falling back to the
  // default. Insist on digits before converting.
  if (!/^-?\d+$/.test(stored.trim())) return null;

  const parsed = Number(stored);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < definition.min || parsed > definition.max) return null;
  return parsed;
}

/**
 * Checks a value coming from the back office against its definition.
 *
 * @returns an error message naming what is wrong, or null when the value is
 * acceptable.
 */
export function validateSettingValue(
  key: SettingKey,
  value: unknown,
): string | null {
  const definition = definitionOf(key);
  if (definition.type === 'boolean') {
    return typeof value === 'boolean' ? null : `${key} must be true or false`;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return `${key} must be a whole number`;
  }
  if (value < definition.min || value > definition.max) {
    return `${key} must be between ${definition.min} and ${definition.max}`;
  }
  return null;
}

/** The text form stored in the database. */
export const serializeSettingValue = (value: number | boolean): string =>
  String(value);
