import { Brackets, DataSource } from 'typeorm';
import { MessageEntity, SystemEvent } from '../chat/entities/message.entity';
import {
  ItemRequestEntity,
  RequestStatus,
} from '../item-request/entities/item-request.entity';
import {
  AdminRequestsService,
  statusHistory,
  toAdminRequest,
} from './admin-requests.service';

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute));

const user = (id: string) => ({ id, first_name: id, account_status: 'active' });

const request = (overrides: Partial<ItemRequestEntity> = {}) =>
  ({
    id: 'req-1',
    item_id: 'item-1',
    requester_id: 'requester',
    owner_id: 'owner',
    requester: user('requester'),
    owner: user('owner'),
    status: RequestStatus.PENDING,
    pickup_date: null,
    is_picked_up: false,
    picked_up_at: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelledByUser: null,
    cancellation_reason: null,
    created_at: at(0),
    updated_at: at(0),
    ...overrides,
  }) as unknown as ItemRequestEntity;

const message = (
  system_event: SystemEvent,
  sender_id: string,
  minute: number,
) => ({ system_event, sender_id, created_at: at(minute) });

const summarize = (history: ReturnType<typeof statusHistory>) =>
  history.map((e) => [e.status, e.actor?.id ?? null, e.at, e.note]);

describe('statusHistory', () => {
  it('follows the system messages, attributing each to its sender', () => {
    const history = statusHistory(
      request({
        status: RequestStatus.COMPLETED,
        is_picked_up: true,
        picked_up_at: at(30),
      }),
      [
        message(SystemEvent.ITEM_REQUESTED, 'requester', 0),
        message(SystemEvent.REQUEST_CONFIRMED, 'owner', 10),
        // The requester confirms the pickup.
        message(SystemEvent.PICKUP_CONFIRMED, 'requester', 30),
      ],
    );

    expect(summarize(history)).toEqual([
      [RequestStatus.PENDING, 'requester', at(0), null],
      [RequestStatus.CONFIRMED, 'owner', at(10), null],
      [RequestStatus.COMPLETED, 'requester', at(30), null],
    ]);
  });

  it('falls back to the request when the messages are missing, crediting the right party', () => {
    const history = statusHistory(
      request({
        status: RequestStatus.COMPLETED,
        is_picked_up: true,
        picked_up_at: at(30),
      }),
      [],
    );

    // The confirmation has no recorded time, so it sorts just before pickup.
    expect(summarize(history)).toEqual([
      [RequestStatus.PENDING, 'requester', at(0), null],
      [RequestStatus.CONFIRMED, 'owner', null, null],
      [RequestStatus.COMPLETED, 'requester', at(30), null],
    ]);
  });

  it('shows a still-confirmed request as confirmed even without its message', () => {
    const history = statusHistory(
      request({ status: RequestStatus.CONFIRMED, updated_at: at(15) }),
      [message(SystemEvent.ITEM_REQUESTED, 'requester', 0)],
    );

    expect(summarize(history)).toEqual([
      [RequestStatus.PENDING, 'requester', at(0), null],
      [RequestStatus.CONFIRMED, 'owner', null, null],
    ]);
  });

  it('does not invent a confirmation for a request that never had one', () => {
    for (const status of [RequestStatus.PENDING, RequestStatus.CANCELLED]) {
      const history = statusHistory(
        request({
          status,
          cancelled_at: status === RequestStatus.CANCELLED ? at(5) : null,
        }),
        [],
      );
      expect(history.map((e) => e.status)).not.toContain(
        RequestStatus.CONFIRMED,
      );
    }
  });

  it('falls back to the request for a bulk close, crediting whoever closed it', () => {
    const history = statusHistory(
      request({
        status: RequestStatus.CANCELLED,
        cancelled_at: at(20),
        cancelled_by: 'admin',
        cancelledByUser: user('admin') as never,
        cancellation_reason: 'Listing removed',
      }),
      [],
    );

    expect(summarize(history)).toEqual([
      [RequestStatus.PENDING, 'requester', at(0), null],
      [RequestStatus.CANCELLED, 'admin', at(20), 'Listing removed'],
    ]);
  });

  it('puts the cancellation reason on the cancel message, without doubling it', () => {
    const history = statusHistory(
      request({
        status: RequestStatus.CANCELLED,
        cancelled_at: at(5),
        cancelled_by: 'requester',
        cancellation_reason: 'Found one elsewhere',
      }),
      [
        message(SystemEvent.ITEM_REQUESTED, 'requester', 0),
        message(SystemEvent.REQUEST_CANCELLED, 'requester', 5),
      ],
    );

    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      status: RequestStatus.CANCELLED,
      note: 'Found one elsewhere',
    });
  });

  it('never leaks its internal sort key', () => {
    const [event] = statusHistory(request(), []);
    expect(Object.keys(event).sort()).toEqual([
      'actor',
      'at',
      'note',
      'status',
    ]);
  });
});

