import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PlatformSettingEntity } from './entities/platform-setting.entity';
import {
  defaultSettings,
  definitionOf,
  isSettingKey,
  parseSettingValue,
  serializeSettingValue,
  SETTING_KEYS,
  type SettingKey,
  type SettingValue,
  type SettingValues,
  validateSettingValue,
} from './settings.registry';

/**
 * How often an instance re-reads the table. A change made in the back office
 * applies to the instance that served the write at once; the others pick it
 * up within this window. Nothing here is a security boundary on its own, so a
 * few seconds of skew between instances is fine.
 */
export const SETTINGS_REFRESH_MS = 30_000;

/**
 * Settings that used to be environment variables. On the first boot after
 * this module ships, a variable that is set and differs from the registry
 * default is written in as the stored value, so a deployment that had, say,
 * FOUNDING_FREERS_OPEN=true does not quietly revert when the setting takes
 * over. Afterwards the database is the only source of truth and the variable
 * is ignored - see .env.example.
 */
const LEGACY_ENV_VARS: Partial<Record<SettingKey, string>> = {
  'platform.founding_freers_open': 'FOUNDING_FREERS_OPEN',
  'auth.max_login_attempts': 'MAX_LOGIN_ATTEMPTS',
  'auth.lockout_minutes': 'LOCKOUT_DURATION_MINUTES',
};

/**
 * Marks the environment seed as done, so it runs exactly once for the life of
 * the database rather than once per empty row.
 *
 * "A row already exists for this key" cannot stand in for that: a setting put
 * back to its default has its row deleted, so without this marker the next
 * boot would read the stale variable and silently undo the change - closing
 * Founding Freer sign-ups in the back office would reopen them on deploy.
 *
 * It is not a setting, so isSettingKey rejects it and refresh() skips it.
 * It carries no dot, which every registry key does, but `settings.registry.spec.ts`
 * pins that apart rather than leaving it to the naming.
 */
export const SEED_MARKER_KEY = '__legacy_env_seeded';

/** A change the back office asked for, after it has been checked. */
export type SettingChanges = Partial<Record<SettingKey, number | boolean>>;

/**
 * Serves the platform settings to the rest of the app from memory, so a
 * request path never waits on a query to find out its own limits.
 *
 * Callers read with {@link get}, which is synchronous and always returns a
 * usable value: a stored one when it parses, the registry default otherwise.
 */
@Injectable()
export class PlatformSettingsService implements OnModuleInit {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private values: SettingValues = defaultSettings();

  constructor(
    @InjectRepository(PlatformSettingEntity)
    private readonly settings: Repository<PlatformSettingEntity>,
    private readonly config: ConfigService,
  ) {}

  /**
   * The cache already holds the defaults by the time this runs, so a database
   * that is briefly unreachable at boot costs the app its stored values for
   * up to one refresh interval, not its ability to start. This module is
   * global; throwing here would fail Nest's bootstrap and take every feature
   * down over one table.
   */
  async onModuleInit(): Promise<void> {
    await this.seedFromEnvironment();
    await this.refreshQuietly();
  }

  /**
   * Writes the legacy environment variables in as stored values, once ever.
   *
   * The marker row goes in with the values in a single `insert ... orIgnore`,
   * so two instances booting together cannot both seed and neither can
   * overwrite the other: whichever statement lands second is ignored key by
   * key. A later boot sees the marker and does nothing, whatever happened to
   * the value rows in between.
   */
  private async seedFromEnvironment(): Promise<void> {
    try {
      if (await this.settings.exists({ where: { key: SEED_MARKER_KEY } })) {
        return;
      }

      const rows: { key: string; value: string }[] = [
        { key: SEED_MARKER_KEY, value: new Date().toISOString() },
      ];

      for (const [key, variable] of Object.entries(LEGACY_ENV_VARS) as [
        SettingKey,
        string,
      ][]) {
        const raw = this.config.get<string | number | boolean>(variable);
        if (raw === undefined || raw === null || raw === '') continue;

        const parsed = parseSettingValue(key, String(raw));
        if (parsed === null) {
          this.logger.warn(
            `Ignoring ${variable}="${String(raw)}"; it is not a value ${key} accepts`,
          );
          continue;
        }
        if (parsed === definitionOf(key).default) continue;
        rows.push({ key, value: serializeSettingValue(parsed) });
      }

      await this.settings
        .createQueryBuilder()
        .insert()
        .values(rows)
        .orIgnore()
        .execute();

      const seeded = rows.length - 1;
      if (seeded > 0) {
        this.logger.log(
          `Seeded ${seeded} platform setting(s) from legacy environment variables`,
        );
      }
    } catch (error) {
      // A seed is a convenience, never a reason to refuse to start.
      this.logger.error(
        `Could not seed platform settings from the environment: ${(error as Error).message}`,
      );
    }
  }

