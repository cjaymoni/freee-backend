import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UserActivityService } from '../audit/user-activity.service';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { RejectNullBytesPipe } from '../common/pipes/reject-null-bytes.pipe';
import { ItemController } from './item.controller';
import { ItemService } from './item.service';

/** GET /items query parsing, over HTTP with the app's global pipes. */
describe('GET /items query parsing', () => {
  let app: INestApplication;
  const findAll = jest.fn().mockResolvedValue({ state: true, data: [] });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ItemController],
      providers: [
        { provide: ItemService, useValue: { findAll } },
        { provide: UserActivityService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new RejectNullBytesPipe(),
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(() => app.close());
  afterEach(() => findAll.mockClear());

  const get = (query: string) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).get(
      `/items?${query}`,
    );
  const filtersSent = () =>
    (findAll.mock.calls as [Record<string, unknown>][])[0][0];

  it.each([
    ['is_free=true', { is_free: true }],
    ['is_free=false', { is_free: false }],
    ['is_featured=true', { is_featured: true }],
    ['lat=0&lng=-0.187&radius=2.5', { lat: 0, lng: -0.187, radius: 2.5 }],
    ['lat=-90&lng=180', { lat: -90, lng: 180, radius: undefined }],
    ['page=2&limit=100', { page: 2, limit: 100 }],
  ])('reads %s', async (query, expected) => {
    const res = await get(query);
    expect(res.status).toBe(200);
    expect(filtersSent()).toMatchObject(expected);
  });

  it.each([
    ['is_free=1', 'is_free must be true or false'],
    ['is_free=TRUE', 'is_free must be true or false'],
    ['is_featured=', 'is_featured must be true or false'],
    ['is_free=true&is_free=true', 'is_free must be true or false'],
    ['lat=abc&lng=1', 'lat must be a number between -90 and 90'],
    ['lat=&lng=', 'lat must be a number between -90 and 90'],
    ['lat=91&lng=1', 'lat must be a number between -90 and 90'],
    ['lat=1&lng=181', 'lng must be a number between -180 and 180'],
    // A repeated key reaches the controller as "1,2", never as an array.
    ['lat=1&lat=2&lng=1', 'lat must be a number between -90 and 90'],
    ['lat=1&lng=1&radius=0', 'radius must be a number of km greater than 0'],
    ['lat=1&lng=1&radius=-5', 'radius must be a number of km greater than 0'],
    ['lat=1&lng=1&radius=far', 'radius must be a number of km greater than 0'],
    ['lat=1', 'lat and lng must be sent together'],
    ['lng=1', 'lat and lng must be sent together'],
    ['page=0', 'page must be a positive integer'],
    ['limit=101', 'limit must be an integer between 1 and 100'],
  ])('refuses %s', async (query, message) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message });
    expect(findAll).not.toHaveBeenCalled();
  });

  it('searches a repeated query key as one literal string', async () => {
    const res = await get('query=a&query=b');
    expect(res.status).toBe(200);
    expect(filtersSent()).toMatchObject({ query: 'a,b' });
  });
});