describe('toAdminRequest', () => {
  it('marks confirmed and completed requests as selected', () => {
    for (const status of Object.values(RequestStatus)) {
      expect(toAdminRequest(request({ status })).is_selected).toBe(
        status === RequestStatus.CONFIRMED ||
          status === RequestStatus.COMPLETED,
      );
    }
  });

  it('never exposes the pickup confirmation code', () => {
    const view = toAdminRequest(request({ confirmation_code: '1234' }));
    expect(JSON.stringify(view)).not.toContain('1234');
  });
});

/**
 * A query builder that records the SQL it's given. Every chain method returns
 * the builder itself; the terminal ones resolve to what the test supplies.
 */
const recordingQb = (result: { many?: unknown[]; one?: unknown } = {}) => {
  const calls: [string, unknown?][] = [];
  const qb: Record<string, unknown> = {};
  for (const m of ['leftJoinAndSelect', 'select', 'skip', 'take']) {
    qb[m] = () => qb;
  }
  for (const m of ['orderBy', 'addOrderBy']) {
    qb[m] = (column: string, direction?: string) => {
      calls.push([`${m} ${column} ${direction ?? ''}`.trim()]);
      return qb;
    };
  }
  for (const m of ['where', 'andWhere']) {
    qb[m] = (sql: unknown, params?: unknown) => {
      calls.push([typeof sql === 'string' ? sql : 'brackets', params]);
      if (sql instanceof Brackets) calls.push(...bracketSql(sql));
      return qb;
    };
  }
  qb.getManyAndCount = () =>
    Promise.resolve([result.many ?? [], result.many?.length ?? 0]);
  qb.getMany = () => Promise.resolve(result.many ?? []);
  qb.getOne = () => Promise.resolve(result.one ?? null);
  return { qb, calls };
};

/** The conditions inside a Brackets, as `where`/`orWhere` lines. */
const bracketSql = (brackets: Brackets): [string][] => {
  const lines: [string][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['where', 'orWhere', 'andWhere']) {
    builder[m] = (sql: string) => {
      lines.push([`${m} ${sql}`]);
      return builder;
    };
  }
  brackets.whereFactory(builder as never);
  return lines;
};

const setup = (
  opts: {
    rows?: ItemRequestEntity[];
    one?: ItemRequestEntity | null;
    queue?: ItemRequestEntity[];
    ranked?: { id: string; position: string; queue_length: string }[];
    messages?: ReturnType<typeof message>[];
  } = {},
) => {
  const requests = recordingQb({
    many: opts.rows,
    one: opts.one ?? undefined,
  });
  const messages = recordingQb({ many: opts.messages });
  const find = jest.fn().mockResolvedValue(opts.queue ?? []);
  const query = jest.fn().mockResolvedValue(opts.ranked ?? []);
  const dataSource = {
    getRepository: (entity: unknown) =>
      entity === MessageEntity
        ? { createQueryBuilder: () => messages.qb }
        : { createQueryBuilder: () => requests.qb, find },
    query,
  } as unknown as DataSource;
  return {
    service: new AdminRequestsService(dataSource),
    calls: requests.calls,
    messageCalls: messages.calls,
    find,
    query,
  };
};

