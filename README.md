# Coach Safe Route Planner PostgreSQL Beta - Auth Upgrade

This version adds email/password login, token-based sessions, user-role foundation, and protected API routes.

## New environment variables

Set these locally in `.env` and in Render Environment Variables:

```env
TOMTOM_API_KEY=your_tomtom_key_here
DATABASE_URL=your_render_database_url_here
JWT_SECRET=replace_with_a_long_random_secret
ADMIN_EMAIL=admin@point2point.site
ADMIN_PASSWORD=replace_with_a_strong_admin_password
AUTH_TOKEN_HOURS=12
RESET_ADMIN_PASSWORD=false
DEFAULT_COUNTRY_SET=GB
TOMTOM_TRAVEL_MODE=truck
ENABLE_MOCK_MODE=false
NODE_ENV=production
```

On first startup, if the `User` table is empty, the app creates one admin user using `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Deploy

Build Command:

```bash
npm install --no-package-lock --registry=https://registry.npmjs.org/ && npx prisma generate
```

Start Command:

```bash
npx prisma migrate deploy && npm start
```

## After deploying

Open:

```text
https://coach.point2point.site/api/health
```

Then sign in at:

```text
https://coach.point2point.site
```

Use the `ADMIN_EMAIL` and `ADMIN_PASSWORD` values you set in Render.

## If you forget the admin password

Set `RESET_ADMIN_PASSWORD=true` in Render, set a new `ADMIN_PASSWORD`, redeploy once, sign in, then set `RESET_ADMIN_PASSWORD=false` and redeploy again.
