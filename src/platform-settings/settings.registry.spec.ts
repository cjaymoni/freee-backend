import {
  defaultSettings,
  definitionOf,
  isSettingKey,
  numberDefinitionOf,
  parseSettingValue,
  serializeSettingValue,
  SETTING_GROUPS,
  SETTING_KEYS,
  type SettingKey,
  validateSettingValue,
} from './settings.registry';
import { SEED_MARKER_KEY } from './platform-settings.service';
import { MAX_PAGE_LIMIT } from '../common/assert-paging';
import {
  MAX_CHAT_IMAGE_BYTES,
  MAX_MESSAGE_LENGTH,
} from '../chat/chat.constants';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_REQUEST,
} from '../item/item-image-upload.options';

const MB = 1024 * 1024;

/**
 * Every setting whose range is pinned to a limit enforced elsewhere in the
 * code, with the constant it has to match. The registry claims a setting can
 * only ever tighten such a limit; without this table that claim lives in a
 * comment, and moving either side alone would break it silently - promising
 * admins a ceiling Multer will answer 413 to, or capping them below what the
 * code now allows.
 */
const PINNED_CEILINGS: [SettingKey, number][] = [
  ['listings.max_images', MAX_IMAGES_PER_REQUEST],
  ['listings.max_image_mb', MAX_IMAGE_BYTES / MB],
  ['chat.max_message_length', MAX_MESSAGE_LENGTH],
  ['chat.max_image_mb', MAX_CHAT_IMAGE_BYTES / MB],
  ['platform.max_page_size', MAX_PAGE_LIMIT],
];

/**
 * Settings that exist to bound an attack - guessing a code, hammering an
 * endpoint - paired with the direction staff may move them. The value the
 * code shipped with is the loosest the knob goes, so tuning the platform can
 * never weaken one of these; loosening is a code change and a deploy.
 */
const SECURITY_BOUNDS: [SettingKey, 'only lower' | 'only raise'][] = [
  ['rate_limits.requests_per_window', 'only lower'],
  ['rate_limits.window_seconds', 'only raise'],
  ['auth.max_login_attempts', 'only lower'],
  ['auth.lockout_minutes', 'only raise'],
  ['auth.code_ttl_minutes', 'only lower'],
  ['auth.max_attempts_per_code', 'only lower'],
  ['auth.max_code_guesses_per_day', 'only lower'],
  ['auth.max_codes_per_day', 'only lower'],
  ['auth.max_codes_per_ip_per_hour', 'only lower'],
  ['requests.max_pickup_code_attempts', 'only lower'],
  ['requests.pickup_code_cooldown_minutes', 'only raise'],
  ['platform.push_idle_days', 'only lower'],
];

/**
 * Settings that are free to move either side of their shipped value, with
 * why. Everything else numeric has to be in one of the two tables above, so a
 * new key cannot quietly arrive with a range that loosens something.
 */
const ELASTIC: SettingKey[] = [
  // Caps that ship switched off; 0 means no limit, so there is nothing to
  // loosen, and staff need room to pick any number.
  'listings.max_active_per_user',
  'listings.max_per_day_per_user',
  'requests.max_active_per_user',
  'requests.max_per_day_per_user',
  // How far back popular terms are counted: a product choice either way, and
  // the nightly purge keeps the widest window's data so it stays reversible.
  'platform.popular_search_window_days',
];

