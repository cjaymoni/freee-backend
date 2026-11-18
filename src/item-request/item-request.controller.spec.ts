import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ItemRequestController } from './item-request.controller';
import { ItemRequestService } from './item-request.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { configureGlobals } from '../app-setup';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { stubPlatformSettings } from '../platform-settings/testing/stub-platform-settings';

describe('ItemRequestController (HTTP)', () => {
  let app: INestApplication;
  const service = {
    getUserRequests: jest.fn().mockResolvedValue({ state: true, data: [] }),
    getItemRequests: jest.fn().mockResolvedValue({ state: true, data: [] }),
    getPendingPickupConfirmations: jest
      .fn()
      .mockResolvedValue({ state: true, data: [] }),
    markPickedUp: jest.fn().mockResolvedValue({ state: true }),
    confirmPickedUp: jest.fn().mockResolvedValue({ state: true }),
    declinePickedUp: jest.fn().mockResolvedValue({ state: true }),
    confirmPickup: jest.fn(),
    createRequest: jest.fn().mockResolvedValue({ state: true }),
    confirmRequest: jest.fn().mockResolvedValue({ state: true }),
    cancelRequest: jest.fn().mockResolvedValue({ state: true }),
    getRequestById: jest.fn().mockResolvedValue({ state: true }),
  };

  /**
   * The controller with the guard stubbed to sign in as u1. `withGlobals`
   * adds the app's own pipes and filter via configureGlobals, exactly as
   * production runs; without it only the error filter is installed.
   */
  const buildApp = async (withGlobals: boolean) => {
    const module = await Test.createTestingModule({
      controllers: [ItemRequestController],
      providers: [
        { provide: ItemRequestService, useValue: service },
        {
          provide: PlatformSettingsService,
          useValue: stubPlatformSettings(),
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: object }>().user = {
            userId: 'u1',
          };
          return true;
        },
      })
      .compile();
    const built = module.createNestApplication({ logger: false });
    if (withGlobals) {
      configureGlobals(built);
    } else {
      built.useGlobalFilters(new ApiExceptionFilter());
    }
    await built.init();
    return built;
  };

  // Without the global pipes, for the paging cases: see the note on them.
  beforeAll(async () => {
    app = await buildApp(false);
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(() => app.close());

  const get = (path: string) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).get(path);

  it.each([
    ['/item-requests/my-requests?page=0'],
    ['/item-requests/my-requests?page=-1'],
    // Holds only without the global pipes: under them the ValidationPipe
    // turns 'abc' into NaN and DefaultValuePipe swaps in page 1. App-wide
    // and older than this suite; tracked separately.
    ['/item-requests/my-requests?page=abc'],
    ['/item-requests/received?limit=0'],
    ['/item-requests/received?limit=1000'],
  ])('%s answers 400', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(400);
    expect(service.getUserRequests).not.toHaveBeenCalled();
    expect(service.getItemRequests).not.toHaveBeenCalled();
  });

  it('defaults to page 1 of 20', async () => {
    const res = await get('/item-requests/my-requests');
    expect(res.status).toBe(200);
    expect(service.getUserRequests).toHaveBeenCalledWith(
      'u1',
      1,
      20,
      undefined,
    );
  });

  const patch = (path: string) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).patch(path);

  it.each([
    ['/item-requests/r1/picked-up', 'markPickedUp'],
    ['/item-requests/r1/picked-up/confirm', 'confirmPickedUp'],
    ['/item-requests/r1/picked-up/decline', 'declinePickedUp'],
  ] as const)('%s acts as the signed-in user', async (path, method) => {
    const res = await patch(path);
    expect(res.status).toBe(200);
    expect(service[method]).toHaveBeenCalledWith('u1', 'r1');
  });

  it('lists pending pickup confirmations for the signed-in user', async () => {
    const res = await get('/item-requests/pickup-confirmations');
    expect(res.status).toBe(200);
    expect(service.getPendingPickupConfirmations).toHaveBeenCalledWith(
      'u1',
      1,
      20,
    );
  });

  it('rejects bad paging on pending pickup confirmations', async () => {
    const res = await get('/item-requests/pickup-confirmations?limit=0');
    expect(res.status).toBe(400);
    expect(service.getPendingPickupConfirmations).not.toHaveBeenCalled();
  });

  it('no longer serves the code-entry pickup', async () => {
    const res = await patch('/item-requests/r1/pickup').send({
      confirmation_code: 'ABC234',
    });
    expect(res.status).toBe(404);
    expect(service.confirmPickup).not.toHaveBeenCalled();
  });

  describe('acts as the signed-in user', () => {
    // An app with production's globals, so body handling is what clients get.
    let piped: INestApplication;
    const itemId = '123e4567-e89b-12d3-a456-426614174000';

    beforeAll(async () => {
      piped = await buildApp(true);
    });

    afterAll(() => piped.close());

    const server = () =>
      request(piped.getHttpServer() as Parameters<typeof request>[0]);

    it('creating a request', async () => {
      const res = await server()
        .post('/item-requests')
        .send({ item_id: itemId });
      expect(res.status).toBe(201);
      expect(service.createRequest).toHaveBeenCalledWith('u1', {
        item_id: itemId,
      });
    });

    it('refuses an unknown field where a body is read', async () => {
      // The control for the confirm case below: it shows the global
      // whitelist is really installed in this app.
      const res = await server()
        .post('/item-requests')
        .send({ item_id: itemId, extra: 1 });
      expect(res.status).toBe(400);
      expect(service.createRequest).not.toHaveBeenCalled();
    });

    it('confirming a request, ignoring any body', async () => {
      const res = await server().patch('/item-requests/r1/confirm').send({
        status: 'confirmed',
        pickup_notes: 'from an older client',
      });
      expect(res.status).toBe(200);
      expect(service.confirmRequest).toHaveBeenCalledTimes(1);
      expect(service.confirmRequest).toHaveBeenCalledWith('u1', 'r1');
    });

    it('cancelling a request', async () => {
      const res = await server().patch('/item-requests/r1/cancel').send({
        cancellation_reason: 'No longer needed',
      });
      expect(res.status).toBe(200);
      expect(service.cancelRequest).toHaveBeenCalledWith('u1', 'r1', {
        cancellation_reason: 'No longer needed',
      });
    });

    it('listing requests received', async () => {
      const res = await server().get('/item-requests/received');
      expect(res.status).toBe(200);
      expect(service.getItemRequests).toHaveBeenCalledWith(
        'u1',
        1,
        20,
        undefined,
      );
    });

    it('reading one request', async () => {
      const res = await server().get('/item-requests/r1');
      expect(res.status).toBe(200);
      expect(service.getRequestById).toHaveBeenCalledWith('r1', 'u1');
    });
  });
});
