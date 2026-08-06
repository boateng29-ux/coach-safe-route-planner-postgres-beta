import { promises as fs } from 'fs';
import path from 'path';

const serverPath = path.resolve('./server.js');
const backupPath = path.resolve(
  `./server.js.backup-before-platform-foundation-${Date.now()}`
);

let source = await fs.readFile(serverPath, 'utf8');

if (source.includes('COACH_SAFE_PLATFORM_FOUNDATION_SPRINT1A')) {
  console.log('Platform Foundation Sprint 1A is already installed.');
  process.exit(0);
}

const required = [
  'async function ensureCompany()',
  "app.post('/api/auth/login'",
  "app.get('/api/auth/me'",
  "app.use('/api'"
];

for (const marker of required) {
  if (!source.includes(marker)) {
    throw new Error(`Required server marker not found: ${marker}`);
  }
}

await fs.copyFile(serverPath, backupPath);

// Request-aware company context. Existing startup/seed behaviour is preserved.
source = source.replace(
  'async function ensureCompany() {',
  `async function ensureCompany(req = null) {
  const authenticatedCompanyId = String(req?.user?.companyId || '').trim();
  if (authenticatedCompanyId) return authenticatedCompanyId;`
);

// Every existing request handler now prefers its authenticated tenant.
// Public driver routes still fall back to route-ID resolution.
source = source.replaceAll(
  'const companyId = await ensureCompany();',
  'const companyId = await ensureCompany(req);'
);

const publicUserOld = `function publicUser(row = {}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: String(row.role || 'DISPATCHER').toLowerCase(),
    companyId: row.companyId
  };
}`;

const publicUserNew = `function publicUser(row = {}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: String(row.role || 'DISPATCHER').toLowerCase(),
    status: String(row.status || 'ACTIVE').toLowerCase(),
    companyId: row.companyId,
    company: row.companyId
      ? {
          id: row.companyId,
          slug: row.companySlug || '',
          name: row.companyName || '',
          brandingName: row.companyBrandingName || row.companyName || '',
          logoUrl: row.companyLogoUrl || '',
          plan: String(row.companyPlan || 'STARTER').toLowerCase(),
          status: String(row.companyStatus || 'TRIAL').toLowerCase(),
          onboardingComplete: Boolean(row.companyOnboardingComplete)
        }
      : null
  };
}`;

if (!source.includes(publicUserOld)) {
  throw new Error('publicUser block could not be located.');
}
source = source.replace(publicUserOld, publicUserNew);

const getUserOld = `  const result = await dbRequired().query('SELECT * FROM "User" WHERE id=$1 AND "companyId"=$2', [payload.sub, payload.companyId]);
  if (!result.rows.length) throw new Error('User not found.');
  return publicUser(result.rows[0]);`;

const getUserNew = `  const result = await dbRequired().query(
    \`SELECT u.*,
            c.slug AS "companySlug",
            c.name AS "companyName",
            c."brandingName" AS "companyBrandingName",
            c."logoUrl" AS "companyLogoUrl",
            c.plan AS "companyPlan",
            c.status AS "companyStatus",
            c."onboardingComplete" AS "companyOnboardingComplete"
       FROM "User" u
       JOIN "Company" c ON c.id=u."companyId"
      WHERE u.id=$1 AND u."companyId"=$2
        AND u.status='ACTIVE'
        AND c.status IN ('TRIAL','ACTIVE')\`,
    [payload.sub, payload.companyId]
  );
  if (!result.rows.length) throw new Error('User or company is unavailable.');
  return publicUser(result.rows[0]);`;

if (!source.includes(getUserOld)) {
  throw new Error('getUserFromRequest query could not be located.');
}
source = source.replace(getUserOld, getUserNew);

// Cross-company public route resolution by unguessable route ID/public token.
// This is required because there is no authenticated operator tenant on driver links.
const resolverOld = `async function resolvePublicRouteRow(rawId, companyId) {
  const candidates = publicRouteIdCandidates(rawId);
  if (!candidates.length) return null;

  const result = await dbRequired().query(
    \`\${ROUTE_SELECT_SQL}
     WHERE r.id = ANY($1::text[])
       AND r."companyId" = $2
     ORDER BY CASE WHEN r.id = $3 THEN 0 ELSE 1 END
     LIMIT 1\`,
    [candidates, companyId, candidates[0]]
  );

  return result.rows[0] || null;
}`;

