import type { PlatformSettingsService } from '../platform-settings.service';
import {
  defaultSettings,
  type SettingKey,
  type SettingValues,
} from '../settings.registry';

/**
 * A PlatformSettingsService that answers from a plain object, for unit tests
 * that need the limits but not the database behind them.
 *
 * @param overrides the keys to answer differently from the shipped defaults.
 */
export function stubPlatformSettings(
  overrides: Partial<SettingValues> = {},
): PlatformSettingsService {
  const values = { ...defaultSettings(), ...overrides };
  return {
    get: <K extends SettingKey>(key: K) => values[key],
    all: () => ({ ...values }),
  } as PlatformSettingsService;
}
