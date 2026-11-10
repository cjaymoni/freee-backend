import type { Request } from 'express';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminAuditService } from './admin-audit.service';
import { AuditEntityType } from '../audit/audit.constants';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import {
  defaultSettings,
  SETTING_GROUPS,
  SETTING_KEYS,
  type SettingValues,
} from '../platform-settings/settings.registry';
import { UserRole } from '../user/entities/user.entity';

type Groups = {
  key: string;
  settings: {
    key: string;
    value: unknown;
    is_default: boolean;
    updated_at: Date | null;
    updated_by: { id: string } | null;
  }[];
}[];

const ACTOR = { userId: 'staff-1', role: UserRole.ADMIN };
const REQUEST = { ip: '127.0.0.1', headers: {} } as unknown as Request;

function setup(current: Partial<SettingValues> = {}) {
  const values = { ...defaultSettings(), ...current };
  const settings = {
    all: jest.fn(() => ({ ...values })),
    overrides: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    resetAll: jest.fn(),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const controller = new AdminSettingsController(
    settings as unknown as PlatformSettingsService,
    audit as unknown as AdminAuditService,
  );
  return { controller, settings, audit, values };
}

describe('AdminSettingsController', () => {
  describe('list', () => {
    it('returns every setting, grouped the way the page renders', async () => {
      const { controller } = setup();

      const body = await controller.list();
      const groups = (body.data as { groups: Groups }).groups;

      expect(groups.map((g) => g.key)).toEqual([...SETTING_GROUPS]);
      expect(
        groups
          .flatMap((g) => g.settings)
          .map((s) => s.key)
          .sort(),
      ).toEqual([...SETTING_KEYS].sort());
    });

    it('marks a setting staff have changed as no longer a default', async () => {
      const { controller } = setup({ 'platform.max_page_size': 25 });

      const body = await controller.list();
      const groups = (body.data as { groups: Groups }).groups;
      const all = groups.flatMap((g) => g.settings);

      expect(all.find((s) => s.key === 'platform.max_page_size')).toMatchObject(
        { value: 25, is_default: false },
      );
      expect(all.find((s) => s.key === 'chat.max_image_mb')).toMatchObject({
        is_default: true,
      });
    });

    it('says who last changed a setting', async () => {
      const { controller, settings } = setup({ 'platform.max_page_size': 25 });
      settings.overrides.mockResolvedValue([
        {
          key: 'platform.max_page_size',
          value: '25',
          updated_at: new Date('2026-11-01T09:00:00Z'),
          editor: { id: 'staff-9', first_name: 'Ama', last_name: 'Mensah' },
        },
      ]);

      const body = await controller.list();
      const groups = (body.data as { groups: Groups }).groups;
      const changed = groups
        .flatMap((g) => g.settings)
        .find((s) => s.key === 'platform.max_page_size');

      expect(changed?.updated_at).toEqual(new Date('2026-11-01T09:00:00Z'));
      expect(changed?.updated_by?.id).toBe('staff-9');
    });
  });

  describe('update', () => {
    it('audits only the settings whose value actually moved', async () => {
      const { controller, settings, audit } = setup();
      const before = defaultSettings();
      const after = { ...before, 'platform.max_page_size': 25 };
      settings.update.mockResolvedValue({ before, after });
      settings.all.mockReturnValue(after);

      await controller.update(
        { settings: { 'platform.max_page_size': 25 } },
        ACTOR.userId,
        ACTOR.role,
        REQUEST,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: AuditEntityType.PLATFORM_SETTINGS,
          action: 'updated',
          oldValues: { 'platform.max_page_size': 100 },
          newValues: { 'platform.max_page_size': 25 },
        }),
      );
    });

    it('logs nothing when the submitted values were already in force', async () => {
      const { controller, settings, audit } = setup();
      const same = defaultSettings();
      settings.update.mockResolvedValue({ before: same, after: { ...same } });

      await controller.update(
        { settings: { 'platform.max_page_size': 100 } },
        ACTOR.userId,
        ACTOR.role,
        REQUEST,
      );

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers with the settings as they now stand', async () => {
      const { controller, settings } = setup();
      const after = {
        ...defaultSettings(),
        'listings.hold_new_for_review': false,
      };
      settings.update.mockResolvedValue({
        before: defaultSettings(),
        after,
      });
      settings.all.mockReturnValue(after);

      const body = await controller.update(
        { settings: { 'listings.hold_new_for_review': false } },
        ACTOR.userId,
        ACTOR.role,
        REQUEST,
      );
      const groups = (body.data as { groups: Groups }).groups;

      expect(
        groups
          .flatMap((g) => g.settings)
          .find((s) => s.key === 'listings.hold_new_for_review'),
      ).toMatchObject({ value: false });
    });
  });

  describe('reset', () => {
    it('audits the settings that were put back', async () => {
      const { controller, settings, audit } = setup();
      const after = defaultSettings();
      settings.resetAll.mockResolvedValue({
        before: { ...after, 'platform.max_page_size': 25 },
        after,
      });

      await controller.reset(ACTOR.userId, ACTOR.role, REQUEST);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'restored',
          oldValues: { 'platform.max_page_size': 25 },
          newValues: { 'platform.max_page_size': 100 },
        }),
      );
    });
  });
});
