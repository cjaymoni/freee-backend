import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiExceptionFilter } from './api-exception.filter';
import { ItemController } from '../../item/item.controller';
import { ItemService } from '../../item/item.service';
import { UserActivityService } from '../../audit/user-activity.service';
import { CategoryController } from '../../category/category.controller';
import { CategoryService } from '../../category/category.service';
import { ItemViewController } from '../../item-view/item-view.controller';
import { ItemViewService } from '../../item-view/item-view.service';
import { AppError } from '../app-error';

/**
 * Malformed ids and enums on public GETs are rejected before they reach
 * Postgres, which would otherwise answer with a 500.
 */
describe('public GETs with malformed input', () => {
  let app: INestApplication;
  const itemService = { findAll: jest.fn(), findOne: jest.fn() };
  const categoryService = { findOne: jest.fn() };
  const itemViewService = { getItemViewStats: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ItemController, CategoryController, ItemViewController],
      providers: [
        { provide: ItemService, useValue: itemService },
        { provide: UserActivityService, useValue: {} },
        { provide: CategoryService, useValue: categoryService },
        { provide: ItemViewService, useValue: itemViewService },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
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

  const get = (path: string) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).get(path);

  it.each([
    ['/items?status=foo'],
    ['/items?category_id=abc'],
    ['/items?user_id=abc'],
    ['/categories/abc'],
    ['/item-views/stats/abc'],
    ['/item-views/stats/11111111-1111-4111-8111-111111111111?days=abc'],
    ['/item-views/stats/11111111-1111-4111-8111-111111111111?days=0'],
  ])('%s answers 400 without querying', async (path) => {
    const res = await get(path);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ state: false, statusCode: 400 });
    expect(itemService.findAll).not.toHaveBeenCalled();
    expect(categoryService.findOne).not.toHaveBeenCalled();
    expect(itemViewService.getItemViewStats).not.toHaveBeenCalled();
  });

  it('still accepts valid filters', async () => {
    itemService.findAll.mockResolvedValue({ state: true, data: [] });
    const res = await get(
      '/items?status=available&category_id=11111111-1111-4111-8111-111111111111',
    );
    expect(res.status).toBe(200);
  });

  it('does not leak the text of an unexpected error', () => {
    const wrapped = new AppError(
      new Error('invalid input syntax for type timestamp: "0NaN-NaN"'),
    );
    expect(wrapped.getResponse()).toMatchObject({
      message: 'Internal server error',
      statusCode: 500,
    });
  });
});
