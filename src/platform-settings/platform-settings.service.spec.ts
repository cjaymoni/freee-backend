import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { PlatformSettingEntity } from './entities/platform-setting.entity';
import { PlatformSettingsService } from './platform-settings.service';
import { defaultSettings, definitionOf } from './settings.registry';

type Row = Pick<PlatformSettingEntity, 'key' | 'value'>;

/** The key the service writes to record that the one-off env seed has run. */
const SEED_MARKER = '__legacy_env_seeded';

/** The keys a `delete({ key: In([...]) })` call was asked to clear. */
/**
 * The keys a `delete({ key: In([...]) })` call was asked to clear. The
 * repository form takes the criteria alone; the transaction manager's takes
 * the entity first.
 */
function deletedKeys(target: { delete: jest.Mock }): string[] {
  const args = target.delete.mock.calls[0] as unknown[];
  const where = args[args.length - 1] as { key: { value: string[] } };
  return where.key.value;
}

function setup(rows: Row[] = [], env: Record<string, string> = {}) {
  // What update() writes through, inside its transaction.
  const manager = {
    upsert: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  };
  // Typed, so the assertions below read the seeded rows without a cast.
  const insert = jest.fn<void, [Row[]]>();
  const repo = {
    find: jest.fn().mockResolvedValue(rows),
    // Answers from the same rows the table was set up with, so a marker row
    // passed in behaves like a database that has already been seeded.
    exists: jest
      .fn()
      .mockImplementation(({ where }: { where: { key: string } }) =>
        Promise.resolve(rows.some((row) => row.key === where.key)),
      ),
    manager: {
      transaction: (work: (m: unknown) => Promise<unknown>) => work(manager),
    },
    upsert: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    createQueryBuilder: jest.fn(() => ({
      insert: () => ({
        values: (values: Row[]) => ({
          orIgnore: () => ({
            execute: () => {
              insert(values);
              return Promise.resolve({});
            },
          }),
        }),
      }),
    })),
  };
  const config = { get: (name: string) => env[name] } as ConfigService;
  const service = new PlatformSettingsService(
    repo as unknown as Repository<PlatformSettingEntity>,
    config,
  );
  return { service, repo, manager, insert };
}

