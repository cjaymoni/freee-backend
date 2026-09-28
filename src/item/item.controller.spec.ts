import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureGlobals } from '../app-setup';
import { UserActivityService } from '../audit/user-activity.service';
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
    configureGlobals(app);
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
    ['is_free=true&is_free=true', 'is_free must be sent only once'],
    ['lat=abc&lng=1', 'lat must be a number between -90 and 90'],
    ['lat=&lng=', 'lat must be a number between -90 and 90'],
    ['lat=91&lng=1', 'lat must be a number between -90 and 90'],
    ['lat=1&lng=181', 'lng must be a number between -180 and 180'],
    ['lat=1&lat=2&lng=1', 'lat must be sent only once'],
    ['query=a&query=b', 'query must be sent only once'],
    ['page=1&page=2', 'page must be sent only once'],
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
});