describe('AdminRequestsService.list', () => {
  it('sorts newest first by default, oldest first when asked', async () => {
    const newest = setup();
    await newest.service.list({});
    expect(newest.calls).toContainEqual(['orderBy r.created_at DESC']);
    expect(newest.calls).toContainEqual(['addOrderBy r.id DESC']);

    const oldest = setup();
    await oldest.service.list({ order: 'ASC' });
    expect(oldest.calls).toContainEqual(['orderBy r.created_at ASC']);
    expect(oldest.calls).toContainEqual(['addOrderBy r.id ASC']);
  });

  it('filters on status, listing, requester and sharer', async () => {
    const { service, calls } = setup();
    await service.list({
      status: RequestStatus.CONFIRMED,
      item_id: 'item-1',
      requester_id: 'u-1',
      owner_id: 'u-2',
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        ['r.status = :status', { status: RequestStatus.CONFIRMED }],
        ['r.item_id = :itemId', { itemId: 'item-1' }],
        ['r.requester_id = :requesterId', { requesterId: 'u-1' }],
        ['r.owner_id = :ownerId', { ownerId: 'u-2' }],
      ]),
    );
  });

  it('adds no filters it was not asked for', async () => {
    const { service, calls } = setup();
    await service.list({});
    const filters = calls.filter(([sql]) => !/^(add)?orderBy /i.test(sql));
    expect(filters).toEqual([]);
  });

  it('searches the listing title and both parties, escaping wildcards', async () => {
    const { service, calls } = setup();
    await service.list({ search: '  50%_off  ' });

    expect(calls).toContainEqual(['brackets', { search: '%50\\%\\_off%' }]);
    expect(calls).toEqual(
      expect.arrayContaining([
        ['where item.title ILIKE :search'],
        [
          "orWhere concat_ws(' ', requester.first_name, requester.last_name) ILIKE :search",
        ],
        ['orWhere requester.email ILIKE :search'],
        [
          "orWhere concat_ws(' ', owner.first_name, owner.last_name) ILIKE :search",
        ],
        ['orWhere owner.email ILIKE :search'],
      ]),
    );
  });

  it('filters on the requested date range, end exclusive', async () => {
    const { service, calls } = setup();
    await service.list({
      created_from: '2026-10-01T00:00:00.000Z',
      created_to: '2026-10-08T00:00:00.000Z',
    });
    expect(calls).toContainEqual([
      'r.created_at >= :from',
      { from: new Date('2026-10-01T00:00:00.000Z') },
    ]);
    expect(calls).toContainEqual([
      'r.created_at < :to',
      { to: new Date('2026-10-08T00:00:00.000Z') },
    ]);
  });

  it("ranks each row within its listing's queue", async () => {
    const rows = [
      request({ id: 'a', item_id: 'item-1' }),
      request({ id: 'b', item_id: 'item-2' }),
      request({ id: 'c', item_id: 'item-1' }),
    ];
    const { service, query } = setup({
      rows,
      ranked: [
        { id: 'a', position: '2', queue_length: '3' },
        { id: 'b', position: '1', queue_length: '1' },
        { id: 'c', position: '1', queue_length: '3' },
      ],
    });

    const result = await service.list({ page: 1, limit: 3 });

    // Each listing is ranked once, and only this page's rows come back.
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ROW_NUMBER()'),
      [
        ['item-1', 'item-2'],
        ['a', 'b', 'c'],
      ],
    );
    expect(result.data.map((r) => [r.id, r.position, r.queue_length])).toEqual([
      ['a', 2, 3],
      ['b', 1, 1],
      ['c', 1, 3],
    ]);
    expect(result.total).toBe(3);
  });

  it('skips the ranking query for an empty page', async () => {
    const { service, query } = setup();
    const result = await service.list({});
    expect(query).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
  });
});

describe('AdminRequestsService.detail', () => {
  it('404s on a missing request', async () => {
    const { service } = setup({ one: null });
    await expect(service.detail('req-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it("returns the listing's queue in order, with this request's place in it", async () => {
    const queue = [
      request({ id: 'first', created_at: at(0) }),
      request({
        id: 'req-1',
        created_at: at(5),
        status: RequestStatus.CONFIRMED,
      }),
      request({ id: 'third', created_at: at(9) }),
    ];
    const { service, find } = setup({
      one: request({ status: RequestStatus.CONFIRMED }),
      queue,
    });

    const { data } = await service.detail('req-1');

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { item_id: 'item-1' },
        order: { created_at: 'ASC', id: 'ASC' },
      }),
    );
    expect([data.position, data.queue_length]).toEqual([2, 3]);
    expect(data.queue.map((q) => [q.id, q.position, q.is_selected])).toEqual([
      ['first', 1, false],
      ['req-1', 2, true],
      ['third', 3, false],
    ]);
  });

  it("reads the history from the pair's one conversation", async () => {
    const { service, messageCalls } = setup({
      one: request(),
      messages: [message(SystemEvent.ITEM_REQUESTED, 'requester', 0)],
    });

    const { data } = await service.detail('req-1');

    const [conversationSql, pair] = messageCalls[0];
    expect(conversationSql).toContain(
      'LEAST(:requesterId::uuid, :ownerId::uuid)',
    );
    expect(conversationSql).toContain(
      'GREATEST(:requesterId::uuid, :ownerId::uuid)',
    );
    expect(pair).toEqual({ requesterId: 'requester', ownerId: 'owner' });
    expect(messageCalls).toContainEqual([
      "m.metadata ->> 'request_id' = :requestId",
      { requestId: 'req-1' },
    ]);
    expect(data.history).toEqual([
      expect.objectContaining({ status: RequestStatus.PENDING, at: at(0) }),
    ]);
  });
});