const resolverNew = `async function resolvePublicRouteRow(rawId, companyId = '') {
  const candidates = publicRouteIdCandidates(rawId);
  if (!candidates.length) return null;

  if (companyId) {
    const tenantResult = await dbRequired().query(
      \`\${ROUTE_SELECT_SQL}
       WHERE (r.id = ANY($1::text[]) OR r."publicToken" = ANY($1::text[]))
         AND r."companyId" = $2
       ORDER BY CASE WHEN r.id = $3 OR r."publicToken" = $3 THEN 0 ELSE 1 END
       LIMIT 1\`,
      [candidates, companyId, candidates[0]]
    );
    if (tenantResult.rows.length) return tenantResult.rows[0];
  }

  const globalResult = await dbRequired().query(
    \`\${ROUTE_SELECT_SQL}
     WHERE r.id = ANY($1::text[]) OR r."publicToken" = ANY($1::text[])
     ORDER BY CASE WHEN r.id = $2 OR r."publicToken" = $2 THEN 0 ELSE 1 END
     LIMIT 1\`,
    [candidates, candidates[0]]
  );

  return globalResult.rows[0] || null;
}`;

if (!source.includes(resolverOld)) {
  throw new Error('Public route resolver could not be located.');
}
source = source.replace(resolverOld, resolverNew);

// Replace login with tenant-aware login. companySlug is optional while legacy
// globally unique emails are still in use.
const loginStart = source.indexOf("app.post('/api/auth/login'");
const loginEnd = source.indexOf("\n\napp.get('/api/auth/me'", loginStart);
if (loginStart < 0 || loginEnd < 0) {
  throw new Error('Login route boundaries could not be found.');
}

const loginRoute = `app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const companySlug = String(req.body?.companySlug || '')
      .trim()
      .toLowerCase();

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required.'
      });
    }

    const values = [email];
    let where = 'lower(u.email)=lower($1)';

    if (companySlug) {
      values.push(companySlug);
      where += ' AND lower(c.slug)=lower($2)';
    }

    const result = await dbRequired().query(
      \`SELECT u.*,
              c.slug AS "companySlug",
              c.name AS "companyName",
              c."brandingName" AS "companyBrandingName",
              c."logoUrl" AS "companyLogoUrl",
              c.plan AS "companyPlan",
              c.status AS "companyStatus",
              c."onboardingComplete" AS "companyOnboardingComplete"
         FROM "User" u
         JOIN "Company" c ON c.id=u."companyId"
        WHERE \${where}
          AND u.status='ACTIVE'
          AND c.status IN ('TRIAL','ACTIVE')
        ORDER BY u."createdAt" ASC
        LIMIT 2\`,
      values
    );

    if (!companySlug && result.rows.length > 1) {
      return res.status(409).json({
        error: 'This email belongs to more than one company. Enter the company workspace name.',
        requiresCompanySlug: true
      });
    }

    const user = result.rows[0];

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({
        error: 'Invalid company, email or password.'
      });
    }

    await dbRequired().query(
      'UPDATE "User" SET "lastLoginAt"=NOW() WHERE id=$1',
      [user.id]
    );

    const safeUser = publicUser(user);
    const token = signToken({
      sub: safeUser.id,
      companyId: safeUser.companyId,
      companySlug: safeUser.company?.slug || '',
      role: safeUser.role,
      email: safeUser.email
    });

    await logAuditEvent({
      companyId: safeUser.companyId,
      userId: safeUser.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: safeUser.id,
      req
    });

    return res.json({
      ok: true,
      token,
      user: safeUser,
      company: safeUser.company
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error.message || 'Login failed.'
    });
  }
});`;

source = source.slice(0, loginStart) + loginRoute + source.slice(loginEnd);

// Platform helpers and APIs.
const authMeMarker = `app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ ok: true, user: req.user });
});`;

