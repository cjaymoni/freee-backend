import { join } from 'path';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ItemRequestService } from './item-request.service';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';
import {
  ItemCondition,
  ItemEntity,
  ItemStatus,
} from '../item/entities/item.entity';
import { ItemImageEntity } from '../item/entities/item-image.entity';
import { UserEntity } from '../user/entities/user.entity';
import { ChatService } from '../chat/chat.service';
import { UserService } from '../user/user.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { FirebaseService } from '../firebase/firebase.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { QueryRunner } from 'typeorm';
import { ChatRealtimeService } from '../chat/chat-realtime.service';
import { NotificationService } from '../notification/notification.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { stubPlatformSettings } from '../platform-settings/testing/stub-platform-settings';
import {
  describeWithDatabase,
  testDatabaseFor,
} from '../common/testing/test-database';

/**
 * The pickup reminder claim and the pending-confirmations list against a
 * real Postgres: the UPDATE ... FROM over a SKIP LOCKED subquery, the UTC
 * interval maths and paging over the images join can only be proven on
 * actual rows. See common/testing/test-database for how to run it.
 */
const REMINDER_MINUTES = 60;

/** How long a test waits for a blocked statement to show up as blocked. */
const LOCK_WAIT_TIMEOUT_MS = 5000;

describeWithDatabase(
  'ItemRequestService pickup confirmations on Postgres',
  () => {
    let ds: DataSource;
    let service: ItemRequestService;
    let users: UserService;
    const notify = jest.fn().mockResolvedValue(undefined);
    const realtime = {
      emitToUser: jest.fn(),
      emitToUsers: jest.fn(),
      foregroundSessions: jest.fn().mockReturnValue([]),
    };
    let owner: UserEntity;
    let finder: UserEntity;
    let items: ItemEntity[];

    beforeAll(async () => {
      ds = await new DataSource({
        type: 'postgres',
        url: await testDatabaseFor('item_requests'),
        entities: [join(__dirname, '..', '**', '*.entity.ts')],
        synchronize: true,
        dropSchema: true,
        logging: false,
      }).initialize();

      const module = await Test.createTestingModule({
        providers: [
          ItemRequestService,
          { provide: DataSource, useValue: ds },
          ...[ItemRequestEntity, ItemEntity].map((entity) => ({
            provide: getRepositoryToken(entity),
            useValue: ds.getRepository(entity),
          })),
          {
            provide: PlatformSettingsService,
            useValue: stubPlatformSettings({
              'requests.pickup_reminder_minutes': REMINDER_MINUTES,
            }),
          },
          {
            provide: ChatService,
            useValue: { createSystemMessage: jest.fn() },
          },
          { provide: ChatRealtimeService, useValue: realtime },
          { provide: NotificationService, useValue: { notify } },
          UserService,
          {
            provide: getRepositoryToken(UserEntity),
            useValue: ds.getRepository(UserEntity),
          },
          {
            provide: CloudinaryService,
            useValue: { deleteImagesQuietly: jest.fn() },
          },
          { provide: CACHE_MANAGER, useValue: { del: jest.fn() } },
          { provide: FirebaseService, useValue: {} },
        ],
      }).compile();
      service = module.get(ItemRequestService);
      users = module.get(UserService);

      [owner, finder] = await ds.getRepository(UserEntity).save([
        { email: 'owner@example.com', first_name: 'Ama' },
        { email: 'finder@example.com', first_name: 'Kofi' },
      ]);

      const itemRepo = ds.getRepository(ItemEntity);
      items = await itemRepo.save(
        Array.from({ length: 6 }, (_, i) =>
          itemRepo.create({
            title: `Item ${i}`,
            condition: ItemCondition.GOOD,
            user_id: owner.id,
            status: ItemStatus.RESERVED,
          } as Partial<ItemEntity>),
        ),
      );
      // Several images per item, so a page that counted joined rows instead of
      // requests would come back short.
      await ds.getRepository(ItemImageEntity).save(
        items.flatMap((item) =>
          [0, 1, 2].map((order) => ({
            item_id: item.id,
            cloudinary_public_id: `items/${item.id}-${order}`,
            cloudinary_url: `https://example.com/${item.id}-${order}.jpg`,
            cloudinary_secure_url: `https://example.com/${item.id}-${order}.jpg`,
            display_order: order,
            is_primary: order === 0,
          })),
        ),
      );
    });

    afterAll(async () => {
      await ds?.destroy();
    });

    beforeEach(async () => {
      jest.clearAllMocks();
      await ds.query('DELETE FROM item_requests');
    });

    /**
     * A request on items[index]. Times are minutes before the database's own
     * UTC clock, which is what the reminder job measures against.
     */
    const seed = async (
      index: number,
      options: {
        status?: RequestStatus;
        markedBy?: 'owner' | 'finder' | null;
        markedMinutesAgo?: number;
        remindedMinutesAgo?: number | null;
      } = {},
    ): Promise<string> => {
      const {
        status = RequestStatus.CONFIRMED,
        markedBy = 'finder',
        markedMinutesAgo = REMINDER_MINUTES + 5,
        remindedMinutesAgo = null,
      } = options;
      const request = await ds.getRepository(ItemRequestEntity).save({
        item_id: items[index].id,
        requester_id: finder.id,
        owner_id: owner.id,
        status,
      });
      if (markedBy) {
        await ds.query(
          `UPDATE item_requests
            SET pickup_marked_by = $1,
                pickup_marked_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - make_interval(mins => $2),
                pickup_reminded_at = CASE WHEN $3::int IS NULL THEN NULL
                  ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - make_interval(mins => $3::int) END
          WHERE id = $4`,
          [
            markedBy === 'owner' ? owner.id : finder.id,
            markedMinutesAgo,
            remindedMinutesAgo,
            request.id,
          ],
        );
      }
      return request.id;
    };

    const remindedAt = async (id: string): Promise<Date | null> => {
      const [row] = await ds.query<{ pickup_reminded_at: Date | null }[]>(
        'SELECT pickup_reminded_at FROM item_requests WHERE id = $1',
        [id],
      );
      return row.pickup_reminded_at;
    };

    /**
     * Resolves once some other connection to this test's database is waiting
     * on a row lock, so a test can be sure the call it started is blocked
     * before it lets go. Fails loudly rather than letting the test pass
     * without the wait it depends on.
     */
    const untilSomethingWaitsOnALock = async (): Promise<void> => {
      const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const [{ waiting }] = await ds.query<{ waiting: number }[]>(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (waiting > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Nothing started waiting on a lock');
    };

    /** Runs `work` in a transaction of its own, always giving it back. */
    const withOpenTransaction = async (
      work: (tx: QueryRunner) => Promise<void>,
    ): Promise<void> => {
      const tx = ds.createQueryRunner();
      await tx.connect();
      await tx.startTransaction();
      try {
        await work(tx);
        await tx.commitTransaction();
      } catch (error) {
        await tx.rollbackTransaction();
        throw error;
      } finally {
        await tx.release();
      }
    };

    describe('sendPickupConfirmationReminders', () => {
      it('claims a confirmation marked longer ago than the interval and stamps it', async () => {
        const id = await seed(0);

        const sent = await service.sendPickupConfirmationReminders();

        expect(sent).toBe(1);
        expect(await remindedAt(id)).not.toBeNull();
        expect(notify).toHaveBeenCalledWith(
          owner.id,
          expect.objectContaining({
            data: expect.objectContaining({ request_id: id }) as unknown,
            body: 'Confirm whether "Item 0" has been picked up.',
          }),
          { skipDevicesOf: [] },
        );
      });

      it('reminds whichever party did not mark it', async () => {
        await seed(0, { markedBy: 'owner' });

        await service.sendPickupConfirmationReminders();

        expect(notify).toHaveBeenCalledWith(
          finder.id,
          expect.anything(),
          expect.anything(),
        );
      });

      it('waits a full interval after a mark or the last reminder', async () => {
        await seed(0, { markedMinutesAgo: REMINDER_MINUTES - 5 });
        await seed(1, {
          markedMinutesAgo: REMINDER_MINUTES * 3,
          remindedMinutesAgo: REMINDER_MINUTES - 5,
        });
        const due = await seed(2, {
          markedMinutesAgo: REMINDER_MINUTES * 3,
          remindedMinutesAgo: REMINDER_MINUTES + 5,
        });

        const sent = await service.sendPickupConfirmationReminders();

        expect(sent).toBe(1);
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            data: expect.objectContaining({ request_id: due }) as unknown,
          }),
          expect.anything(),
        );
      });

      it('never claims completed, cancelled or unmarked requests', async () => {
        await seed(0, { status: RequestStatus.COMPLETED });
        await seed(1, { status: RequestStatus.CANCELLED });
        await seed(2, { markedBy: null });

        const sent = await service.sendPickupConfirmationReminders();

        expect(sent).toBe(0);
        expect(notify).not.toHaveBeenCalled();
      });

      it('does not claim the same row twice when two runs overlap', async () => {
        const ids = await Promise.all([0, 1, 2, 3, 4].map((i) => seed(i)));

        const [first, second] = await Promise.all([
          service.sendPickupConfirmationReminders(),
          service.sendPickupConfirmationReminders(),
        ]);

        expect(first + second).toBe(ids.length);
        const reminded = notify.mock.calls.map(
          ([, notice]) =>
            (notice as { data: { request_id: string } }).data.request_id,
        );
        expect(new Set(reminded).size).toBe(ids.length);
        expect([...reminded].sort()).toEqual([...ids].sort());
      });
    });

    describe('getPendingPickupConfirmations', () => {
      it('pages by request over the images join, oldest mark first', async () => {
        const oldest = await seed(0, { markedMinutesAgo: 30 });
        const middle = await seed(1, { markedMinutesAgo: 20 });
        const newest = await seed(2, { markedMinutesAgo: 10 });

        const first = await service.getPendingPickupConfirmations(
          owner.id,
          1,
          2,
        );
        const second = await service.getPendingPickupConfirmations(
          owner.id,
          2,
          2,
        );

        expect(first.total).toBe(3);
        expect(first.data.map((request) => request.id)).toEqual([
          oldest,
          middle,
        ]);
        expect(second.data.map((request) => request.id)).toEqual([newest]);
        expect(first.data[0].awaiting_pickup_confirmation).toBe(true);
        expect(first.data[0].item?.images).toHaveLength(3);
      });

      it('leaves out what the viewer marked and requests no longer confirmed', async () => {
        await seed(0, { markedBy: 'owner' });
        await seed(1, { status: RequestStatus.COMPLETED });
        await seed(2, { markedBy: null });
        const waiting = await seed(3);

        const forOwner = await service.getPendingPickupConfirmations(owner.id);
        const forFinder = await service.getPendingPickupConfirmations(
          finder.id,
        );

        expect(forOwner.data.map((request) => request.id)).toEqual([waiting]);
        expect(forFinder.data).toHaveLength(1);
        expect(forFinder.data[0].pickup_marked_by).toBe(owner.id);
      });
    });

    describe('marking', () => {
      it('refuses a mark with no time at the database', async () => {
        const id = await seed(0, { markedBy: null });

        await expect(
          ds.query(
            'UPDATE item_requests SET pickup_marked_by = $1 WHERE id = $2',
            [finder.id, id],
          ),
        ).rejects.toThrow(/CHK_item_requests_pickup_mark_has_time/);
      });

      it('does not push on a re-tap while the reminder job is claiming the row', async () => {
        const id = await seed(0, { markedBy: 'finder' });
        let tap: Promise<unknown> | undefined;

        // The job's claim, held open: it has stamped the row but not yet
        // committed, as when it is mid-run.
        await withOpenTransaction(async (job) => {
          await job.query(
            `UPDATE item_requests SET pickup_reminded_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE id = $1`,
            [id],
          );
          // Settled at once, so a rejection while we wait isn't unhandled.
          tap = service.markPickedUp(finder.id, id).then(
            () => undefined,
            (error: unknown) => error,
          );
          await untilSomethingWaitsOnALock();
        });
        expect(await tap).toBeUndefined();

        // The job sends that reminder; the tap must see its stamp and stay quiet.
        expect(notify).not.toHaveBeenCalled();
      });

      it('leaves a row a transition holds for the next run of the job', async () => {
        const id = await seed(0, { markedBy: 'finder' });

        await withOpenTransaction(async (transition) => {
          await transition.query(
            'SELECT id FROM item_requests WHERE id = $1 FOR UPDATE',
            [id],
          );

          await expect(service.sendPickupConfirmationReminders()).resolves.toBe(
            0,
          );
        });

        expect(await remindedAt(id)).toBeNull();
        expect(notify).not.toHaveBeenCalled();
      });
    });

    describe('deleting an account while a request is being settled', () => {
      const requestFromLeavingUser = async (email: string, title: string) => {
        const [leaving] = await ds
          .getRepository(UserEntity)
          .save([{ email, first_name: 'Esi' }]);
        const itemRepo = ds.getRepository(ItemEntity);
        const item = await itemRepo.save(
          itemRepo.create({
            title,
            condition: ItemCondition.GOOD,
            user_id: owner.id,
            status: ItemStatus.RESERVED,
          } as Partial<ItemEntity>),
        );
        const request = await ds.getRepository(ItemRequestEntity).save({
          item_id: item.id,
          requester_id: leaving.id,
          owner_id: owner.id,
          status: RequestStatus.CONFIRMED,
        });
        return { leaving, item, request };
      };

      const statusOf = async (id: string): Promise<RequestStatus> => {
        const [row] = await ds.query<{ status: RequestStatus }[]>(
          'SELECT status FROM item_requests WHERE id = $1',
          [id],
        );
        return row.status;
      };

      it('waits its turn instead of deadlocking, and cancels the request', async () => {
        const { leaving, item, request } = await requestFromLeavingUser(
          'leaving@example.com',
          'Lamp',
        );
        let removal: Promise<unknown> | undefined;

        // A transition by the owner: it holds the item and, once the account
        // deletion is queued, takes the request row. Were the deletion to
        // lock the request before the item, the two would deadlock.
        await withOpenTransaction(async (transition) => {
          await transition.query(
            'SELECT id FROM items WHERE id = $1 FOR UPDATE',
            [item.id],
          );
          removal = users.remove(leaving.id, leaving.id).then(
            () => undefined,
            (error: unknown) => error,
          );
          await untilSomethingWaitsOnALock();
          await transition.query(
            'SELECT id FROM item_requests WHERE id = $1 FOR UPDATE',
            [request.id],
          );
        });

        expect(await removal).toBeUndefined();
        expect(await statusOf(request.id)).toBe(RequestStatus.CANCELLED);
      });

      it('does not cancel a request completed while it waited', async () => {
        const { leaving, item, request } = await requestFromLeavingUser(
          'gone@example.com',
          'Desk',
        );
        let removal: Promise<unknown> | undefined;

        // The pickup completes while the account deletion waits on the item.
        await withOpenTransaction(async (pickup) => {
          await pickup.query('SELECT id FROM items WHERE id = $1 FOR UPDATE', [
            item.id,
          ]);
          removal = users.remove(leaving.id, leaving.id).then(
            () => undefined,
            (error: unknown) => error,
          );
          await untilSomethingWaitsOnALock();
          await pickup.query(
            `UPDATE item_requests SET status = 'completed', is_picked_up = true WHERE id = $1`,
            [request.id],
          );
          await pickup.query(
            `UPDATE items SET status = 'picked_up' WHERE id = $1`,
            [item.id],
          );
        });

        expect(await removal).toBeUndefined();
        expect(await statusOf(request.id)).toBe(RequestStatus.COMPLETED);
      });
    });
  },
);
