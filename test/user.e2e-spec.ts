import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';

describe('User Controller (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    // Note: To properly test user endpoints, you need a valid access token
    // You would need to either:
    // 1. Create and verify a user through the auth flow
    // 2. Or use a test database with a pre-existing verified user
    // For now, these tests will check authentication requirements
  });

  afterAll(async () => {
    try {
      // Close database connections
      const dataSource = app.get(DataSource);
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    } catch {
      // Silently catch errors if already closed
    }

    // Close the application and wait for all connections to close
    if (app) {
      await app.close();
    }
  });

  describe('Authentication Requirements', () => {
    it('GET /user should require authentication', () => {
      return request(app.getHttpServer()).get('/user').expect(401);
    });

    it('GET /user/:id should require authentication', () => {
      return request(app.getHttpServer())
        .get('/user/123e4567-e89b-12d3-a456-426614174000')
        .expect(401);
    });

    it('POST /user should require authentication', () => {
      return request(app.getHttpServer())
        .post('/user')
        .send({
          email: 'newuser@example.com',
          password: 'Test123!@#',
          first_name: 'New',
          last_name: 'User',
        })
        .expect(401);
    });

    it('PATCH /user/:id should require authentication', () => {
      return request(app.getHttpServer())
        .patch('/user/123e4567-e89b-12d3-a456-426614174000')
        .send({
          first_name: 'Updated',
        })
        .expect(401);
    });

    it('DELETE /user/:id should require authentication', () => {
      return request(app.getHttpServer())
        .delete('/user/123e4567-e89b-12d3-a456-426614174000')
        .expect(401);
    });
  });

  describe('With Invalid Token', () => {
    const invalidToken = 'Bearer invalid-token-here';

    it('GET /user should reject invalid token', () => {
      return request(app.getHttpServer())
        .get('/user')
        .set('Authorization', invalidToken)
        .expect(401);
    });

    it('GET /user/:id should reject invalid token', () => {
      return request(app.getHttpServer())
        .get('/user/123e4567-e89b-12d3-a456-426614174000')
        .set('Authorization', invalidToken)
        .expect(401);
    });

    it('POST /user should reject invalid token', () => {
      return request(app.getHttpServer())
        .post('/user')
        .set('Authorization', invalidToken)
        .send({
          email: 'newuser@example.com',
          password: 'Test123!@#',
          first_name: 'New',
          last_name: 'User',
        })
        .expect(401);
    });

    it('PATCH /user/:id should reject invalid token', () => {
      return request(app.getHttpServer())
        .patch('/user/123e4567-e89b-12d3-a456-426614174000')
        .set('Authorization', invalidToken)
        .send({
          first_name: 'Updated',
        })
        .expect(401);
    });

    it('DELETE /user/:id should reject invalid token', () => {
      return request(app.getHttpServer())
        .delete('/user/123e4567-e89b-12d3-a456-426614174000')
        .set('Authorization', invalidToken)
        .expect(401);
    });
  });

  // Note: To test the actual functionality of these endpoints,
  // you would need to set up a test user and get a valid token
  describe('With Valid Token (Manual Setup Required)', () => {
    // These tests are commented out because they require a valid token
    // To use them, you need to:
    // 1. Register a user
    // 2. Verify the user's email (manually set in database or use actual OTP)
    // 3. Login to get an access token
    // 4. Set the accessToken variable
    /*
    beforeAll(async () => {
      // TODO: Implement user creation and login flow
      // const registerRes = await request(app.getHttpServer())
      //   .post('/auth/register')
      //   .send({ email: 'test@example.com', password: 'Test123!@#' });
      // 
      // // Manually verify user or set verified in database
      // 
      // const loginRes = await request(app.getHttpServer())
      //   .post('/auth/login')
      //   .send({ email: 'test@example.com', password: 'Test123!@#' });
      // 
      // accessToken = loginRes.body.data.access_token;
    });

    it('GET /user should return all users', async () => {
      const res = await request(app.getHttpServer())
        .get('/user')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('POST /user should create a new user', async () => {
      const newUser = {
        email: `newuser${Date.now()}@example.com`,
        password: 'Test123!@#',
        first_name: 'New',
        last_name: 'User',
      };

      const res = await request(app.getHttpServer())
        .post('/user')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(newUser)
        .expect(201);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id');
      createdUserId = res.body.data.id;
    });

    it('GET /user/:id should return a specific user', async () => {
      const res = await request(app.getHttpServer())
        .get(`/user/${createdUserId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id', createdUserId);
    });

    it('PATCH /user/:id should update a user', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/user/${createdUserId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ first_name: 'Updated' })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('first_name', 'Updated');
    });

    it('DELETE /user/:id should delete a user', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/user/${createdUserId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
    });
    */
  });
});
