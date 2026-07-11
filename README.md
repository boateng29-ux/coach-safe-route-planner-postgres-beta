# Coach Safe Route Planner — PostgreSQL Beta

This version stores vehicles, drivers, approved routes, company branding, and unsuitable-road reports in PostgreSQL instead of `data/db.json`.

## Run locally

1. Create `.env` from `.env.example` and add your TomTom key plus Render **External Database URL**.
2. Install dependencies:

```powershell
npm.cmd install
```

3. Apply database schema if you have not already done so:

```powershell
npx.cmd prisma format
npx.cmd prisma migrate dev --name add_beta_tables
npx.cmd prisma generate
```

4. Start the app:

```powershell
npm.cmd start
```

5. Open:

```text
http://localhost:3000
http://localhost:3000/api/health
```

`/api/health` should show `databaseReady: true` and `providerReady: true`.

## Security reminder

Do not upload `.env` to GitHub. If keys or database passwords have appeared in screenshots or chat, rotate them before real beta use.