describe('settings registry', () => {
  it('leaves the seed marker key free', () => {
    // PlatformSettingsService stores its one-off bookkeeping row under this
    // key in the same table. A setting claiming it would make a reset clear
    // the marker and let the environment seed run a second time.
    expect(SETTING_KEYS).not.toContain(SEED_MARKER_KEY);
    expect(isSettingKey(SEED_MARKER_KEY)).toBe(false);
  });

  it('gives every setting a group the back office renders', () => {
    for (const key of SETTING_KEYS) {
      expect(SETTING_GROUPS).toContain(definitionOf(key).group);
    }
  });

  describe('a setting never loosens a limit the code enforces', () => {
    it.each(PINNED_CEILINGS)(
      '%s stops at the constant the code checks against',
      (key, ceiling) => {
        expect(numberDefinitionOf(key).max).toBe(ceiling);
      },
    );

    it('accounts for every number setting, so none can be added unchecked', () => {
      // Matching on names would let a new pinned setting slip past under a
      // name the pattern never anticipated. Every number key has to be
      // claimed by one of the three tables instead, which fails loudly the
      // day someone adds one and does not say which kind it is.
      const claimed = [
        ...PINNED_CEILINGS.map(([key]) => key),
        ...SECURITY_BOUNDS.map(([key]) => key),
        ...ELASTIC,
      ];
      const numberKeys = SETTING_KEYS.filter(
        (key) => definitionOf(key).type === 'number',
      );
      expect(claimed.sort()).toEqual(numberKeys.sort());
    });

    it('claims each number setting exactly once', () => {
      const claimed = [
        ...PINNED_CEILINGS.map(([key]) => key),
        ...SECURITY_BOUNDS.map(([key]) => key),
        ...ELASTIC,
      ];
      expect(new Set(claimed).size).toBe(claimed.length);
    });
  });

  describe('a security bound only ever tightens', () => {
    it.each(SECURITY_BOUNDS)('%s can %s', (key, direction) => {
      const { default: shipped, min, max } = numberDefinitionOf(key);
      if (direction === 'only lower') {
        expect(max).toBe(shipped);
      } else {
        expect(min).toBe(shipped);
      }
    });
  });

  it('ships a default inside its own range', () => {
    for (const key of SETTING_KEYS) {
      const definition = definitionOf(key);
      if (definition.type !== 'number') continue;
      expect(definition.min).toBeLessThanOrEqual(definition.max);
      expect(
        definition.default === 0 || definition.default >= definition.min,
      ).toBe(true);
      expect(definition.default).toBeLessThanOrEqual(definition.max);
    }
  });

  it('round-trips every default through storage', () => {
    for (const key of SETTING_KEYS) {
      const stored = serializeSettingValue(definitionOf(key).default);
      expect(parseSettingValue(key, stored)).toBe(definitionOf(key).default);
    }
  });

  describe('isSettingKey', () => {
    it('accepts a key in the catalogue', () => {
      expect(isSettingKey('rate_limits.requests_per_window')).toBe(true);
    });

    it('rejects anything else, including inherited object keys', () => {
      expect(isSettingKey('rate_limits.nonsense')).toBe(false);
      expect(isSettingKey('toString')).toBe(false);
      expect(isSettingKey('')).toBe(false);
    });
  });

  describe('parseSettingValue', () => {
    it('reads a number back', () => {
      expect(parseSettingValue('listings.max_active_per_user', '250')).toBe(
        250,
      );
    });

    it('reads a boolean back', () => {
      expect(parseSettingValue('listings.hold_new_for_review', 'false')).toBe(
        false,
      );
    });

    it.each([
      ['empty', ''],
      ['not a number', 'lots'],
      ['fractional', '12.5'],
      ['below the minimum', '-5'],
      ['above the maximum', '999999'],
    ])('returns null for a %s value', (_, stored) => {
      expect(
        parseSettingValue('listings.max_active_per_user', stored),
      ).toBeNull();
    });

    it('returns null for a boolean stored as anything but true or false', () => {
      expect(
        parseSettingValue('listings.hold_new_for_review', 'yes'),
      ).toBeNull();
      expect(parseSettingValue('listings.hold_new_for_review', '1')).toBeNull();
    });
  });

  describe('validateSettingValue', () => {
    it('accepts a whole number inside the range', () => {
      expect(
        validateSettingValue('listings.max_active_per_user', 250),
      ).toBeNull();
    });

    it.each([
      ['a string', '250'],
      ['a fraction', 1.5],
      ['below the minimum', -5],
      ['above the maximum', 5000],
      ['null', null],
      ['NaN', Number.NaN],
    ])('rejects %s', (_, value) => {
      expect(
        validateSettingValue('listings.max_active_per_user', value),
      ).toEqual(expect.any(String));
    });

    it('accepts booleans only for boolean settings', () => {
      expect(validateSettingValue('listings.hold_new_for_review', true)).toBe(
        null,
      );
      expect(
        validateSettingValue('listings.hold_new_for_review', 'true'),
      ).toEqual(expect.any(String));
      expect(validateSettingValue('listings.hold_new_for_review', 1)).toEqual(
        expect.any(String),
      );
    });
  });

  describe('defaultSettings', () => {
    it('covers every key', () => {
      expect(Object.keys(defaultSettings()).sort()).toEqual(
        [...SETTING_KEYS].sort(),
      );
    });

    it('hands back a fresh object each time', () => {
      const first = defaultSettings();
      first['platform.max_page_size'] = 10;
      expect(defaultSettings()['platform.max_page_size']).toBe(
        definitionOf('platform.max_page_size').default,
      );
    });
  });
});
