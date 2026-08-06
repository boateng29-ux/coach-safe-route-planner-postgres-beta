# Stage 1.3 Root Cause

The database was never broken. Stage 1.2.1 proved that the authenticated
company owned seven routes, two vehicles and two drivers.

The mismatch occurred because legacy operational route handlers could still
call `ensureCompany()` without the Express request. In a multi-company system,
that fallback can select the default company instead of `req.user.companyId`.

Stage 1.3 makes authenticated company context authoritative across operational
APIs and adds frontend response validation so an API error cannot masquerade
as an empty database.