describe('PlatformSettingsService', () => {
  describe('refresh', () => {
    it('serves the shipped default when nothing is stored', async () => {
      const { service } = setup();
      await service.refresh();
      expect(service.get('rate_limits.requests_per_window')).toBe(
        definitionOf('rate_limits.requests_per_window').default,
      );
    });

    it('serves a stored value over the default', async () => {
      const { service } = setup([
        { key: 'listings.max_active_per_user', value: '250' },
      ]);
      await service.refresh();
      expect(service.get('listings.max_active_per_user')).toBe(250);
    });

    it('reads booleans back', async () => {
      const { service } = setup([
        { key: 'listings.hold_new_for_review', value: 'false' },
      ]);
      await service.refresh();
      expect(service.get('listings.hold_new_for_review')).toBe(false);
    });

    it('falls back to the default for a row that no longer parses', async () => {
      const { service } = setup([
        { key: 'listings.max_active_per_user', value: '999999' },
      ]);
      await service.refresh();
      expect(service.get('listings.max_active_per_user')).toBe(
        definitionOf('listings.max_active_per_user').default,
      );
    });

    it('ignores the seed marker, which is not a setting', async () => {
      const { service } = setup([{ key: SEED_MARKER, value: 'anything' }]);
      await expect(service.refresh()).resolves.toEqual(defaultSettings());
    });

    it('ignores a key this build no longer has', async () => {
      const { service } = setup([{ key: 'legacy.removed', value: '7' }]);
      await expect(service.refresh()).resolves.toEqual(
        expect.objectContaining({ 'platform.max_page_size': 100 }),
      );
    });

    it('hands back a copy, so a caller cannot edit what is in force', async () => {
      const { service } = setup();
      const values = await service.refresh();
      values['platform.max_page_size'] = 10;
      expect(service.get('platform.max_page_size')).toBe(100);
    });
  });

  describe('update', () => {
    it('stores a value that differs from the default', async () => {
      const { service, manager } = setup();
      await service.refresh();
      await service.update({ 'listings.max_active_per_user': 250 }, 'staff-1');
      expect(manager.upsert).toHaveBeenCalledWith(
        PlatformSettingEntity,
        [
          {
            key: 'listings.max_active_per_user',
            value: '250',
            updated_by: 'staff-1',
          },
        ],
        ['key'],
      );
    });

    it('deletes the row when a value is put back to its default', async () => {
      const { service, manager } = setup([
        { key: 'platform.max_page_size', value: '20' },
      ]);
      await service.refresh();
      await service.update({ 'platform.max_page_size': 100 }, 'staff-1');
      expect(manager.upsert).not.toHaveBeenCalled();
      expect(deletedKeys(manager)).toEqual(['platform.max_page_size']);
    });

    it('reports the values before and after', async () => {
      const { service, repo } = setup();
      await service.refresh();
      repo.find.mockResolvedValue([
        { key: 'platform.max_page_size', value: '25' },
      ]);
      const { before, after } = await service.update(
        { 'platform.max_page_size': 25 },
        'staff-1',
      );
      expect(before['platform.max_page_size']).toBe(100);
      expect(after['platform.max_page_size']).toBe(25);
    });

    it('refuses an out-of-range value and writes nothing', async () => {
      const { service, manager } = setup();
      await service.refresh();
      await expect(
        service.update({ 'platform.max_page_size': 5000 }, 'staff-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.upsert).not.toHaveBeenCalled();
    });

    it('refuses a value that would loosen a security bound', async () => {
      const { service, manager } = setup();
      await service.refresh();
      await expect(
        service.update({ 'auth.max_code_guesses_per_day': 500 }, 'staff-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.upsert).not.toHaveBeenCalled();
    });

    it('refuses a key that is not a setting', async () => {
      const { service, manager } = setup();
      await service.refresh();
      await expect(
        service.update({ 'platform.drop_everything': 1 } as never, 'staff-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.upsert).not.toHaveBeenCalled();
    });

    it('refuses the seed marker as a key', async () => {
      const { service, manager } = setup();
      await service.refresh();
      await expect(
        service.update({ [SEED_MARKER]: 1 } as never, 'staff-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.upsert).not.toHaveBeenCalled();
    });

    it('refuses an empty change', async () => {
      const { service } = setup();
      await expect(service.update({}, 'staff-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects the whole batch when one value is wrong', async () => {
      const { service, manager } = setup();
      await service.refresh();
      await expect(
        service.update(
          {
            'platform.max_page_size': 50,
            'rate_limits.requests_per_window': 0,
          },
          'staff-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.upsert).not.toHaveBeenCalled();
    });

    it('writes the whole batch in one transaction', async () => {
      const { service, repo, manager } = setup([
        { key: 'platform.max_page_size', value: '20' },
      ]);
      await service.refresh();
      const inTransaction = jest.fn();
      repo.manager.transaction = async (
        work: (m: unknown) => Promise<void>,
      ) => {
        inTransaction();
        await work(manager);
      };

      await service.update(
        {
          'listings.max_active_per_user': 250,
          'platform.max_page_size': 100,
        },
        'staff-1',
      );

      // One transaction covering both the write and the clear, so a batch
      // cannot land half-applied.
      expect(inTransaction).toHaveBeenCalledTimes(1);
      expect(manager.upsert).toHaveBeenCalledTimes(1);
      expect(manager.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetAll', () => {
    it('clears every stored row', async () => {
      const { service, repo } = setup([
        { key: 'platform.max_page_size', value: '20' },
      ]);
      await service.refresh();
      repo.find.mockResolvedValue([]);
      const { after } = await service.resetAll();
      expect(repo.delete).toHaveBeenCalled();
      expect(after['platform.max_page_size']).toBe(100);
    });

    it('leaves the seed marker in place, so the env seed stays done', async () => {
      const { service, repo } = setup();
      await service.resetAll();
      expect(deletedKeys(repo)).not.toContain(SEED_MARKER);
    });
  });

  describe('starting up', () => {
    it('carries a legacy environment variable into the table once', async () => {
      const { service, insert } = setup([], { FOUNDING_FREERS_OPEN: 'true' });
      await service.onModuleInit();
      const [written] = insert.mock.calls[0];
      expect(written).toContainEqual({
        key: 'platform.founding_freers_open',
        value: 'true',
      });
    });

    it('writes the marker with the values, in the same statement', async () => {
      const { service, insert } = setup([], { FOUNDING_FREERS_OPEN: 'true' });
      await service.onModuleInit();
      const [written] = insert.mock.calls[0];
      expect(written.map((row) => row.key)).toContain(SEED_MARKER);
    });

    it('never seeds again once the marker is there', async () => {
      // The admin closed sign-ups, which deleted the value row; the stale
      // variable must not bring it back on the next boot.
      const { service, insert } = setup([{ key: SEED_MARKER, value: 'then' }], {
        FOUNDING_FREERS_OPEN: 'true',
      });
      await service.onModuleInit();
      expect(insert).not.toHaveBeenCalled();
      expect(service.get('platform.founding_freers_open')).toBe(false);
    });

    it('marks the seed done even when no variable is set', async () => {
      const { service, insert } = setup();
      await service.onModuleInit();
      const [written] = insert.mock.calls[0];
      expect(written.map((row) => row.key)).toEqual([SEED_MARKER]);
      // The marker's value is only a record of when the seed ran.
      expect(typeof written[0].value).toBe('string');
    });

    it('stores no value when the variable already matches the default', async () => {
      const { service, insert } = setup([], { FOUNDING_FREERS_OPEN: 'false' });
      await service.onModuleInit();
      const [written] = insert.mock.calls[0];
      expect(written.map((row) => row.key)).toEqual([SEED_MARKER]);
    });

    it('ignores a variable holding a value the setting does not accept', async () => {
      const { service, insert } = setup([], { MAX_LOGIN_ATTEMPTS: 'loads' });
      await service.onModuleInit();
      const [written] = insert.mock.calls[0];
      expect(written.map((row) => row.key)).toEqual([SEED_MARKER]);
    });

    it('starts on the defaults even if the table cannot be read', async () => {
      const { service, repo } = setup();
      repo.exists.mockRejectedValue(new Error('database is down'));
      repo.find.mockRejectedValue(new Error('database is down'));

      // A global module throwing here would fail Nest's bootstrap and take
      // every feature down over one table.
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(service.get('platform.max_page_size')).toBe(100);
    });
  });

  describe('refreshQuietly', () => {
    it('swallows a failed refresh and keeps the values it had', async () => {
      const { service, repo } = setup([
        { key: 'platform.max_page_size', value: '20' },
      ]);
      await service.refresh();
      repo.find.mockRejectedValue(new Error('database is down'));
      await expect(service.refreshQuietly()).resolves.toBeUndefined();
      expect(service.get('platform.max_page_size')).toBe(20);
    });
  });
});
