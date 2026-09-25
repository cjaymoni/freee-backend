import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UserPreferenceController } from './user-preference.controller';
import { UserPreferenceService } from './user-preference.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';

describe('UserPreferenceController body validation', () => {
  let app: INestApplication;
  const service = {
    setPreferredCategories: jest.fn().mockResolvedValue({ state: true }),
    updateLanguage: jest.fn().mockResolvedValue({ state: true }),
    updateTheme: jest.fn().mockResolvedValue({ state: true }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UserPreferenceController],
      providers: [{ provide: UserPreferenceService, useValue: service }],
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

  afterEach(() => jest.clearAllMocks());
  afterAll(() => app.close());

  const patch = (path: string, body: object) =>
    request(app.getHttpServer() as Parameters<typeof request>[0])
      .patch(`/user/preferences/${path}`)
      .send(body);

  it.each([
    ['categories', {}],
    ['categories', { category_ids: ['abc'] }],
    ['categories', { category_ids: 'not-an-array' }],
    ['language', {}],
    ['language', { language: 'x'.repeat(11) }],
    ['theme', { theme: 'neon' }],
  ])('PATCH %s with %j answers 400', async (path, body) => {
    const res = await patch(path, body);
    expect(res.status).toBe(400);
    expect(service.setPreferredCategories).not.toHaveBeenCalled();
    expect(service.updateLanguage).not.toHaveBeenCalled();
    expect(service.updateTheme).not.toHaveBeenCalled();
  });

  it('passes valid values through', async () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    await patch('categories', { category_ids: [id] }).expect(200);
    await patch('language', { language: 'fr' }).expect(200);
    await patch('theme', { theme: 'dark' }).expect(200);
    expect(service.setPreferredCategories).toHaveBeenCalledWith('u1', [id]);
    expect(service.updateLanguage).toHaveBeenCalledWith('u1', 'fr');
    expect(service.updateTheme).toHaveBeenCalledWith('u1', 'dark');
  });
});
