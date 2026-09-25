import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from '../audit.service';
import { AuditHelperService } from '../audit-helper.service';

describe('AuditInterceptor entity detection', () => {
  const interceptor = new AuditInterceptor(
    {} as AuditService,
    {} as AuditHelperService,
  ) as unknown as {
    extractEntityInfo: (request: object) => {
      entityType: string;
      entityId?: string;
    } | null;
  };
  const detect = (path: string, params: object = {}, extra: object = {}) =>
    interceptor.extractEntityInfo({ path, params, ...extra });

  it.each([
    [
      '/moderation/items/report/rep-1/resolve',
      { id: 'rep-1' },
      'reported_items',
      'rep-1',
    ],
    [
      '/moderation/users/report/rep-2/resolve',
      { id: 'rep-2' },
      'reported_users',
      'rep-2',
    ],
    ['/moderation/items/report', {}, 'reported_items', undefined],
    [
      '/moderation/users/block/u9',
      { blockedId: 'u9' },
      'blocked_users',
      undefined,
    ],
    [
      '/moderation/complaints/c-1/resolve',
      { id: 'c-1' },
      'moderation_complaints',
      'c-1',
    ],
    ['/moderation/complaints', {}, 'moderation_complaints', undefined],
    ['/item-requests', {}, 'item_requests', undefined],
    [
      '/item-requests/req-1/pickup',
      { requestId: 'req-1' },
      'item_requests',
      'req-1',
    ],
    [
      '/items/it-1/images/img-1',
      { itemId: 'it-1', imageId: 'img-1' },
      'item_images',
      'img-1',
    ],
    ['/items/it-1', { id: 'it-1' }, 'items', 'it-1'],
    ['/categories/cat-1', { id: 'cat-1' }, 'categories', 'cat-1'],
    ['/user/u1', { id: 'u1' }, 'users', 'u1'],
  ])('%s is logged as %s', (path, params, entityType, entityId) => {
    expect(detect(path, params)).toEqual({ entityType, entityId });
  });

  it.each([['/saved-items'], ['/auth/login'], ['/itemsx']])(
    'does not guess an entity for %s',
    (path) => {
      expect(detect(path)).toBeNull();
    },
  );
});
