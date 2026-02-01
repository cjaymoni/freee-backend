# Production Deployment Checklist

## Pre-Deployment Tasks

### 1. Environment Configuration
- [ ] Copy `.env.example` to `.env`
- [ ] Update all environment variables with production values
- [ ] Set `NODE_ENV=production`
- [ ] Set `LOG_LEVEL=warn` or `error`
- [ ] Configure database connection pooling
  - [ ] `DB_POOL_MAX=50`
  - [ ] `DB_POOL_MIN=10`
- [ ] Configure security settings
  - [ ] `MAX_LOGIN_ATTEMPTS=5`
  - [ ] `LOCKOUT_DURATION_MINUTES=30`
  - [ ] `PASSWORD_MIN_LENGTH=8`

### 2. Secrets Management
- [ ] **CRITICAL:** Remove `.env` from repository if committed
- [ ] Rotate all exposed credentials:
  - [ ] JWT_SECRET
  - [ ] Database password
  - [ ] Cloudinary API credentials
  - [ ] SMTP password
  - [ ] Firebase service account
- [ ] Set up AWS Secrets Manager (recommended)
- [ ] Update `secrets.service.ts` to use AWS Secrets Manager
- [ ] Test secret retrieval

### 3. Database Setup
- [ ] Create production database
- [ ] Configure connection pooling
- [ ] Run migrations: `npm run migration:run`
- [ ] Verify migrations: `npm run migration:show`
- [ ] Set up database backups
- [ ] Configure read replicas (if needed)

### 4. Testing
- [ ] Run unit tests: `npm run test`
- [ ] Run e2e tests: `npm run test:e2e`
- [ ] Run load tests: `npm run test:load`
- [ ] Verify all tests pass
- [ ] Check test coverage: `npm run test:cov`

### 5. Security Audit
- [ ] Verify account lockout works
- [ ] Test failed login attempts (should lock after 5)
- [ ] Verify JWT expiration (15 minutes)
- [ ] Check CORS configuration
- [ ] Verify rate limiting works
- [ ] Test password complexity requirements
- [ ] Review exposed endpoints

### 6. Performance Optimization
- [ ] Enable database connection pooling
- [ ] Configure Redis caching
- [ ] Test pagination on all list endpoints
- [ ] Verify response times < 500ms (P95)
- [ ] Check memory usage under load
- [ ] Monitor database query performance

### 7. Monitoring & Logging
- [ ] Set up CloudWatch Logs (or alternative)
- [ ] Configure log aggregation
- [ ] Set up error tracking (Sentry/Rollbar)
- [ ] Configure health check monitoring
- [ ] Set up uptime monitoring
- [ ] Create monitoring dashboard

### 8. Infrastructure
- [ ] Set up load balancer
- [ ] Configure auto-scaling
- [ ] Set up CDN (if needed)
- [ ] Configure SSL/TLS certificates
- [ ] Set up firewall rules
- [ ] Configure backup strategy

---

## Deployment Steps

### 1. Build Application
```bash
npm run build
```

### 2. Run Migrations
```bash
npm run migration:run
```

### 3. Start Application
```bash
npm run start:prod
```

### 4. Verify Health
```bash
curl https://your-domain.com/health
curl https://your-domain.com/health/db
```

### 5. Smoke Tests
- [ ] Test user registration (admin only)
- [ ] Test user login
- [ ] Test item creation
- [ ] Test item listing with pagination
- [ ] Test health endpoints
- [ ] Test account lockout

---

## Post-Deployment Verification

### 1. Health Checks
- [ ] `/health` returns 200
- [ ] `/health/db` shows database connected
- [ ] `/health/ready` returns ready
- [ ] `/health/live` returns alive

### 2. Functionality Tests
- [ ] User can login
- [ ] Items can be created
- [ ] Items can be listed (with pagination)
- [ ] Images upload successfully
- [ ] Email verification works
- [ ] Password reset works

### 3. Performance Checks
- [ ] Response times < 500ms
- [ ] Database connections < pool max
- [ ] Memory usage stable
- [ ] No memory leaks
- [ ] CPU usage reasonable

### 4. Security Checks
- [ ] Account lockout working
- [ ] Rate limiting active
- [ ] CORS configured correctly
- [ ] HTTPS enforced
- [ ] Security headers present

### 5. Monitoring
- [ ] Logs appearing in CloudWatch
- [ ] Metrics being collected
- [ ] Alerts configured
- [ ] Dashboard accessible
- [ ] Error tracking working

---

## Rollback Plan

### If Issues Occur

1. **Immediate Rollback**
   ```bash
   # Revert to previous version
   git revert HEAD
   npm run build
   pm2 restart all
   ```

2. **Database Rollback**
   ```bash
   npm run migration:revert
   ```

3. **Verify Rollback**
   ```bash
   curl https://your-domain.com/health
   ```

4. **Investigate Issues**
   - Check logs: `pm2 logs`
   - Check health: `curl /health`
   - Check database: `npm run migration:show`

---

## Monitoring Checklist

### Metrics to Monitor