  /** The value in force right now. */
  get<K extends SettingKey>(key: K): SettingValue<K> {
    return this.values[key];
  }

  /** Every value in force right now, as a copy. */
  all(): SettingValues {
    return { ...this.values };
  }

  /**
   * Re-reads the table into memory.
   *
   * A row whose text no longer parses - a value stored before its range was
   * narrowed, say - is logged and left at the default rather than taken as
   * written, so one bad row cannot take an endpoint down.
   */
  async refresh(): Promise<SettingValues> {
    const rows = await this.settings.find();
    const next = defaultSettings();

    for (const row of rows) {
      // The seed marker, or a key this build no longer has.
      if (!isSettingKey(row.key)) continue;
      const parsed = parseSettingValue(row.key, row.value);
      if (parsed === null) {
        this.logger.warn(
          `Ignoring stored value "${row.value}" for setting ${row.key}; using the default instead`,
        );
        continue;
      }
      (next as Record<string, number | boolean>)[row.key] = parsed;
    }

    this.values = next;
    return this.all();
  }

  /** Keeps instances that did not serve the write roughly in step. */
  @Interval(SETTINGS_REFRESH_MS)
  async refreshQuietly(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      this.logger.error(
        `Could not refresh platform settings: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Applies a set of changes and reloads the cache.
   *
   * @param changes the keys to change, each already of the right shape.
   * @param actorId the staff member making the change, recorded on the row.
   * @returns the values before and after, so the caller can audit the diff.
   * @throws BadRequestException when a key is unknown or a value is out of
   * range. Nothing is written when any one of them fails: the keys are all
   * checked before the first write, and the writes share a transaction, so a
   * batch can never land half-applied. A failure from the reload afterwards
   * does propagate, and the change is live by then - the caller reports an
   * error for a write that worked, and the interval refresh picks the new
   * values up within SETTINGS_REFRESH_MS.
   */
  async update(
    changes: SettingChanges,
    actorId: string,
  ): Promise<{ before: SettingValues; after: SettingValues }> {
    const entries = Object.entries(changes) as [SettingKey, number | boolean][];
    if (entries.length === 0) {
      throw new BadRequestException('No settings to change');
    }

    const problems = entries.flatMap(([key, value]) => {
      const name: string = key;
      if (!isSettingKey(name)) return [`${name} is not a platform setting`];
      return validateSettingValue(name, value) ?? [];
    });
    if (problems.length) throw new BadRequestException(problems);

    const before = this.all();

    // Only values that differ from the default are stored, so a setting put
    // back to its default stops being a row and follows the code again.
    const toStore = entries.filter(
      ([key, value]) => value !== definitionOf(key).default,
    );
    const toClear = entries
      .filter(([key, value]) => value === definitionOf(key).default)
      .map(([key]) => key);

    await this.settings.manager.transaction(async (manager) => {
      if (toStore.length) {
        await manager.upsert(
          PlatformSettingEntity,
          toStore.map(([key, value]) => ({
            key,
            value: serializeSettingValue(value),
            updated_by: actorId,
          })),
          ['key'],
        );
      }
      if (toClear.length) {
        await manager.delete(PlatformSettingEntity, { key: In(toClear) });
      }
    });

    return { before, after: await this.refresh() };
  }

  /**
   * The rows behind the settings that are not at their default, so the back
   * office can show who last changed each one and when.
   *
   * The seed marker is filtered out: it is bookkeeping, not a setting, and a
   * caller that joined these rows to the registry would otherwise have to
   * know to skip it.
   */
  async overrides(): Promise<PlatformSettingEntity[]> {
    const rows = await this.settings.find({ relations: ['editor'] });
    return rows.filter((row) => isSettingKey(row.key));
  }

  /** Puts every setting back to the value the code ships with. */
  async resetAll(): Promise<{ before: SettingValues; after: SettingValues }> {
    const before = this.all();
    await this.settings.delete({ key: In(SETTING_KEYS) });
    return { before, after: await this.refresh() };
  }
}
