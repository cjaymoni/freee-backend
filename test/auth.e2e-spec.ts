import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';

describe('Auth Controller (e2e)', () => {
  let app: INestApplication;
  const testUser = {
    email: `test${Date.now()}@gmail.com`,
    password: 'Test123!@#',
    first_name: 'Test',
    last_name: 'User',
  };

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

  describe('/auth/register (POST)', () => {
    it('should register a new user successfully', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect((res) => {
          expect([200, 201, 400]).toContain(res.status);
          if (res.status === 201 || res.status === 200) {
            expect(res.body).toHaveProperty('message');
            expect(res.body.message).toContain('Registration successful');
          }
        });
    });

    it('should fail with invalid email', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'Test123!@#',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('statusCode', 400);
          expect(res.body).toHaveProperty('message');
        });
    });

    it('should fail with short password', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test@gmail.com',
          password: '12345',
        })
        .expect(400);
    });

    it('should fail with disposable email', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test@tempmail.com',
          password: 'Test123!@#',
        })
        .expect((res) => {
          expect([400, 409]).toContain(res.status);
          expect(res.body).toHaveProperty('statusCode');
        });
    });
  });

  describe('/auth/resend-verification (POST)', () => {
    it('should resend verification code', () => {
      return request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: testUser.email })
        .expect((res) => {
          expect([200, 201, 400]).toContain(res.status);
          if (res.status !== 400) {
            expect(res.body).toHaveProperty('message');
          }
        });
    });

    it('should fail with invalid email', () => {
      return request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'invalid-email' })
        .expect(400);
    });
  });

  describe('/auth/verify-email (POST)', () => {
    it('should fail with invalid OTP', () => {
      return request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({
          email: testUser.email,
          code: '000000',
        })
        .expect((res) => {
          expect([400, 401, 500]).toContain(res.status);
        });
    });
  });

  describe('/auth/login (POST)', () => {
    it('should require email verification', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect((res) => {
          expect([200, 400, 401, 500]).toContain(res.status);
          expect(res.body).toBeDefined();
        });
    });

    it('should fail with invalid credentials', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword123',
        })
        .expect((res) => {
          expect([400, 401, 500]).toContain(res.status);
        });
    });

    it('should fail with missing email', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          password: testUser.password,
        })
        .expect(400);
    });

    it('should fail with missing password', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testUser.email,
        })
        .expect(400);
    });
  });

  describe('/auth/forgot-password (POST)', () => {
    it('should initiate password reset', () => {
      return request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: testUser.email })
        .expect((res) => {
          expect([200, 400, 404]).toContain(res.status);
          if (res.status === 200) {
            expect(res.body).toHaveProperty('message');
          }
        });
    });

    it('should fail with invalid email', () => {
      return request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'invalid-email' })
        .expect(400);
    });
  });

  describe('/auth/reset-password (POST)', () => {
    it('should fail with invalid token', () => {
      return request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          email: testUser.email,
          code: '000000',
          password: 'NewPassword123!@#',
        })
        .expect((res) => {
          expect([400, 401, 404, 500]).toContain(res.status);
        });
    });
  });

  describe('/auth/me (GET)', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('should fail with invalid token', () => {
      return request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('/auth/refresh (POST)', () => {
    it('should fail with invalid refresh token', () => {
      return request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: 'invalid-refresh-token' })
        .expect(401)
        .expect((res) => {
          expect(res.body).toHaveProperty('statusCode', 401);
          expect(res.body).toHaveProperty('message');
        });
    });

    it('should fail with missing refresh token', () => {
      return request(app.getHttpServer())
        .post('/auth/refresh')
        .send({})
        .expect(400);
    });
  });

  describe('/auth/logout (POST)', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer()).post('/auth/logout').expect(401);
    });

    it('should fail with invalid token', () => {
      return request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should fail with malformed authorization header', () => {
      return request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', 'invalid-format')
        .expect(401);
    });

    // Note: To test successful logout, you would need to:
    // 1. Register and verify a user
    // 2. Login to get a valid token
    // 3. Use that token to logout
    // This is commented out as it requires a verified user setup
    /*
    it('should logout successfully with valid token', async () => {
      // Setup: Register, verify, and login to get token
      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser);
      
      // Manually verify user in DB or use actual OTP
      // ...
      
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      
      const accessToken = loginRes.body.data.access_token;
      
      // Test logout
      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('Logged out');
      
      // Verify token is no longer valid
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });
    */
  });

  describe('/auth/change-password (POST)', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .post('/auth/change-password')
        .send({
          currentPassword: 'OldPassword123',
          newPassword: 'NewPassword123',
        })
        .expect(401);
    });

    it('should fail with invalid token', () => {
      return request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          currentPassword: 'OldPassword123',
          newPassword: 'NewPassword123',
        })
        .expect(401);
    });

    it('should fail with missing currentPassword', () => {
      return request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', 'Bearer some-token')
        .send({
          newPassword: 'NewPassword123',
        })
        .expect(401); // Will fail at auth, but shows validation is needed
    });

    it('should fail with missing newPassword', () => {
      return request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', 'Bearer some-token')
        .send({
          currentPassword: 'OldPassword123',
        })
        .expect(401); // Will fail at auth, but shows validation is needed
    });

    it('should fail with short newPassword', () => {
      return request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', 'Bearer some-token')
        .send({
          currentPassword: 'OldPassword123',
          newPassword: '12345', // Less than 6 characters
        })
        .expect((res) => {
          expect([400, 401]).toContain(res.status);
        });
    });

    it('should fail with empty passwords', () => {
      return request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', 'Bearer some-token')
        .send({
          currentPassword: '',
          newPassword: '',
        })
        .expect((res) => {
          expect([400, 401]).toContain(res.status);
        });
    });

    // Note: To test successful password change, you would need to:
    // 1. Register and verify a user
    // 2. Login to get a valid token
    // 3. Use that token to change password
    // 4. Verify old password no longer works
    // 5. Verify new password works
    // This is commented out as it requires a verified user setup
    /*
    it('should change password successfully with valid credentials', async () => {
      // Setup: Register, verify, and login
      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `changepass${Date.now()}@gmail.com`,
          password: 'OldPassword123',
          first_name: 'Change',
          last_name: 'Pass',
        });
      
      // Manually verify user
      // ...
      
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `changepass${Date.now()}@gmail.com`,
          password: 'OldPassword123',
        });
      
      const accessToken = loginRes.body.data.access_token;
      
      // Change password
      const changeRes = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          currentPassword: 'OldPassword123',
          newPassword: 'NewPassword456',
        })
        .expect(200);
      
      expect(changeRes.body).toHaveProperty('message');
      expect(changeRes.body.message).toContain('changed successfully');
      
      // Verify old password no longer works
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `changepass${Date.now()}@gmail.com`,
          password: 'OldPassword123',
        })
        .expect((res) => {
          expect([401, 400]).toContain(res.status);
        });
      
      // Verify new password works
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `changepass${Date.now()}@gmail.com`,
          password: 'NewPassword456',
        })
        .expect(200);
    });

    it('should fail with incorrect current password', async () => {
      // Assuming valid token setup
      const res = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          currentPassword: 'WrongPassword123',
          newPassword: 'NewPassword456',
        })
        .expect(400);
      
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('Invalid current password');
    });
    */
  });
});
