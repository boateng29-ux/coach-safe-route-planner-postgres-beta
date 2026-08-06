import { promises as fs } from 'fs';
import path from 'path';

const serverPath = path.resolve('./server.js');
const backupPath = path.resolve(
  `./server.js.backup-before-operational-visibility-${Date.now()}`
);

let source = await fs.readFile(serverPath, 'utf8');

if (source.includes('COACH_SAFE_OPERATIONAL_VISIBILITY_STAGE13')) {
  console.log('Stage 1.3 operational visibility fix is already installed.');
  process.exit(0);
}

if (!source.includes('async function ensureCompany')) {
  throw new Error('ensureCompany() was not found in server.js.');
}

await fs.copyFile(serverPath, backupPath);

const operationalPrefixes = [
  '/api/vehicles',
  '/api/drivers',
  '/api/routes',
  '/api/reports',
  '/api/journey-events',
  '/api/settings',
  '/api/branding'
];

let patchedHandlers = 0;
let patchedCalls = 0;

const routePattern =
  /app\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2[\s\S]*?\n\}\);/g;

source = source.replace(
  routePattern,
  (block, method, quote, routePath) => {
    const isOperational = operationalPrefixes.some(
      (prefix) => routePath === prefix || routePath.startsWith(prefix + '/')
    );

    if (!isOperational) return block;

    const updated = block.replace(
      /await\s+ensureCompany\(\s*\)/g,
      () => {
        patchedCalls += 1;
        return 'await ensureCompany(req)';
      }
    );

    if (updated !== block) patchedHandlers += 1;
    return updated;
  }
);

if (!patchedCalls) {
  const alreadyScoped =
    operationalPrefixes.some((prefix) =>
      source.includes(prefix)
    ) &&
    source.includes('await ensureCompany(req)');

  if (!alreadyScoped) {
    throw new Error(
      'No unscoped operational ensureCompany() calls were found and scoped handlers could not be confirmed.'
    );
  }
}

// Make ensureCompany explicitly prefer the authenticated tenant if the
// existing Sprint 1A implementation has been lost or partially overwritten.
source = source.replace(
  /async function ensureCompany\(\s*\)\s*\{/,
  `async function ensureCompany(req = null) {
  const authenticatedCompanyId =
    String(req?.user?.companyId || '').trim();

  if (authenticatedCompanyId) {
    return authenticatedCompanyId;
  }`
);

if (
  source.includes('async function ensureCompany(req = null) {') &&
  !source.includes(
    "const authenticatedCompanyId =\n    String(req?.user?.companyId || '').trim();"
  )
) {
  source = source.replace(
    'async function ensureCompany(req = null) {',
    `async function ensureCompany(req = null) {
  const authenticatedCompanyId =
    String(req?.user?.companyId || '').trim();

  if (authenticatedCompanyId) {
    return authenticatedCompanyId;
  }`
  );
}

source += `

/* COACH_SAFE_OPERATIONAL_VISIBILITY_STAGE13
   Protected operational handlers patched: ${patchedHandlers}
   ensureCompany() calls changed to ensureCompany(req): ${patchedCalls}
*/
`;

await fs.writeFile(serverPath, source, 'utf8');

console.log('Stage 1.3 operational data visibility fix installed.');
console.log('Handlers patched:', patchedHandlers);
console.log('Company-context calls patched:', patchedCalls);
console.log('Backup:', backupPath);
