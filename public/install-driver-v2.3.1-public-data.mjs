import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const installerDir = path.dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const serverFile = path.join(root, 'server.js');
const driverDir = path.join(root, 'public', 'driver-v2');

if (!fs.existsSync(serverFile)) throw new Error('server.js was not found.');
if (!fs.existsSync(driverDir)) throw new Error('public/driver-v2 was not found.');

const marker = 'COACH_SAFE_DRIVER_V231_PUBLIC_DATA';
let server = fs.readFileSync(serverFile, 'utf8');

if (server.includes(marker)) {
  console.log('Coach Safe Driver V2.3.1 is already installed.');
  process.exit(0);
}

fs.copyFileSync(serverFile, serverFile + '.backup-before-v2.3.1-public-data');

for (const name of [
  'index.html',
  'driver-v2.css',
  'app.js',
  'map-controller.js',
  'gps-controller.js',
  'camera-controller.js',
  'voice-controller.js'
]) {
  const source = path.join(installerDir, 'public', 'driver-v2', name);
  const destination = path.join(driverDir, name);
  if (fs.existsSync(source)) fs.copyFileSync(source, destination);
}

/*
 * Insert before the REAL top-level authentication route.
 * Searching from the end avoids matching text inside HTML template strings.
 */
const authAnchor = "\napp.post('/api/auth/login'";
const authIndex = server.lastIndexOf(authAnchor);

if (authIndex < 0) {
  throw new Error("Could not find the real top-level app.post('/api/auth/login') route.");
}

const publicDataRoute = `/* ${marker} */
app.get('/driver-v2/data/:id', async (req, res) => {
  try {
    const companyId = await ensureCompany();

    const result = await dbRequired().query(
      \`\${ROUTE_SELECT_SQL} WHERE r.id=$1 AND r."companyId"=$2\`,
      [req.params.id, companyId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Driver route not found.' });
    }

    const route = apiRoute(result.rows[0]);

    /*
     * This endpoint is public and read-only.
     * Do not expose operator credentials, passwords or admin data.
     */
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });

    return res.json(route);
  } catch (error) {
    console.error('Driver V2 public route-data error', error);
    return res.status(500).json({
      error: error.message || 'Could not load driver route.'
    });
  }
});

`;

server = server.slice(0, authIndex + 1) + publicDataRoute + server.slice(authIndex + 1);
fs.writeFileSync(serverFile, server, 'utf8');

console.log('Coach Safe Driver V2.3.1 installed.');
console.log('Driver V2 route data now loads from /driver-v2/data/:id.');
console.log('Protected /api routes were not changed.');
console.log('Run:');
console.log('  node --check .\\server.js');
console.log('  node --check .\\public\\driver-v2\\app.js');
