import {
  Body,
  Controller,
  Get,
  INestApplication,
  NotFoundException,
  Post,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsUUID } from 'class-validator';
import request from 'supertest';
import { ApiExceptionFilter } from './api-exception.filter';
import { AppError } from '../app-error';

class Dto {
  @IsUUID()
  recipient_id: string;
}

@Controller('t')
class TestController {
  @Post('validate')
  validate(@Body() dto: Dto) {
    return dto;
  }

  @Get('unauthorized')
  unauthorized() {
    throw new UnauthorizedException();
  }

  @Get('app-error')
  appError() {
    throw new AppError(new NotFoundException('Item not found'));
  }

  @Get('crash')
  crash() {
    throw new Error('connection string postgres://secret');
  }
}

describe('ApiExceptionFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TestController],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(() => app.close());

  const get = (path: string) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).get(path);

  it('wraps validation errors, keeping message as an array', async () => {
    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/t/validate')
      .send({ recipient_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      state: false,
      data: null,
      message: ['recipient_id must be a UUID'],
      error: 'Bad Request',
      statusCode: 400,
    });
  });

  it('adds state and error to a guard-style 401', async () => {
    const res = await get('/t/unauthorized');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      state: false,
      data: null,
      message: 'Unauthorized',
      error: 'Unauthorized',
      statusCode: 401,
    });
  });

  it('wraps unknown routes', async () => {
    const res = await get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      state: false,
      error: 'Not Found',
      statusCode: 404,
    });
  });

  it('passes AppError bodies through unchanged', async () => {
    const res = await get('/t/app-error');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      state: false,
      data: null,
      message: 'Item not found',
      error: 'Not Found',
      statusCode: 404,
    });
  });

  it('answers uncaught errors with a generic 500', async () => {
    const res = await get('/t/crash');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      state: false,
      data: null,
      message: 'Internal server error',
      error: 'Internal Server Error',
      statusCode: 500,
    });
  });
});
