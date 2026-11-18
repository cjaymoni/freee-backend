import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ItemRequestController } from './item-request.controller';
import { ItemRequestService } from './item-request.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { stubPlatformSettings } from '../platform-settings/testing/stub-platform-settings';

describe('ItemRequestController paging', () => {
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
  };

  beforeAll(async () => {
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
    app = module.createNestApplication({ logger: false });
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(() => app.close());

  const get = (path: string) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).get(path);

  it.each([
    ['/item-requests/my-requests?page=0'],
    ['/item-requests/my-requests?page=-1'],
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
});
