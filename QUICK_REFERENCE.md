# Quick Reference Guide - Production Improvements

## 🚀 Quick Start

### 1. Update Environment Variables
```bash
cp .env.example .env
# Edit .env with your values
```

### 2. Install Dependencies (if needed)
```bash
npm install
```

### 3. Run Migrations
```bash
npm run migration:run
```

### 4. Start Development Server
```bash
npm run start:dev
```

---

## 📋 New Features Checklist

### ✅ Implemented Features

- [x] Transaction error handling fixed
- [x] Pagination system
- [x] Account lockout (5 attempts, 30 min lockout)
- [x] Secrets management service
- [x] Database connection pooling
- [x] Production logging
- [x] Enhanced health checks
- [x] Load testing framework

---

## 🔧 Configuration

### Required Environment Variables

```env
# Security
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=30
PASSWORD_MIN_LENGTH=8

# Database Pooling
DB_POOL_MAX=20
DB_POOL_MIN=2

# Logging
LOG_LEVEL=info
```

---

## 🧪 Testing

### Run All Tests
```bash
npm run test              # Unit tests
npm run test:e2e          # E2E tests
npm run test:load         # Load tests
npm run test:cov          # Coverage report
```

### Quick Load Test
```bash
npm run test:load:quick
```

### Full Load Test with Report
```bash
npm run test:load:report
```

---

## 📊 Monitoring

### Health Check Endpoints
```bash
curl http://localhost:3000/health       # Full health check
curl http://localhost:3000/health/db    # Database only
curl http://localhost:3000/health/ready # Readiness probe
curl http://localhost:3000/health/live  # Liveness probe
```

---

## 🔐 Security Features

### Account Lockout
- Automatic lockout after 5 failed attempts
- 30-minute lockout duration
- Auto-unlock after period expires

### Test Account Lockout
```bash
# Try 6 failed logins to trigger lockout
for i in {1..6}; do
  curl -X POST http://localhost:3000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}'
done
```

---

## 📄 Pagination

### Usage in Controllers
```typescript
import { PaginationDto, PaginatedResponseDto } from '../common/pagination.dto';

@Get()
async findAll(@Query() pagination: PaginationDto) {
  const [items, total] = await this.repository.findAndCount({
    skip: (pagination.page - 1) * pagination.limit,
    take: pagination.limit,
  });
  return new PaginatedResponseDto(items, total, pagination.page, pagination.limit);
}
```

### API Request
```bash
curl "http://localhost:3000/items?page=1&limit=20&sortBy=created_at&order=DESC"
```

---

## 📝 Logging

### Usage in Services
```typescript
import { AppLogger } from '../common/logger.service';

export class MyService {
  private readonly logger: AppLogger;

  constructor(private readonly appLogger: AppLogger) {
    this.logger = appLogger;
    this.logger.setContext('MyService');
  }

  doSomething() {
    this.logger.log('Operation started');
    this.logger.error('Error occurred', error.stack);
  }
}
```

---

## 🗄️ Database

### Connection Pool Monitoring
```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity WHERE datname = 'freee';

-- View connection details
SELECT * FROM pg_stat_activity;
```

### Migration Commands
```bash
npm run migration:generate  # Generate migration
npm run migration:run       # Run migrations
npm run migration:revert    # Revert last migration
npm run migration:show      # Show migration status
```

---

## 🔒 Secrets Management

### Usage
```typescript
constructor(private readonly secretsService: SecretsService) {}

async init() {
  const jwtSecret = await this.secretsService.getJwtSecret();
  const dbCreds = await this.secretsService.getDatabaseCredentials();
}
```

---

## 📈 Performance

### Database Pool Settings

**Development:**
```env
DB_POOL_MAX=10
DB_POOL_MIN=2
```

**Production:**
```env
DB_POOL_MAX=50
DB_POOL_MIN=10
```

### Load Test Thresholds
- Max error rate: 1%
- P95 response time: < 500ms
- P99 response time: < 1000ms

---

## 🚨 Troubleshooting

### High Database Connections
```sql
-- Kill idle connections
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' 
  AND state_change < NOW() - INTERVAL '5 minutes';
```

### Check Locked Accounts
```sql
SELECT id, email, failed_login_attempts, account_locked_until 
FROM users 
WHERE account_locked_until > NOW();
```

### View Recent Login Attempts
```sql
SELECT * FROM login_attempts 
ORDER BY created_at DESC 
LIMIT 20;
```

---

## 📚 Documentation

- [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) - Full implementation guide
- [MISSING_FEATURES.md](./MISSING_FEATURES.md) - Feature roadmap
- [NEW_FEATURES_README.md](./NEW_FEATURES_README.md) - Recent features
- [TEST_RESULTS.md](./TEST_RESULTS.md) - Test coverage

---

## 🎯 Next Steps

### Immediate
1. Update `.env` with production values
2. Run load tests: `npm run test:load`
3. Verify health checks work
4. Test account lockout

### Short-term
1. Set up AWS Secrets Manager
2. Configure log aggregation (CloudWatch/Datadog)
3. Set up monitoring alerts
4. Implement 2FA

### Long-term
1. Add more comprehensive metrics
2. Implement API versioning
3. Add rate limiting per user
4. Set up CI/CD pipeline

---

## 💡 Tips

### Development
- Use `LOG_LEVEL=debug` for detailed logs
- Keep `DB_POOL_MAX=10` to save resources
- Use local Redis for caching

### Production
- Set `LOG_LEVEL=warn` or `error`
- Increase `DB_POOL_MAX` based on load
- Use Upstash Redis or AWS ElastiCache
- Enable all monitoring

---

## 🆘 Support

### Common Commands
```bash
# Check app status
pm2 status

# View logs
pm2 logs

# Restart app
pm2 restart all

# Monitor resources
pm2 monit
```

### Health Check
```bash
# Quick health check
curl http://localhost:3000/health | jq
```

---

## 📞 Contact

For issues or questions:
1. Check [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md)
2. Review error logs
3. Check health endpoints
4. Verify environment variables

---

**Last Updated:** January 2025
**Version:** 1.0.0
