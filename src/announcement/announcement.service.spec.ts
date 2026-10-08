import { Repository } from 'typeorm';
import { announcementState, AnnouncementService } from './announcement.service';
import {
  AnnouncementEntity,
  AnnouncementLevel,
} from './entities/announcement.entity';

const NOW = new Date('2026-10-07T12:00:00Z');
const at = (iso: string) => new Date(iso);

describe('announcementState', () => {
  const banner = (over: Partial<AnnouncementEntity> = {}) => ({
    is_active: true,
    active_from: at('2026-10-01T00:00:00Z'),
    active_until: null,
    ...over,
  });

  it.each([
    ['live with no end', banner(), 'live'],
    [
      'live before its end',
      banner({ active_until: at('2026-10-08T00:00:00Z') }),
      'live',
    ],
    [
      'scheduled before its start',
      banner({ active_from: at('2026-10-09T00:00:00Z') }),
      'scheduled',
    ],
    ['ended at its end', banner({ active_until: NOW }), 'ended'],
    ['off whatever the dates', banner({ is_active: false }), 'off'],
  ])('%s', (_, a, state) => {
    expect(announcementState(a, NOW)).toBe(state);
  });
});

describe('AnnouncementService', () => {
  const setup = (existing?: Partial<AnnouncementEntity>) => {
    const row = {
      id: 'a-1',
      message: 'Maintenance tonight',
      level: AnnouncementLevel.INFO,
      is_active: true,
      active_from: at('2026-10-01T00:00:00Z'),
      active_until: null,
      ...existing,
    };
    const repo = {
      create: jest.fn((r: object) => ({ ...r })),
      merge: jest.fn((target: object, patch: object) =>
        Object.assign(target, patch),
      ),
      save: jest.fn((r: object) => Promise.resolve({ ...r, id: 'a-1' })),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockResolvedValue(row),
    };
    const service = new AnnouncementService(
      repo as unknown as Repository<AnnouncementEntity>,
    );
    return { service, repo };
  };

  it('starts a new banner now, as info, switched on', async () => {
    const { service, repo } = setup();
    await service.create({ message: 'Maintenance tonight' }, 'admin-1');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Maintenance tonight',
        level: AnnouncementLevel.INFO,
        is_active: true,
        active_until: null,
        created_by: 'admin-1',
      }),
    );
  });

  it('refuses an end that is not after the start', async () => {
    const { service, repo } = setup();
    await expect(
      service.create(
        {
          message: 'x',
          active_from: '2026-10-08T00:00:00Z',
          active_until: '2026-10-08T00:00:00Z',
        },
        'admin-1',
      ),
    ).rejects.toThrow('The end has to be after the start');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('checks an edit against the dates it keeps', async () => {
    const { service, repo } = setup({
      active_from: at('2026-10-05T00:00:00Z'),
    });
    await expect(
      service.update('a-1', { active_until: '2026-10-04T00:00:00Z' }),
    ).rejects.toThrow('The end has to be after the start');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('switches a banner off and can clear its end', async () => {
    const { service, repo } = setup({
      active_until: at('2026-10-20T00:00:00Z'),
    });
    await service.update('a-1', { is_active: false, active_until: null });
    expect(repo.update).toHaveBeenCalledWith(
      'a-1',
      expect.objectContaining({ is_active: false, active_until: null }),
    );
  });

  it('says so when the banner does not exist', async () => {
    const { service, repo } = setup();
    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.remove('nope')).rejects.toThrow('Banner not found');
  });
});