#### Application Metrics
- [ ] Request rate (req/s)
- [ ] Response time (P50, P95, P99)
- [ ] Error rate (%)
- [ ] Active users
- [ ] Session count

#### Database Metrics
- [ ] Connection pool usage
- [ ] Query performance
- [ ] Slow queries (> 1s)
- [ ] Deadlocks
- [ ] Replication lag

#### System Metrics
- [ ] CPU usage (%)
- [ ] Memory usage (%)
- [ ] Disk I/O
- [ ] Network I/O
- [ ] Disk space

### Alert Thresholds

#### Critical Alerts
- [ ] Error rate > 5%
- [ ] Response time P95 > 2000ms
- [ ] Database pool usage > 90%
- [ ] Memory usage > 90%
- [ ] Disk space < 10%

#### Warning Alerts
- [ ] Error rate > 2%
- [ ] Response time P95 > 1000ms
- [ ] Database pool usage > 70%
- [ ] Memory usage > 80%
- [ ] Disk space < 20%

---

## Security Checklist

### Before Going Live

#### Credentials
- [ ] All credentials rotated
- [ ] No credentials in code
- [ ] No credentials in .env (use Secrets Manager)
- [ ] Firebase service account secured
- [ ] Database password strong (16+ chars)
- [ ] JWT secret strong (32+ chars)

#### Configuration
- [ ] `NODE_ENV=production`
- [ ] HTTPS enforced
- [ ] CORS properly configured
- [ ] Rate limiting enabled
- [ ] Account lockout enabled
- [ ] Helmet security headers enabled

#### Access Control
- [ ] Admin endpoints protected
- [ ] Role-based access working
- [ ] JWT expiration set (15 min)
- [ ] Refresh token rotation enabled
- [ ] Session management working

#### Monitoring
- [ ] Failed login attempts logged
- [ ] Suspicious activity tracked
- [ ] Audit logs enabled
- [ ] Security alerts configured

---

## Performance Checklist

### Optimization Verified

#### Database
- [ ] Connection pooling enabled
- [ ] Indexes on frequently queried columns
- [ ] Query optimization done
- [ ] N+1 queries eliminated
- [ ] Pagination implemented

#### Caching
- [ ] Redis configured
- [ ] Cache hit rate > 80%
- [ ] Cache TTLs appropriate
- [ ] Cache invalidation working

#### API
- [ ] Response compression enabled
- [ ] Pagination on all list endpoints
- [ ] Rate limiting configured
- [ ] CDN configured (if needed)

---

## Load Testing Results

### Before Deployment
- [ ] Run load tests: `npm run test:load`
- [ ] Verify thresholds met:
  - [ ] Error rate < 1%
  - [ ] P95 response time < 500ms
  - [ ] P99 response time < 1000ms
- [ ] Check for memory leaks
- [ ] Verify database performance
- [ ] Check connection pool usage

### Expected Results
- Throughput: 50-100 req/s sustained
- P95 Response Time: < 500ms
- P99 Response Time: < 1000ms
- Error Rate: < 1%
- Memory: Stable (no leaks)

---

## Documentation Checklist

### Updated Documentation
- [ ] README.md updated
- [ ] API documentation current
- [ ] Environment variables documented
- [ ] Deployment guide created
- [ ] Troubleshooting guide available
- [ ] Monitoring guide created

### Team Knowledge
- [ ] Team trained on new features
- [ ] Runbook created
- [ ] On-call procedures documented
- [ ] Escalation path defined

---

## Final Verification

### Before Going Live
- [ ] All tests passing
- [ ] Load tests successful
- [ ] Security audit complete
- [ ] Monitoring configured
- [ ] Alerts set up
- [ ] Rollback plan tested
- [ ] Team briefed
- [ ] Documentation complete

### Go/No-Go Decision
- [ ] Technical lead approval
- [ ] Security team approval
- [ ] Operations team approval
- [ ] Product owner approval

---

## Post-Launch Monitoring

### First 24 Hours
- [ ] Monitor error rates
- [ ] Check response times
- [ ] Verify database performance
- [ ] Monitor memory usage
- [ ] Check for any alerts
- [ ] Review logs for issues

### First Week
- [ ] Daily performance review
- [ ] User feedback collection
- [ ] Bug tracking
- [ ] Performance optimization
- [ ] Security monitoring

---

## Support Contacts

### Technical Issues
- Database: [DBA Contact]
- Infrastructure: [DevOps Contact]
- Application: [Dev Team Lead]

### Emergency Contacts
- On-call Engineer: [Phone]
- Technical Lead: [Phone]
- CTO: [Phone]

---

## Notes

### Deployment Date: _______________
### Deployed By: _______________
### Version: _______________
### Rollback Tested: [ ] Yes [ ] No

### Issues Encountered:
```
[List any issues and resolutions]
```

### Performance Baseline:
```
- Response Time P95: _____ms
- Error Rate: _____%
- Throughput: _____req/s
- Database Connections: _____
```

---

**Last Updated:** January 2025
**Version:** 1.0.0
