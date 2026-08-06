# Coach Safe Platform Foundation — Sprint 1A

## Delivered

- Tenant-aware authentication using company context in the JWT.
- Company slug/workspace support.
- Company-scoped user accounts with duplicate email addresses allowed across different companies.
- Commercial roles and permission definitions.
- Company onboarding/registration API behind `ALLOW_SELF_SIGNUP=true`.
- Company profile and branding/settings API.
- Company user-management API.
- Audit logging.
- Route public tokens and multi-company public driver-route resolution.
- Non-destructive PostgreSQL migration.
- Existing planner, verified pins, Driver V3, routes, vehicles, drivers, reports and journey events remain compatible.

## New endpoints

- `POST /api/platform/register-company` — public only when `ALLOW_SELF_SIGNUP=true`.
- `GET /api/platform/company`
- `PATCH /api/platform/company`
- `GET /api/platform/users`
- `POST /api/platform/users`
- `PATCH /api/platform/users/:id`
- `GET /api/platform/audit`

## Login

`POST /api/auth/login`

Body:

```json
{
  "companySlug": "abc-coaches",
  "email": "manager@abccoaches.co.uk",
  "password": "..."
}
```

For legacy accounts, `companySlug` remains optional while the email only belongs to one company.

## Security decisions

- Existing operational API queries remain scoped by `companyId`.
- Authenticated handlers now take company context from `req.user.companyId`.
- Public driver routes resolve using globally unique route IDs/public tokens because the driver is not signed into the operator workspace.
- Self-signup is disabled unless explicitly enabled.
- Audit logging records company, user, action, entity, IP and user agent.
