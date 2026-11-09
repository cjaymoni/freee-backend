# Staging deployment

Production runs on the VPS, behind nginx, under pm2. Staging runs on Render,
with Postgres on Neon and the cache on Upstash. The two share nothing: not a
database, not a Redis, not a JWT secret, not a Cloudinary cloud.

A commit landing on the `staging` branch runs lint, tests and a build in
GitHub Actions. Only if all three pass does Actions call a Render deploy hook;
Render then builds the branch and the app runs its TypeORM migrations against
Neon as it boots. `main` is untouched by any of this — production is still
promoted by hand on the VPS.

Pieces involved:

| Piece | Where | File |
| --- | --- | --- |
| Service definition | Render | [`render.yaml`](../render.yaml) |
| Deploy pipeline | GitHub Actions | [`.github/workflows/staging.yml`](../.github/workflows/staging.yml) |
| Variables to fill in | Render dashboard | [`.env.staging.example`](../.env.staging.example) |

---

## 1. Neon

1. Create a project at [neon.tech](https://neon.tech). Put it in
   **AWS eu-central-1 (Frankfurt)** so it sits beside the Render service.
2. Name the database `freee_staging`.
3. Copy the **direct** connection string from *Connection Details* — the host
   **without** `-pooler` in it. It looks like:

   ```
   postgresql://user:password@ep-cool-name-123456.eu-central-1.aws.neon.tech/freee_staging?sslmode=require
   ```

   Use the direct one, not the pooled one. The pooled host runs PgBouncer in
   transaction mode, and the migrations this app runs on boot are not safe to
   put through it. Staging is one instance with a pool of five connections, so
   the direct endpoint sits comfortably within Neon free-tier limits.

4. `?sslmode=require` must stay on the string. The app also sets
   `ssl: { rejectUnauthorized: false }` for URL connections
   ([`src/config/typeorm.config.ts`](../src/config/typeorm.config.ts)), which
   is what lets it accept Neon's certificate chain.

Nothing in the code needs PostGIS, so plain Neon Postgres is enough.

Neon's free tier suspends the compute after five minutes idle. The first
request after that pays a second or two of wake-up; the 10-second connection
timeout in the TypeORM config covers it.

### Running migrations by hand

The app runs pending migrations on boot, so normally there is nothing to do.
To run them from your machine instead — to check one before it ships, say:

```bash
DATABASE_URL='postgresql://...neon.tech/freee_staging?sslmode=require' npm run migration:show
DATABASE_URL='postgresql://...neon.tech/freee_staging?sslmode=require' npm run migration:run
```

### Resetting staging data

Neon branches are the cheap way to do this: branch `main` inside the Neon
project, point `DATABASE_URL` at the branch, and delete the branch when you
want the data gone.

## 2. Upstash

1. Create a Redis database at [upstash.com](https://upstash.com), region
   **eu-central-1**, named something unmistakable like `freee-staging`.
2. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

The app prefers Upstash whenever both of those are set and only falls back to
a `REDIS_HOST`/`REDIS_PORT` connection otherwise
([`src/app.module.ts`](../src/app.module.ts)), so staging needs no Redis of its
own on any host.

## 3. Render

1. Create the `staging` branch:

   ```bash
   git checkout -b staging main
   git branch --set-upstream-to=origin/staging staging   # after the first upload
   ```

2. In Render: **New → Blueprint**, pick this repository, and let it read
   `render.yaml`. It creates the `free-backend-staging` web service on the free
   plan in Frankfurt, tracking the `staging` branch with auto-deploy off.
3. Render will ask for every variable marked `sync: false`. Fill them from
   [`.env.staging.example`](../.env.staging.example):
   `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
   `CLOUDINARY_*`, `SMTP_*`, `FIREBASE_SERVICE_ACCOUNT_JSON`.
   `JWT_SECRET` is generated for you.
4. **Settings → Deploy Hook**: copy the URL. It is a secret — anyone holding it
   can trigger a deploy.

Two things to know about the free plan: the service sleeps after 15 minutes
without traffic and takes roughly 30 seconds to wake, and the instance has
512 MB, which is why the start command caps the old-space heap at 450 MB.

### Email and SMS on staging

Point `SMTP_*` at a catcher (Mailtrap, or a Brevo sandbox) rather than the
production mailbox, so a test run cannot email real users. Likewise, use a
separate Firebase project for `FIREBASE_SERVICE_ACCOUNT_JSON` — a staging
service account pointed at the production Firebase project would write to
production users.

## 4. GitHub

On the repository, under **Settings → Environments**, create an environment
called `staging` and add:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `RENDER_STAGING_DEPLOY_HOOK` | the deploy hook URL from Render |

Then under **Settings → Secrets and variables → Actions → Variables**:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `STAGING_STATUS_URL` | `https://free-backend-staging.onrender.com` |

`STAGING_STATUS_URL` is optional. With it set, the workflow waits until
`/health/live` reports the commit it just deployed, so a green run means
staging really is running that code; without it, the workflow finishes as soon
as Render accepts the request.

Add required reviewers to the `staging` environment if you want a deploy to
need approval.

## Day to day

```bash
git checkout staging
git merge main          # or cherry-pick the branch you want to try
git pull --ff-only && git status
```

Send the branch up, then watch the run in the Actions tab. When it is green:

```bash
curl https://free-backend-staging.onrender.com/health/live
# {"status":"alive","environment":"staging","commit":"<sha>","timestamp":"..."}

curl https://free-backend-staging.onrender.com/health/db
# {"status":"ok","environment":"staging","database":"connected","timestamp":"..."}
```

`environment` is there so you can never mistake a staging response for a
production one — both run with `NODE_ENV=production`, because that is what
makes TypeORM run migrations and refuse to `synchronize`. `APP_ENV` is what
names the deployment
([`src/config/app-env.ts`](../src/config/app-env.ts)).

Swagger is at `/api`, same as everywhere else.

## When something is wrong

**The service will not boot, and the logs mention env validation.** A required
variable is missing. [`src/config/env.validation.ts`](../src/config/env.validation.ts)
is the list; `JWT_SECRET`, `CLOUDINARY_*` and `SMTP_*` are all required and the
app refuses to start without them.

**`/health/db` says disconnected.** Check `DATABASE_URL` still ends in
`?sslmode=require`, and that you used the direct host rather than the `-pooler`
one.

**Migrations did not run.** They only run when `NODE_ENV=production`. Check
Render has not had that overwritten to `staging` — `APP_ENV` is the one that
should say `staging`.

**The deploy step fails immediately.** `RENDER_STAGING_DEPLOY_HOOK` is missing
from the `staging` environment, or the hook was regenerated in Render.

**CI never sees the new commit.** Render failed its own health check and rolled
back, or kept the previous instance alive. The Render deploy log says which.