const platformCode = String.raw`

/* COACH_SAFE_PLATFORM_FOUNDATION_SPRINT1A */
const PLATFORM_ROLE_PERMISSIONS = Object.freeze({
  super_admin: ['*'],
  owner: ['company:read','company:update','users:read','users:write','routes:read','routes:write','fleet:read','fleet:write','drivers:read','drivers:write','reports:read','reports:write','settings:read','settings:write','audit:read'],
  admin: ['company:read','company:update','users:read','users:write','routes:read','routes:write','fleet:read','fleet:write','drivers:read','drivers:write','reports:read','reports:write','settings:read','settings:write'],
  operations_manager: ['company:read','users:read','routes:read','routes:write','fleet:read','drivers:read','drivers:write','reports:read','reports:write','settings:read'],
  dispatcher: ['company:read','routes:read','routes:write','fleet:read','drivers:read','reports:read','reports:write'],
  fleet_manager: ['company:read','routes:read','fleet:read','fleet:write','drivers:read','reports:read'],
  driver: ['company:read','routes:read','reports:write'],
  read_only: ['company:read','routes:read','fleet:read','drivers:read','reports:read'],
  viewer: ['company:read','routes:read','fleet:read','drivers:read','reports:read']
});

function platformPermissions(role = '') {
  return PLATFORM_ROLE_PERMISSIONS[
    String(role || 'viewer').toLowerCase()
  ] || PLATFORM_ROLE_PERMISSIONS.viewer;
}

function platformCan(user, permission) {
  const permissions = platformPermissions(user?.role);
  return permissions.includes('*') || permissions.includes(permission);
}

function requirePlatformPermission(permission) {
  return function platformPermissionMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }

    if (!platformCan(req.user, permission)) {
      return res.status(403).json({
        error: 'Your role does not allow this action.',
        permission
      });
    }

    return next();
  };
}

function slugifyCompany(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

async function uniqueCompanySlug(name) {
  const base = slugifyCompany(name) || 'coach-company';
  let candidate = base;

  for (let i = 1; i < 1000; i += 1) {
    const found = await dbRequired().query(
      'SELECT 1 FROM "Company" WHERE slug=$1',
      [candidate]
    );

    if (!found.rows.length) return candidate;
    candidate = base + '-' + (i + 1);
  }

  throw new Error('Could not create a unique company workspace name.');
}

async function logAuditEvent({
  companyId,
  userId = null,
  action,
  entityType = null,
  entityId = null,
  metadata = {},
  req = null
}) {
  try {
    if (!companyId || !action) return;

    await dbRequired().query(
      'INSERT INTO "AuditLog" (id,"companyId","userId",action,"entityType","entityId",metadata,"ipAddress","userAgent","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())',
      [
        id('audit'),
        companyId,
        userId || null,
        String(action).slice(0, 120),
        entityType ? String(entityType).slice(0, 80) : null,
        entityId ? String(entityId).slice(0, 160) : null,
        JSON.stringify(metadata || {}),
        String(req?.ip || '').slice(0, 100),
        String(req?.headers?.['user-agent'] || '').slice(0, 500)
      ]
    );
  } catch (error) {
    console.error('Audit log failed:', error.message);
  }
}

app.get(
  '/api/platform/company',
  requirePlatformPermission('company:read'),
  async (req, res) => {
    try {
      const result = await dbRequired().query(
        'SELECT id,slug,name,"legalName","brandingName","logoUrl","countryCode",timezone,status,plan,"onboardingComplete",settings,branding,"trialEndsAt","createdAt","updatedAt" FROM "Company" WHERE id=$1',
        [req.user.companyId]
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Company not found.' });
      }

      return res.json(result.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

app.patch(
  '/api/platform/company',
  requirePlatformPermission('company:update'),
  async (req, res) => {
    try {
      const current = await dbRequired().query(
        'SELECT * FROM "Company" WHERE id=$1',
        [req.user.companyId]
      );

      if (!current.rows.length) {
        return res.status(404).json({ error: 'Company not found.' });
      }

      const row = current.rows[0];
      const name = String(req.body?.name || row.name).trim().slice(0, 160);
      const legalName = String(req.body?.legalName || row.legalName || '').trim().slice(0, 180);
      const brandingName = String(req.body?.brandingName || row.brandingName || name).trim().slice(0, 160);
      const logoUrl = String(req.body?.logoUrl || row.logoUrl || '').trim().slice(0, 2000000);
      const countryCode = String(req.body?.countryCode || row.countryCode || 'GB').trim().toUpperCase().slice(0, 2);
      const timezone = String(req.body?.timezone || row.timezone || 'Europe/London').trim().slice(0, 100);
      const settings = req.body?.settings && typeof req.body.settings === 'object'
        ? req.body.settings
        : row.settings || {};
      const branding = req.body?.branding && typeof req.body.branding === 'object'
        ? req.body.branding
        : row.branding || {};
      const onboardingComplete = req.body?.onboardingComplete === undefined
        ? Boolean(row.onboardingComplete)
        : Boolean(req.body.onboardingComplete);

      const result = await dbRequired().query(
        'UPDATE "Company" SET name=$1,"legalName"=$2,"brandingName"=$3,"logoUrl"=$4,"countryCode"=$5,timezone=$6,settings=$7,branding=$8,"onboardingComplete"=$9,"updatedAt"=NOW() WHERE id=$10 RETURNING *',
        [name, legalName, brandingName, logoUrl, countryCode, timezone, JSON.stringify(settings), JSON.stringify(branding), onboardingComplete, req.user.companyId]
      );

      await logAuditEvent({
        companyId: req.user.companyId,
        userId: req.user.id,
        action: 'company.updated',
        entityType: 'Company',
        entityId: req.user.companyId,
        req
      });

      return res.json(result.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

app.get(
  '/api/platform/users',
  requirePlatformPermission('users:read'),
  async (req, res) => {
    try {
      const result = await dbRequired().query(
        'SELECT id,name,email,role,status,"lastLoginAt","createdAt","updatedAt" FROM "User" WHERE "companyId"=$1 ORDER BY name,email',
        [req.user.companyId]
      );
      return res.json(result.rows.map(publicUser));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

app.post(
  '/api/platform/users',
  requirePlatformPermission('users:write'),
  async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim().slice(0, 120);
      const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 180);
      const password = String(req.body?.password || '');
      const role = String(req.body?.role || 'DISPATCHER').trim().toUpperCase();

      const allowedRoles = [
        'OWNER','ADMIN','OPERATIONS_MANAGER','DISPATCHER',
        'FLEET_MANAGER','DRIVER','READ_ONLY','VIEWER'
      ];

      if (!name || !email || password.length < 10) {
        return res.status(400).json({
          error: 'Name, email and a password of at least 10 characters are required.'
        });
      }

      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid company role.' });
      }

      const userId = id('user');
      const result = await dbRequired().query(
        'INSERT INTO "User" (id,"companyId",name,email,"passwordHash",role,status,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING *',
        [userId, req.user.companyId, name, email, hashPassword(password), role, 'ACTIVE']
      );

      await logAuditEvent({
        companyId: req.user.companyId,
        userId: req.user.id,
        action: 'user.created',
        entityType: 'User',
        entityId: userId,
        metadata: { role, email },
        req
      });

      return res.status(201).json(publicUser(result.rows[0]));
    } catch (error) {
      if (String(error.message).includes('User_companyId_email_key')) {
        return res.status(409).json({
          error: 'That email already belongs to a user in this company.'
        });
      }
      return res.status(500).json({ error: error.message });
    }
  }
);

app.patch(
  '/api/platform/users/:id',
  requirePlatformPermission('users:write'),
  async (req, res) => {
    try {
      const role = req.body?.role
        ? String(req.body.role).trim().toUpperCase()
        : null;
      const status = req.body?.status
        ? String(req.body.status).trim().toUpperCase()
        : null;

      const allowedRoles = [
        'OWNER','ADMIN','OPERATIONS_MANAGER','DISPATCHER',
        'FLEET_MANAGER','DRIVER','READ_ONLY','VIEWER'
      ];
      const allowedStatuses = ['INVITED','ACTIVE','SUSPENDED','DISABLED'];

      if (role && !allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid company role.' });
      }

      if (status && !allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid user status.' });
      }

      const updates = [];
      const values = [];
      let n = 1;

      if (req.body?.name !== undefined) {
        updates.push('name=$' + n++);
        values.push(String(req.body.name || '').trim().slice(0, 120));
      }

      if (role) {
        updates.push('role=$' + n++);
        values.push(role);
      }

      if (status) {
        updates.push('status=$' + n++);
        values.push(status);
      }

      if (!updates.length) {
        return res.status(400).json({ error: 'No supported changes supplied.' });
      }

      values.push(req.params.id, req.user.companyId);

      const result = await dbRequired().query(
        'UPDATE "User" SET ' + updates.join(',') + ',"updatedAt"=NOW() WHERE id=$' + n++ + ' AND "companyId"=$' + n + ' RETURNING *',
        values
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: 'User not found.' });
      }

      await logAuditEvent({
        companyId: req.user.companyId,
        userId: req.user.id,
        action: 'user.updated',
        entityType: 'User',
        entityId: req.params.id,
        metadata: { role, status },
        req
      });

      return res.json(publicUser(result.rows[0]));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

app.get(
  '/api/platform/audit',
  requirePlatformPermission('audit:read'),
  async (req, res) => {
    try {
      const limit = Math.min(250, Math.max(1, Number(req.query.limit || 100)));
      const result = await dbRequired().query(
        'SELECT a.*,u.name AS "userName",u.email AS "userEmail" FROM "AuditLog" a LEFT JOIN "User" u ON u.id=a."userId" WHERE a."companyId"=$1 ORDER BY a."createdAt" DESC LIMIT $2',
        [req.user.companyId, limit]
      );
      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

app.post('/api/platform/register-company', async (req, res) => {
  try {
    if (String(process.env.ALLOW_SELF_SIGNUP || '').toLowerCase() !== 'true') {
      return res.status(403).json({
        error: 'Self-service company registration is not enabled.'
      });
    }

    const companyName = String(req.body?.companyName || '').trim().slice(0, 160);
    const ownerName = String(req.body?.ownerName || '').trim().slice(0, 120);
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 180);
    const password = String(req.body?.password || '');
    const countryCode = String(req.body?.countryCode || 'GB').trim().toUpperCase().slice(0, 2);

    if (!companyName || !ownerName || !email || password.length < 10) {
      return res.status(400).json({
        error: 'Company, owner, email and a password of at least 10 characters are required.'
      });
    }

    const companyId = id('company');
    const ownerId = id('user');
    const slug = await uniqueCompanySlug(companyName);

    const client = await dbRequired().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO "Company" (id,slug,name,"brandingName","countryCode",timezone,status,plan,"onboardingComplete","trialEndsAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+INTERVAL \'14 days\',NOW(),NOW())',
        [companyId, slug, companyName, companyName, countryCode, 'Europe/London', 'TRIAL', 'STARTER', false]
      );
      await client.query(
        'INSERT INTO "User" (id,"companyId",name,email,"passwordHash",role,status,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())',
        [ownerId, companyId, ownerName, email, hashPassword(password), 'OWNER', 'ACTIVE']
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const token = signToken({
      sub: ownerId,
      companyId,
      companySlug: slug,
      role: 'owner',
      email
    });

    await logAuditEvent({
      companyId,
      userId: ownerId,
      action: 'company.registered',
      entityType: 'Company',
      entityId: companyId,
      metadata: { slug },
      req
    });

    return res.status(201).json({
      ok: true,
      token,
      company: {
        id: companyId,
        slug,
        name: companyName,
        status: 'trial',
        plan: 'starter',
        onboardingComplete: false
      },
      user: {
        id: ownerId,
        companyId,
        name: ownerName,
        email,
        role: 'owner',
        status: 'active'
      }
    });
  } catch (error) {
    if (String(error.message).includes('User_companyId_email_key')) {
      return res.status(409).json({
        error: 'That owner email already exists in this company.'
      });
    }

    return res.status(500).json({
      error: error.message || 'Company registration failed.'
    });
  }
});
/* COACH_SAFE_PLATFORM_FOUNDATION_SPRINT1A_END */
`;

if (!source.includes(authMeMarker)) {
  throw new Error('Auth-me route marker could not be found.');
}
source = source.replace(authMeMarker, authMeMarker + platformCode);

// Make registration public only when explicitly enabled by environment.
source = source.replace(
  "  if (req.path === '/auth/login') return true;",
  "  if (req.path === '/auth/login') return true;\n  if (req.path === '/platform/register-company' && req.method === 'POST') return true;"
);

await fs.writeFile(serverPath, source, 'utf8');
console.log('Coach Safe Platform Foundation Sprint 1A installed.');
console.log('Backup:', backupPath);
