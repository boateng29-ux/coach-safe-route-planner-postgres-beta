import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const TOMTOM_API_KEY = String(process.env.TOMTOM_API_KEY || '').trim().replace(/^['\"]|['\"]$/g, '');
const DEFAULT_COUNTRY_SET = process.env.DEFAULT_COUNTRY_SET || 'GB';
// 'truck' is the most stable mode for coach-size restriction routing.
// TomTom also supports 'bus', but it is beta and restriction coverage can vary.
const TOMTOM_TRAVEL_MODE = process.env.TOMTOM_TRAVEL_MODE || 'truck';
// Mock mode is now OFF by default so exported maps never silently draw straight/approximate lines.
// Set ENABLE_MOCK_MODE=true in .env only when you intentionally want demo routes without TomTom.
const ENABLE_MOCK_MODE = String(process.env.ENABLE_MOCK_MODE || '').toLowerCase() === 'true';
const HAS_LIVE_TOMTOM_KEY = Boolean(TOMTOM_API_KEY && TOMTOM_API_KEY !== 'put_your_tomtom_key_here');
const JWT_SECRET = String(process.env.JWT_SECRET || 'change_this_to_a_long_random_secret').trim();
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@point2point.site').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'ChangeMe123!').trim();
const AUTH_TOKEN_HOURS = Math.max(1, Number(process.env.AUTH_TOKEN_HOURS || 12));
const RESET_ADMIN_PASSWORD = String(process.env.RESET_ADMIN_PASSWORD || '').toLowerCase() === 'true';

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : undefined }) : null;
const DEFAULT_COMPANY_NAME = 'Point 2 Point';
const DEFAULT_APP_NAME = 'Coach Safe Route Planner';
let cachedCompanyId = '';

function dbRequired() {
  if (!pool) throw new Error('DATABASE_URL is missing. Add your Render External Database URL to .env and restart the app.');
  return pool;
}


app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const COACH_PRESETS = {
  midi: { name: 'Midi Coach / 33 seat', heightM: 3.2, widthM: 2.55, lengthM: 9.5, weightKg: 12000, maxSpeedKmh: 90 },
  standard: { name: 'Standard Coach / 49–57 seat', heightM: 3.65, widthM: 2.55, lengthM: 12.2, weightKg: 18000, maxSpeedKmh: 90 },
  triAxle: { name: 'Tri-axle Coach', heightM: 3.75, widthM: 2.55, lengthM: 13.8, weightKg: 26000, maxSpeedKmh: 90 },
  doubleDecker: { name: 'Double-decker Coach', heightM: 4.35, widthM: 2.55, lengthM: 13.5, weightKg: 26000, maxSpeedKmh: 90 }
};

const DEFAULT_DB = {
  vehicles: [
    {
      id: 'veh_demo_standard',
      name: 'P2P Standard Coach',
      registration: 'DEMO-57',
      preset: 'standard',
      heightM: 3.65,
      widthM: 2.55,
      lengthM: 12.2,
      weightKg: 18000,
      maxSpeedKmh: 90,
      notes: 'Demo 49–57 seat vehicle profile.',
      createdAt: new Date().toISOString()
    },
    {
      id: 'veh_demo_decker',
      name: 'P2P Double Decker',
      registration: 'DEMO-DD',
      preset: 'doubleDecker',
      heightM: 4.35,
      widthM: 2.55,
      lengthM: 13.5,
      weightKg: 26000,
      maxSpeedKmh: 90,
      notes: 'Demo high vehicle profile.',
      createdAt: new Date().toISOString()
    }
  ],
  drivers: [
    {
      id: 'drv_demo_1',
      name: 'Demo Driver',
      phone: '',
      email: '',
      base: 'London',
      notes: 'Sample driver record. Replace with your team.',
      createdAt: new Date().toISOString()
    }
  ],
  approvedRoutes: [],
  unsuitableReports: [],
  settings: {
    companyName: 'Point 2 Point',
    appName: 'Coach Safe Route Planner',
    logoDataUrl: '',
    accentName: 'Gold / Black',
    demoPin: '1234'
  }
};

function id(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
  }
}

async function readDb() {
  await ensureDb();
  const raw = await fs.readFile(DB_FILE, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  return {
    ...DEFAULT_DB,
    ...parsed,
    vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : DEFAULT_DB.vehicles,
    drivers: Array.isArray(parsed.drivers) ? parsed.drivers : DEFAULT_DB.drivers,
    approvedRoutes: Array.isArray(parsed.approvedRoutes) ? parsed.approvedRoutes : [],
    unsuitableReports: Array.isArray(parsed.unsuitableReports) ? parsed.unsuitableReports : [],
    settings: { ...DEFAULT_DB.settings, ...(parsed.settings || {}) }
  };
}

async function writeDb(db) {
  await ensureDb();
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function cleanTomTomError(text = '') {
  try {
    const parsed = JSON.parse(text);
    return parsed.detailedError?.message || parsed.errorText || parsed.message || JSON.stringify(parsed);
  } catch {
    return String(text).slice(0, 500);
  }
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function cleanVehicle(vehicle = {}) {
  const preset = COACH_PRESETS[vehicle.preset] || COACH_PRESETS.standard;
  return {
    id: vehicle.id || undefined,
    preset: vehicle.preset || 'standard',
    name: vehicle.name || preset.name,
    registration: vehicle.registration || '',
    heightM: asNumber(vehicle.heightM, preset.heightM),
    widthM: asNumber(vehicle.widthM, preset.widthM),
    lengthM: asNumber(vehicle.lengthM, preset.lengthM),
    weightKg: Math.round(asNumber(vehicle.weightKg, preset.weightKg)),
    maxSpeedKmh: Math.round(asNumber(vehicle.maxSpeedKmh, preset.maxSpeedKmh))
  };
}

function cleanSavedVehicle(vehicle = {}) {
  const base = cleanVehicle(vehicle);
  return {
    id: vehicle.id || id('veh'),
    name: String(vehicle.name || base.name).trim().slice(0, 120),
    registration: String(vehicle.registration || '').trim().slice(0, 40),
    preset: base.preset,
    heightM: base.heightM,
    widthM: base.widthM,
    lengthM: base.lengthM,
    weightKg: base.weightKg,
    maxSpeedKmh: base.maxSpeedKmh,
    notes: String(vehicle.notes || '').trim().slice(0, 500),
    createdAt: vehicle.createdAt || new Date().toISOString()
  };
}

function cleanDriver(driver = {}) {
  return {
    id: driver.id || id('drv'),
    name: String(driver.name || 'Unnamed driver').trim().slice(0, 120),
    phone: String(driver.phone || '').trim().slice(0, 60),
    email: String(driver.email || '').trim().slice(0, 160),
    base: String(driver.base || '').trim().slice(0, 120),
    notes: String(driver.notes || '').trim().slice(0, 500),
    createdAt: driver.createdAt || new Date().toISOString()
  };
}

async function tomtomGeocode(query) {
  const url = new URL(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(query)}.json`);
  url.searchParams.set('key', TOMTOM_API_KEY);
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrySet', DEFAULT_COUNTRY_SET);
  url.searchParams.set('language', 'en-GB');

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TomTom geocoding failed (${response.status}). ${cleanTomTomError(text)}`);
  }
  const data = await response.json();
  if (!data.results?.length) throw new Error(`No geocoding result found for: ${query}`);
  const result = data.results[0];
  return {
    label: result.address?.freeformAddress || query,
    lat: result.position.lat,
    lon: result.position.lon,
    raw: result
  };
}

function routeWarnings(route, vehicle, options = {}) {
  const warnings = [];
  const summary = route?.summary || {};

  warnings.push({
    level: 'notice',
    title: 'Driver judgement required',
    message: 'Always follow road signs, temporary restrictions, and local coach/bus access rules. This planner supports safer routing but is not a legal guarantee.'
  });

  if (vehicle.heightM >= 4.0) {
    warnings.push({ level: 'high', title: 'High vehicle profile', message: `Vehicle height is ${vehicle.heightM}m. Double-check low bridges, depot access, hotel entrances, and private roads before dispatch.` });
  } else if (vehicle.heightM >= 3.6) {
    warnings.push({ level: 'medium', title: 'Coach height caution', message: `Vehicle height is ${vehicle.heightM}m. Review any town-centre and bridge sections before approving the route.` });
  }

  if (vehicle.lengthM >= 13.0) {
    warnings.push({ level: 'medium', title: 'Long coach turning risk', message: `Vehicle length is ${vehicle.lengthM}m. Watch tight turns, narrow high streets, car parks, school gates, and hotel forecourts.` });
  }

  if (vehicle.weightKg >= 18000) {
    warnings.push({ level: 'medium', title: 'Weight restriction caution', message: `Vehicle weight is ${vehicle.weightKg.toLocaleString()}kg. Confirm weak bridge and local weight-limit signage on the final route.` });
  }

  if (options.avoidLowEmissionZones) {
    warnings.push({ level: 'notice', title: 'Low emission zone avoidance requested', message: 'The route request asked the provider to avoid low-emission zones where route data supports it.' });
  }

  if (summary.trafficDelayInSeconds && summary.trafficDelayInSeconds > 600) {
    warnings.push({ level: 'medium', title: 'Traffic delay', message: `Traffic delay is about ${Math.round(summary.trafficDelayInSeconds / 60)} minutes. Consider dispatch timing or an approved alternative.` });
  }

  return warnings;
}

function calculateRisk(route, vehicle, options = {}) {
  const warnings = route?.warnings || [];
  const summary = route?.summary || {};
  let score = 20;

  if (vehicle.heightM >= 4.0) score += 30;
  else if (vehicle.heightM >= 3.6) score += 15;
  if (vehicle.lengthM >= 13) score += 15;
  else if (vehicle.lengthM >= 12) score += 8;
  if (vehicle.weightKg >= 26000) score += 18;
  else if (vehicle.weightKg >= 18000) score += 10;
  if (summary.trafficDelayInSeconds > 900) score += 12;
  else if (summary.trafficDelayInSeconds > 600) score += 8;
  if (!options.avoidTunnels) score += 3;
  if (!options.avoidUnpaved) score += 4;
  score += warnings.filter((w) => w.level === 'high').length * 12;
  score += warnings.filter((w) => w.level === 'medium').length * 5;
  score = Math.min(100, Math.max(0, Math.round(score)));

  const level = score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
  const recommendation = score >= 70
    ? 'Manager review required before issuing to driver.'
    : score >= 45
      ? 'Review warnings and final approach before approval.'
      : 'Suitable for normal operator review.';

  return { score, level, recommendation };
}

async function tomtomRoute(origin, destination, vehicle, options = {}, waypoints = []) {
  const safeWaypoints = Array.isArray(waypoints)
    ? waypoints.filter((point) => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))).slice(0, 8)
    : [];
  const allRoutePoints = [origin, ...safeWaypoints, destination];
  const routeLocations = allRoutePoints.map((point) => `${point.lat},${point.lon}`).join(':');
  const url = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${routeLocations}/json`);
  url.searchParams.set('key', TOMTOM_API_KEY);
  url.searchParams.set('routeType', 'fastest');
  url.searchParams.set('traffic', 'true');
  url.searchParams.set('computeTravelTimeFor', 'all');
  url.searchParams.set('routeRepresentation', 'polyline');
  url.searchParams.set('instructionsType', 'text');
  url.searchParams.set('language', 'en-GB');
  url.searchParams.set('travelMode', TOMTOM_TRAVEL_MODE);
  url.searchParams.set('vehicleCommercial', 'true');
  url.searchParams.set('vehicleHeight', String(vehicle.heightM));
  url.searchParams.set('vehicleWidth', String(vehicle.widthM));
  url.searchParams.set('vehicleLength', String(vehicle.lengthM));
  url.searchParams.set('vehicleWeight', String(vehicle.weightKg));
  url.searchParams.set('vehicleMaxSpeed', String(vehicle.maxSpeedKmh));
  url.searchParams.append('sectionType', 'traffic');

  if (options.avoidTolls) url.searchParams.append('avoid', 'tollRoads');
  if (options.avoidFerries) url.searchParams.append('avoid', 'ferries');
  if (options.avoidUnpaved) url.searchParams.append('avoid', 'unpavedRoads');
  if (options.avoidTunnels) url.searchParams.append('avoid', 'tunnels');
  if (options.avoidLowEmissionZones) url.searchParams.append('avoid', 'lowEmissionZones');

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TomTom routing failed (${response.status}). ${cleanTomTomError(text)}`);
  }
  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('No route returned by routing provider.');

  const points = route.legs.flatMap((leg) => leg.points || []).map((p) => [p.latitude, p.longitude]);
  if (points.length < 3) {
    throw new Error('TomTom returned too few route geometry points. The route cannot be exported safely because it may draw as a straight line. Try a more precise start/destination or check TomTom route coverage.');
  }
  const instructions = route.guidance?.instructions || [];
  const base = {
    provider: 'tomtom',
    origin,
    destination,
    waypoints: safeWaypoints,
    vehicle,
    options,
    summary: route.summary,
    points,
    instructions: instructions.slice(0, 40).map((i) => ({
      instruction: i.message,
      street: i.street,
      distanceM: i.routeOffsetInMeters,
      travelTimeSeconds: i.travelTimeInSeconds
    }))
  };
  base.warnings = routeWarnings(route, vehicle, options);
  if (safeWaypoints.length) {
    base.warnings.push({
      level: 'notice',
      title: 'Multiple stops included',
      message: `This route includes ${safeWaypoints.length} intermediate stop${safeWaypoints.length === 1 ? '' : 's'} before the final destination. Review each stop for coach access, turning space and safe passenger drop-off.`
    });
  }
  base.risk = calculateRisk(base, vehicle, options);
  return base;
}

function mockRoute(start, destination, vehicle, options = {}) {
  const origin = { label: start || 'Hounslow, UK', lat: 51.4700, lon: -0.3610 };
  const dest = { label: destination || 'Wembley Stadium, London', lat: 51.5560, lon: -0.2796 };
  const points = [
    [51.4700, -0.3610], [51.4810, -0.3850], [51.5035, -0.3690], [51.5200, -0.3450],
    [51.5350, -0.3150], [51.5480, -0.2940], [51.5560, -0.2796]
  ];
  const summary = {
    lengthInMeters: 23600,
    travelTimeInSeconds: 2850,
    trafficDelayInSeconds: 420,
    departureTime: new Date().toISOString(),
    arrivalTime: new Date(Date.now() + 2850 * 1000).toISOString()
  };
  const base = {
    provider: 'mock',
    origin,
    destination: dest,
    waypoints: [],
    vehicle,
    options,
    summary,
    points,
    instructions: [
      { instruction: 'Start route from origin', street: origin.label, distanceM: 0 },
      { instruction: 'Use main distributor roads where possible', street: 'A-road corridor', distanceM: 4000 },
      { instruction: 'Review final approach for coach access and drop-off rules', street: dest.label, distanceM: 21000 }
    ]
  };
  base.warnings = routeWarnings({ summary }, vehicle, options).concat([
    { level: 'notice', title: 'Mock mode active', message: 'Add a TomTom API key in .env to calculate real routes.' }
  ]);
  base.risk = calculateRisk(base, vehicle, options);
  return base;
}

function stripRouteForStorage(route = {}) {
  return {
    provider: route.provider,
    origin: route.origin,
    destination: route.destination,
    vehicle: route.vehicle,
    options: route.options || {},
    summary: route.summary || {},
    points: Array.isArray(route.points) ? route.points : [],
    instructions: Array.isArray(route.instructions) ? route.instructions : [],
    warnings: Array.isArray(route.warnings) ? route.warnings : [],
    risk: route.risk || calculateRisk(route, route.vehicle || {}, route.options || {})
  };
}


function cleanSettings(settings = {}) {
  const out = {
    companyName: String(settings.companyName || DEFAULT_DB.settings.companyName).trim().slice(0, 120),
    appName: String(settings.appName || DEFAULT_DB.settings.appName).trim().slice(0, 120),
    accentName: String(settings.accentName || DEFAULT_DB.settings.accentName).trim().slice(0, 80),
    logoDataUrl: String(settings.logoDataUrl || '').trim()
  };
  if (out.logoDataUrl && !out.logoDataUrl.startsWith('data:image/')) out.logoDataUrl = '';
  if (out.logoDataUrl.length > 900000) out.logoDataUrl = '';
  return out;
}

function cleanRouteStatus(value = '') {
  const status = String(value || '').toLowerCase();
  return ['draft', 'approved', 'assigned', 'completed'].includes(status) ? status : 'approved';
}

function buildDriverRouteHtml(record, settings = DEFAULT_DB.settings) {
  const route = record.route || {};
  const title = `${route.origin?.label || 'Start'} to ${route.destination?.label || 'Destination'}`;
  const warningCards = (route.warnings || []).map((w) => `
    <article class="warning ${escapeHtml(w.level || 'notice')}">
      <strong>${escapeHtml(w.title || 'Route note')}</strong>
      <p>${escapeHtml(w.message || '')}</p>
    </article>`).join('') || '<p class="muted">No warnings returned.</p>';
  const vehicle = route.vehicle || record.vehicleRecord || {};
  const driver = record.driver || {};
  const plannedStops = Array.isArray(route.waypoints) ? route.waypoints : [];
  const stopsHtml = plannedStops.length
    ? `<section class="card"><h2>Planned stops</h2><ol>${plannedStops.map((stop, index) => `<li><span>${index + 1}</span>${escapeHtml(stop.label || `Stop ${index + 1}`)}</li>`).join('')}</ol></section>`
    : '';
  const logo = settings.logoDataUrl ? `<img class="logo-img" src="${escapeHtml(settings.logoDataUrl)}" alt="Company logo">` : '<div class="logo-mark">P2P</div>';
  const fullReportUrl = `/driver/route/${escapeHtml(record.id)}/route-pack`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Driver Route - ${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  :root{--bg:#070707;--panel:#111;--gold:#d6ad52;--gold2:#f1d58a;--text:#f7f3e8;--muted:#b7aa8a;--line:rgba(214,173,82,.28);--danger:#ff6b6b;--warn:#ffd166;--notice:#9ed0ff;--good:#8ee6a8}
  *{box-sizing:border-box} body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#070707;color:var(--text)}
  header{position:sticky;top:0;z-index:1000;background:linear-gradient(135deg,#050505,#17120a);border-bottom:1px solid var(--line);padding:.85rem 1rem;display:flex;gap:.85rem;align-items:center}.logo-mark{width:46px;height:46px;border-radius:999px;background:linear-gradient(135deg,var(--gold2),var(--gold));display:grid;place-items:center;color:#151006;font-weight:900;flex:0 0 auto}.logo-img{max-width:56px;max-height:56px;border-radius:.7rem;object-fit:contain;background:#fff;padding:.15rem}.eyebrow{color:var(--gold2);text-transform:uppercase;letter-spacing:.12em;font-size:.68rem}h1{font-size:1.15rem;margin:.15rem 0}.muted{color:var(--muted)}
  #driverMap{height:55vh;min-height:23rem;width:100%;background:#101418;touch-action:pan-x pan-y;overscroll-behavior:contain;--map-rotation:0deg}.driver-map-shell{position:relative;background:#101418}.driver-map-shell:fullscreen{width:100vw;height:100vh;background:#050505}.driver-map-shell:fullscreen #driverMap{height:100vh;min-height:100vh}.driver-map-controls{position:absolute;left:.65rem;right:.65rem;bottom:.75rem;z-index:900;display:flex;gap:.45rem;flex-wrap:wrap;justify-content:center;pointer-events:none}.driver-map-controls button{pointer-events:auto;padding:.62rem .72rem;border-radius:999px;box-shadow:0 10px 22px rgba(0,0,0,.55);backdrop-filter:blur(7px);background:rgba(5,5,5,.94)!important;color:var(--gold2)!important;border:1px solid rgba(241,213,138,.82)!important;text-shadow:0 1px 0 #000}.driver-map-controls button.active{background:linear-gradient(135deg,var(--gold2),var(--gold))!important;color:#151006!important;border-color:rgba(241,213,138,.95)!important;text-shadow:none}.driver-map-controls button.warn{background:#1a0505!important;color:#ffd4d4!important;border-color:#ff6b6b!important}.driver-map-controls button:focus-visible,.button:focus-visible,button:focus-visible{outline:3px solid rgba(241,213,138,.45);outline-offset:2px}#driverMap.route-up .leaflet-tile-pane,#driverMap.route-up .leaflet-overlay-pane,#driverMap.route-up .leaflet-marker-pane,#driverMap.route-up .leaflet-shadow-pane{rotate:var(--map-rotation);scale:1.42;transform-origin:50% 50%;transition:rotate .25s ease}#driverMap.route-up .leaflet-popup-pane,#driverMap.route-up .leaflet-tooltip-pane{rotate:0deg}.direction-note{position:absolute;top:.65rem;left:.65rem;z-index:850;background:rgba(5,5,5,.82);border:1px solid rgba(241,213,138,.58);border-radius:999px;color:var(--gold2);padding:.38rem .62rem;font-weight:900;font-size:.78rem;pointer-events:none}@media(max-width:520px){.driver-map-controls{justify-content:space-between}.driver-map-controls button{font-size:.78rem;padding:.58rem .55rem;flex:1 1 calc(50% - .45rem)}}.content{padding:1rem;display:grid;gap:1rem}.card{border:1px solid var(--line);border-radius:1rem;background:rgba(255,255,255,.045);padding:1rem}.stats{display:grid;grid-template-columns:1fr 1fr;gap:.65rem}.stat{border:1px solid var(--line);border-radius:.8rem;padding:.75rem}.stat strong{display:block;color:var(--gold2)}.status{display:inline-block;padding:.28rem .55rem;border:1px solid var(--line);border-radius:999px;color:var(--gold2);font-weight:800;text-transform:capitalize}.warning{border:1px solid var(--line);border-radius:.75rem;padding:.75rem;margin-bottom:.65rem}.warning p{margin:.35rem 0 0;color:var(--muted)}.warning.high strong{color:var(--danger)}.warning.medium strong{color:var(--warn)}.warning.notice strong{color:var(--notice)}ol{list-style:none;padding:0;margin:0;color:var(--muted)}li{display:grid;grid-template-columns:1.8rem 1fr;gap:.5rem;margin-bottom:.65rem}li span{display:grid;place-items:center;width:1.45rem;height:1.45rem;border-radius:999px;background:rgba(214,173,82,.18);color:var(--gold2);font-weight:900}.buttons{display:flex;gap:.6rem;flex-wrap:wrap}.button,button{border:1px solid rgba(241,213,138,.82);border-radius:.7rem;padding:.78rem .95rem;font-weight:900;background:#050505;color:var(--gold2);text-decoration:none;display:inline-block;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.32),inset 0 0 0 1px rgba(214,173,82,.18)}.button:hover,button:hover{background:linear-gradient(135deg,#151006,#2a210d);color:#fff2b6}.button:active,button:active{transform:translateY(1px)}.button.primary,button.primary{background:linear-gradient(135deg,var(--gold2),var(--gold));color:#151006}.secondary{background:#050505;color:var(--gold2);border:1px solid rgba(241,213,138,.72)}.danger{background:#1a0505;color:#ffd4d4;border:1px solid #ff6b6b}.form-grid{display:grid;gap:.7rem}input,select,textarea{width:100%;border:1px solid var(--line);border-radius:.75rem;background:#050505;color:var(--text);padding:.75rem;font:inherit}label{display:grid;gap:.35rem;color:var(--gold2);font-weight:800}.toast{position:fixed;right:1rem;bottom:1rem;z-index:2000;max-width:min(24rem,calc(100vw - 2rem));padding:.85rem 1rem;border-radius:.85rem;background:#12351f;color:#d8ffe5;border:1px solid #2ecc71;box-shadow:0 16px 38px rgba(0,0,0,.45);font-weight:800}.toast.error{background:#3b1111;color:#ffd4d4;border-color:#ff6b6b}.coach-map-pin{display:inline-flex;width:1.15rem;height:1.15rem;border-radius:999px;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,.55)}.coach-map-pin.start{background:#2fd36b}.coach-map-pin.end{background:#ff6b6b}.coach-route-line{stroke-linecap:round;stroke-linejoin:round}
  .gps-card{border-color:rgba(142,230,168,.36);background:linear-gradient(180deg,rgba(142,230,168,.08),rgba(255,255,255,.035))}.gps-grid{display:grid;grid-template-columns:1fr 1fr;gap:.65rem}.gps-pill{border:1px solid rgba(142,230,168,.28);border-radius:.8rem;padding:.72rem;background:rgba(142,230,168,.05)}.gps-pill strong{display:block;color:var(--good);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em}.offroute{display:none;margin-top:.75rem;border:1px solid var(--danger);color:#ffd4d4;background:#2b0909;border-radius:.8rem;padding:.75rem;font-weight:800}.offroute.show{display:block}.driver-location-dot{position:relative;display:block;width:1.25rem;height:1.25rem;border-radius:50%;background:#2979ff;border:3px solid #fff;box-shadow:0 0 0 7px rgba(41,121,255,.22),0 4px 14px rgba(0,0,0,.45)}.driver-location-dot::before{content:'';position:absolute;left:50%;top:-.65rem;transform:translateX(-50%);border-left:.28rem solid transparent;border-right:.28rem solid transparent;border-bottom:.72rem solid #fff;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}.driver-location-dot::after{content:'';position:absolute;inset:-.65rem;border:1px solid rgba(41,121,255,.45);border-radius:50%;animation:pulse 1.5s infinite}@keyframes pulse{from{transform:scale(.65);opacity:.9}to{transform:scale(1.75);opacity:0}}
  .nav-card{border-color:rgba(158,208,255,.34);background:linear-gradient(180deg,rgba(158,208,255,.08),rgba(255,255,255,.035))}.nav-top{display:grid;gap:.75rem}.nav-instruction{border:1px solid rgba(158,208,255,.34);border-radius:1rem;background:rgba(158,208,255,.06);padding:1rem}.nav-label{display:block;color:var(--notice);font-size:.72rem;text-transform:uppercase;letter-spacing:.09em;font-weight:900}.nav-main{font-size:1.25rem;line-height:1.25;font-weight:900;margin-top:.25rem}.nav-meta{display:grid;grid-template-columns:1fr 1fr;gap:.65rem;margin-top:.75rem}.nav-bar{height:.6rem;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden;border:1px solid var(--line)}.nav-fill{height:100%;width:0;background:linear-gradient(90deg,var(--gold2),var(--gold));transition:width .25s}.event-log{max-height:9rem;overflow:auto;border:1px solid var(--line);border-radius:.75rem;padding:.7rem;background:rgba(0,0,0,.2);font-size:.88rem;color:var(--muted)}.event-log p{margin:.25rem 0}.instruction-current{border-color:rgba(241,213,138,.9)!important;background:rgba(214,173,82,.13)!important;color:var(--text)!important}.instruction-passed{opacity:.45}.next-marker{display:inline-grid;place-items:center;width:1.3rem;height:1.3rem;border-radius:999px;background:var(--notice);color:#06111f;font-weight:900}

  @media(min-width:920px){.content{grid-template-columns:1fr 1fr}.wide{grid-column:1/-1}#driverMap{height:64vh}}
  @media print{@page{size:A4 portrait;margin:10mm}header{position:static}.buttons,.form-grid,.toast{display:none!important}.content{display:block}.card{break-inside:avoid;margin-bottom:1rem}#driverMap{height:6in}}
</style>
</head>
<body>
<header>${logo}<div><div class="eyebrow">${escapeHtml(settings.companyName || 'Point 2 Point')} • Driver route</div><h1>${escapeHtml(title)}</h1><div class="muted">${escapeHtml(metresToMiles(route.summary?.lengthInMeters || 0))} miles • ${escapeHtml(secondsToText(route.summary?.travelTimeInSeconds || 0))} • <span class="status" id="statusBadge">${escapeHtml(record.status || 'approved')}</span></div></div></header>
<div id="driverMapShell" class="driver-map-shell">
  <div id="driverMap"></div>
  <div id="directionNote" class="direction-note">Direction-up map</div>
  <div class="driver-map-controls" aria-label="Live map controls">
    <button id="mapCenterBtn" class="secondary" type="button">Centre position</button>
    <button id="mapRecalcBtn" class="secondary" type="button">Recalculate</button>
    <button id="mapHeadingBtn" class="secondary active" type="button">Direction up</button>
    <button id="mapFullscreenBtn" class="secondary" type="button">Full screen</button>
    <button id="mapWakeLockBtn" class="secondary" type="button">Keep screen on</button>
    <button id="mapCompleteBtn" class="secondary" type="button">Complete route</button>
  </div>
</div>
<main class="content">
  <section class="card"><h2>Driver summary</h2><div class="stats"><div class="stat"><strong>Driver</strong>${escapeHtml(driver.name || 'Not assigned')}</div><div class="stat"><strong>Vehicle</strong>${escapeHtml(vehicle.name || 'Coach')}<br>${escapeHtml(vehicle.registration || '')}</div><div class="stat"><strong>Height</strong>${escapeHtml(vehicle.heightM || '')}m</div><div class="stat"><strong>Weight</strong>${Number(vehicle.weightKg || 0).toLocaleString()}kg</div></div><p class="muted"><strong>Operator notes:</strong> ${escapeHtml(record.operatorNotes || 'None')}</p><div class="buttons"><a class="button" href="${fullReportUrl}" target="_blank">Open route pack</a><button class="secondary" onclick="window.print()">Print</button><button id="completeBtn" class="button" type="button">Mark completed</button></div></section>
  <section class="card gps-card"><h2>Live GPS driver mode</h2><p class="muted">Shows your current location against the approved route. Keep using road signs and operator instructions.</p><div class="gps-grid"><div class="gps-pill"><strong>Status</strong><span id="gpsStatus">Not started</span></div><div class="gps-pill"><strong>Accuracy</strong><span id="gpsAccuracy">—</span></div><div class="gps-pill"><strong>Distance from route</strong><span id="gpsDistance">—</span></div><div class="gps-pill"><strong>Tracking</strong><span id="gpsTracking">Off</span></div></div><div id="offRouteAlert" class="offroute">You appear to be away from the approved route. Stop when safe and check with operations before continuing.</div><div class="buttons" style="margin-top:.8rem"><button id="startGpsBtn" type="button">Start live GPS</button><button id="centerGpsBtn" class="secondary" type="button" disabled>Centre on me</button><button id="stopGpsBtn" class="secondary" type="button" disabled>Stop GPS</button></div></section>
  <section class="card nav-card"><h2>Turn-by-turn guidance mode</h2><p class="muted">Uses live GPS to show the next route instruction. This is beta guidance, not a certified satnav.</p><div class="nav-top"><div class="nav-instruction"><span class="nav-label">Next instruction</span><div id="navCurrentInstruction" class="nav-main">Start live GPS to begin guidance.</div><div class="nav-meta"><div class="gps-pill"><strong>Distance to next</strong><span id="navDistanceToNext">—</span></div><div class="gps-pill"><strong>Route progress</strong><span id="navProgressText">0%</span></div><div class="gps-pill"><strong>Remaining distance</strong><span id="navRemainingDistance">—</span></div><div class="gps-pill"><strong>ETA remaining</strong><span id="navEtaRemaining">—</span></div></div></div><div class="nav-bar" aria-label="Route progress"><div id="navProgressFill" class="nav-fill"></div></div><div class="buttons"><button id="journeyStartBtn" type="button">Start journey</button><button id="nextInstructionBtn" class="secondary" type="button">Show next instruction</button><button id="recalcBtn" class="secondary" type="button">Recalculate route</button><button id="journeyCompleteBtn" class="secondary" type="button">Complete route</button></div><div id="driverEventLog" class="event-log"><p>Journey event log ready.</p></div></div></section>

  ${stopsHtml}
  <section class="card"><h2>Safety review</h2>${warningCards}</section>
  <section class="card wide"><h2>Report unsuitable road</h2><form id="driverReportForm" class="form-grid"><label>Road / location<input name="roadName" id="roadNameInput" placeholder="Example: narrow hotel approach" /></label><label>Issue type<select name="issueType"><option>Unsuitable road</option><option>Low bridge concern</option><option>Narrow road</option><option>Weight restriction concern</option><option>Tight turn</option><option>Coach access restriction</option><option>Other</option></select></label><label>Notes<textarea name="notes" rows="3" placeholder="Explain what happened or what needs checking."></textarea></label><input type="hidden" name="lat" id="reportLat"><input type="hidden" name="lng" id="reportLng"><input type="hidden" name="accuracyM" id="reportAccuracy"><div class="buttons"><button type="button" id="useGpsReportBtn" class="secondary">Use my GPS location</button><button type="submit">Submit road report</button></div></form></section>
  <section class="card wide"><p class="muted"><strong>Important:</strong> Turn-by-turn guidance mode is an aid only. Follow road signs, temporary restrictions, coach access signs and operator instructions at all times.</p></section>
</main>
<script>window.ROUTE_EXPORT_DATA=${jsonForHtml(route)};window.DRIVER_ROUTE_ID=${JSON.stringify(record.id)};</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
function toast(message,type){let t=document.createElement('div');t.className='toast '+(type||'');t.textContent=message;document.body.appendChild(t);setTimeout(()=>t.remove(),4200)}
let data=window.ROUTE_EXPORT_DATA;let routePoints=(data.points||[]);const map=L.map('driverMap',{zoomControl:true,preferCanvas:true,touchZoom:'center',scrollWheelZoom:true,doubleClickZoom:true,boxZoom:true,keyboard:true,dragging:true,tap:true}).setView([51.5072,-0.1276],10);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'&copy; OpenStreetMap contributors',detectRetina:true,crossOrigin:true}).addTo(map);const pin=(c)=>L.divIcon({className:'',html:'<span class="coach-map-pin '+c+'"></span>',iconSize:[22,22],iconAnchor:[11,11],popupAnchor:[0,-12]});let routeLine=null,startMarker=null,endMarker=null,waypointLayer=null,routeUpEnabled=true,currentMapBearing=null,previousGpsPoint=null;function fit(){if(routeLine){map.invalidateSize(true);map.fitBounds(routeLine.getBounds(),{padding:[34,34],maxZoom:15})}}function bearingBetween(a,b){if(!a||!b)return null;const toRad=(d)=>d*Math.PI/180,toDeg=(r)=>r*180/Math.PI;const lat1=toRad(a[0]),lat2=toRad(b[0]),dLng=toRad(b[1]-a[1]);const y=Math.sin(dLng)*Math.cos(lat2);const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);return (toDeg(Math.atan2(y,x))+360)%360}function routeInitialBearing(){if(!routePoints||routePoints.length<2)return null;const start=routePoints[0];for(let i=1;i<routePoints.length;i++){if(haversine(start,routePoints[i])>25)return bearingBetween(start,routePoints[i])}return bearingBetween(routePoints[0],routePoints[1])}function setMapBearing(deg){if(!Number.isFinite(deg))return;currentMapBearing=deg;const mapEl=document.getElementById('driverMap');mapEl?.style.setProperty('--map-rotation',(-deg).toFixed(1)+'deg');mapEl?.classList.toggle('route-up',routeUpEnabled);const note=document.getElementById('directionNote');if(note)note.textContent=routeUpEnabled?'Direction-up map '+Math.round(deg)+'°':'North-up map'}function updateRouteUpButton(){const btn=document.getElementById('mapHeadingBtn');if(btn){btn.classList.toggle('active',routeUpEnabled);btn.textContent=routeUpEnabled?'Direction up':'North up'}const mapEl=document.getElementById('driverMap');mapEl?.classList.toggle('route-up',routeUpEnabled);if(routeUpEnabled&&currentMapBearing===null)setMapBearing(routeInitialBearing()||0);if(!routeUpEnabled){const note=document.getElementById('directionNote');if(note)note.textContent='North-up map'}}function drawRouteOnMap(){if(routeLine)map.removeLayer(routeLine);if(startMarker)map.removeLayer(startMarker);if(endMarker)map.removeLayer(endMarker);if(waypointLayer)map.removeLayer(waypointLayer);routeLine=null;startMarker=null;endMarker=null;waypointLayer=null;if(routePoints.length){routeLine=L.polyline(routePoints,{weight:7,opacity:.9,className:'coach-route-line'}).addTo(map);startMarker=L.marker(routePoints[0],{icon:pin('start')}).bindPopup('Start: '+(data.origin?.label||'Start')).addTo(map);endMarker=L.marker(routePoints[routePoints.length-1],{icon:pin('end')}).bindPopup('Destination: '+(data.destination?.label||'Destination')).addTo(map);const wp=(data.waypoints||[]).filter(w=>Number.isFinite(Number(w.lat))&&Number.isFinite(Number(w.lon))).map((w,i)=>L.marker([Number(w.lat),Number(w.lon)],{icon:pin('stop')}).bindPopup('Stop '+(i+1)+': '+(w.label||'Planned stop')));if(wp.length)waypointLayer=L.layerGroup(wp).addTo(map);setMapBearing(routeInitialBearing()||0);[250,800,1400].forEach((d)=>setTimeout(fit,d));}}drawRouteOnMap();updateRouteUpButton();window.addEventListener('resize',fit)
let watchId=null,currentGps=null,driverMarker=null,accuracyCircle=null,followDriver=false,journeyStarted=false,currentInstructionIndex=0,lastLoggedInstruction=-1,wakeLock=null;const gpsIcon=L.divIcon({className:'driver-location-marker',html:'<span class="driver-location-dot"></span>',iconSize:[28,28],iconAnchor:[14,14]});
function syncMapControlStates(){const wakeBtn=document.getElementById('mapWakeLockBtn');if(wakeBtn){wakeBtn.classList.toggle('active',!!wakeLock);wakeBtn.textContent=wakeLock?'Screen stays on':'Keep screen on'}const fullBtn=document.getElementById('mapFullscreenBtn');if(fullBtn){fullBtn.textContent=document.fullscreenElement?'Exit full screen':'Full screen'}updateRouteUpButton()}
async function requestWakeLock(){if(!('wakeLock' in navigator)){toast('Screen wake lock is not supported in this browser. Keep your device display settings active for this journey.','error');return}try{wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null;syncMapControlStates();logEvent('Screen wake lock released.')});syncMapControlStates();toast('Screen will stay awake while this page is visible.','success');postJourneyEvent('screen_wake_lock_enabled','Driver enabled keep-screen-on mode.',{})}catch(err){toast('Could not keep screen awake: '+(err.message||'permission denied'),'error')}}
async function toggleWakeLock(){if(wakeLock){try{await wakeLock.release()}catch(e){}wakeLock=null;syncMapControlStates();postJourneyEvent('screen_wake_lock_disabled','Driver disabled keep-screen-on mode.',{});return}await requestWakeLock()}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&wakeLock===null&&document.getElementById('mapWakeLockBtn')?.classList.contains('active'))requestWakeLock()});
document.addEventListener('fullscreenchange',()=>{setTimeout(()=>{map.invalidateSize(true);if(currentGps&&followDriver){map.setView([currentGps.lat,currentGps.lng],Math.max(map.getZoom(),16),{animate:false})}else{fit()}syncMapControlStates()},160)});

let instructions=(data.instructions||[]).map((i,idx)=>({index:idx,instruction:i.instruction||'Continue',street:i.street||'',distanceM:Number(i.distanceM||0),travelTimeSeconds:Number(i.travelTimeSeconds||0)})).sort((a,b)=>a.distanceM-b.distanceM);
let totalRouteM=Number(data.summary?.lengthInMeters||0);let totalTravelS=Number(data.summary?.travelTimeInSeconds||0);
function setText(id,value){const el=document.getElementById(id);if(el)el.textContent=value}
function haversine(a,b){const R=6371000;const toRad=(d)=>d*Math.PI/180;const dLat=toRad(b[0]-a[0]);const dLng=toRad(b[1]-a[1]);const lat1=toRad(a[0]);const lat2=toRad(b[0]);const x=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function projectAround(p,origin){const R=6371000;const lat=origin[0]*Math.PI/180;return {x:(p[1]-origin[1])*Math.PI/180*Math.cos(lat)*R,y:(p[0]-origin[0])*Math.PI/180*R}}
function distToSeg(p,a,b){const P=projectAround(p,p),A=projectAround(a,p),B=projectAround(b,p);const dx=B.x-A.x,dy=B.y-A.y;const len=dx*dx+dy*dy;if(!len)return haversine(p,a);let t=((P.x-A.x)*dx+(P.y-A.y)*dy)/len;t=Math.max(0,Math.min(1,t));const x=A.x+t*dx,y=A.y+t*dy;return Math.hypot(P.x-x,P.y-y)}
function distanceFromRoute(p,pts){if(!pts||pts.length<2)return null;let best=Infinity;for(let i=0;i<pts.length-1;i++){const d=distToSeg(p,pts[i],pts[i+1]);if(d<best)best=d}return best}
function buildRouteMeasures(pts){let cum=[0];for(let i=1;i<pts.length;i++){cum[i]=cum[i-1]+haversine(pts[i-1],pts[i])}return cum}
let routeMeasures=buildRouteMeasures(routePoints);
function nearestRouteProgressM(p,pts){if(!pts||pts.length<2)return 0;let best=Infinity,bestM=0;for(let i=0;i<pts.length-1;i++){const P=projectAround(p,p),A=projectAround(pts[i],p),B=projectAround(pts[i+1],p);const dx=B.x-A.x,dy=B.y-A.y,len=dx*dx+dy*dy;let t=len?((P.x-A.x)*dx+(P.y-A.y)*dy)/len:0;t=Math.max(0,Math.min(1,t));const x=A.x+t*dx,y=A.y+t*dy;const d=Math.hypot(P.x-x,P.y-y);if(d<best){best=d;bestM=(routeMeasures[i]||0)+t*haversine(pts[i],pts[i+1])}}return bestM}
function metersText(m){m=Number(m||0);return m>=1609?((m/1609.344).toFixed(1)+' miles'):(Math.max(0,Math.round(m))+'m')}
function timeText(sec){sec=Math.max(0,Math.round(Number(sec||0)));const mins=Math.round(sec/60);const h=Math.floor(mins/60),m=mins%60;return h?(h+'h '+m+'m'):(m+'m')}
function logEvent(msg){const box=document.getElementById('driverEventLog');if(!box)return;const p=document.createElement('p');p.textContent=new Date().toLocaleTimeString()+': '+msg;box.prepend(p)}
function updateInstructionHighlight(idx){document.querySelectorAll('#instructionList li').forEach((el,i)=>{el.classList.toggle('instruction-current',i===idx);el.classList.toggle('instruction-passed',i<idx)})}
function updateGuidance(progressM,offRouteM){const routeTotal=totalRouteM || routeMeasures[routeMeasures.length-1] || 0;let idx=instructions.findIndex((ins)=>Number(ins.distanceM||0)>progressM+20);if(idx<0)idx=Math.max(0,instructions.length-1);currentInstructionIndex=idx;const ins=instructions[idx]||{instruction:'Continue on approved route',distanceM:progressM};const distToNext=Math.max(0,Number(ins.distanceM||0)-progressM);const progressPct=routeTotal?Math.min(100,Math.max(0,(progressM/routeTotal)*100)):0;const remainingM=Math.max(0,routeTotal-progressM);const remainingS=routeTotal&&totalTravelS?totalTravelS*(remainingM/routeTotal):0;setText('navCurrentInstruction',ins.instruction);setText('navDistanceToNext',metersText(distToNext));setText('navProgressText',Math.round(progressPct)+'%');setText('navRemainingDistance',metersText(remainingM));setText('navEtaRemaining',timeText(remainingS));const fill=document.getElementById('navProgressFill');if(fill)fill.style.width=progressPct.toFixed(1)+'%';updateInstructionHighlight(idx);if(journeyStarted&&idx!==lastLoggedInstruction){lastLoggedInstruction=idx;logEvent('Next instruction: '+ins.instruction)}if(offRouteM>250){logEvent('Off-route warning: approx '+Math.round(offRouteM)+'m from approved route.');const now=Date.now();if(now-lastOffRouteSentAt>120000){lastOffRouteSentAt=now;postJourneyEvent('off_route_warning','Driver is approx '+Math.round(offRouteM)+'m from the approved route.',{distanceM:Math.round(offRouteM)})}}}

function updateReportGpsFields(){if(!currentGps)return;document.getElementById('reportLat').value=currentGps.lat.toFixed(7);document.getElementById('reportLng').value=currentGps.lng.toFixed(7);document.getElementById('reportAccuracy').value=Math.round(currentGps.accuracy||0)}
function onGps(pos){const lat=pos.coords.latitude,lng=pos.coords.longitude,acc=pos.coords.accuracy||0;const ll=[lat,lng];let heading=Number(pos.coords.heading);if(!Number.isFinite(heading)&&previousGpsPoint&&haversine(previousGpsPoint,ll)>6){heading=bearingBetween(previousGpsPoint,ll)}previousGpsPoint=ll;currentGps={lat,lng,accuracy:acc,heading:Number.isFinite(heading)?heading:currentMapBearing,when:new Date()};if(Number.isFinite(heading)&&routeUpEnabled)setMapBearing(heading);if(!driverMarker){driverMarker=L.marker(ll,{icon:gpsIcon,zIndexOffset:1000}).bindPopup('Your current position').addTo(map)}else{driverMarker.setLatLng(ll)}const markerEl=driverMarker?.getElement?.();if(markerEl&&Number.isFinite(currentGps.heading))markerEl.style.setProperty('--driver-heading',currentGps.heading.toFixed(1)+'deg');if(accuracyCircle){accuracyCircle.setLatLng(ll).setRadius(acc)}else{accuracyCircle=L.circle(ll,{radius:acc,weight:1,opacity:.45,fillOpacity:.08}).addTo(map)}setText('gpsStatus','Active');setText('gpsTracking','On');setText('gpsAccuracy',Math.round(acc)+'m');const dist=distanceFromRoute(ll,routePoints);const alert=document.getElementById('offRouteAlert');const progressM=nearestRouteProgressM(ll,routePoints);if(dist!==null&&Number.isFinite(dist)){setText('gpsDistance',Math.round(dist)+'m');if(dist>250){alert?.classList.add('show')}else{alert?.classList.remove('show')}updateGuidance(progressM,dist)}if(followDriver){map.setView(ll,Math.max(map.getZoom(),16),{animate:true})}updateReportGpsFields()}
function onGpsError(err){setText('gpsStatus',err.message||'Location unavailable');toast('GPS error: '+(err.message||'location unavailable'),'error')}
document.getElementById('startGpsBtn')?.addEventListener('click',()=>{if(!navigator.geolocation){toast('This browser does not support GPS location.','error');return}followDriver=true;setText('gpsStatus','Requesting permission…');watchId=navigator.geolocation.watchPosition(onGps,onGpsError,{enableHighAccuracy:true,maximumAge:3000,timeout:15000});document.getElementById('startGpsBtn').disabled=true;document.getElementById('centerGpsBtn').disabled=false;document.getElementById('stopGpsBtn').disabled=false;postJourneyEvent('gps_started','Driver started live GPS tracking.',{})});
document.getElementById('centerGpsBtn')?.addEventListener('click',()=>{if(currentGps){followDriver=true;map.setView([currentGps.lat,currentGps.lng],16,{animate:true});toast('Map centred on your location.','success')}else{toast('Start GPS first.','error')}});
document.getElementById('mapCenterBtn')?.addEventListener('click',()=>document.getElementById('centerGpsBtn')?.click());
document.getElementById('mapRecalcBtn')?.addEventListener('click',()=>document.getElementById('recalcBtn')?.click());
document.getElementById('mapHeadingBtn')?.addEventListener('click',()=>{routeUpEnabled=!routeUpEnabled;updateRouteUpButton();if(routeUpEnabled)setMapBearing((currentGps&&Number.isFinite(currentGps.heading)?currentGps.heading:routeInitialBearing())||0);toast(routeUpEnabled?'Direction-up map enabled.':'North-up map enabled.','success')});
document.getElementById('mapFullscreenBtn')?.addEventListener('click',async()=>{try{const shell=document.getElementById('driverMapShell');if(document.fullscreenElement){await document.exitFullscreen()}else if(shell?.requestFullscreen){await shell.requestFullscreen()}else{toast('Full screen is not supported on this browser.','error')}}catch(err){toast('Could not change full screen mode.','error')}});
document.getElementById('mapWakeLockBtn')?.addEventListener('click',toggleWakeLock);syncMapControlStates();

document.getElementById('stopGpsBtn')?.addEventListener('click',()=>{if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null}followDriver=false;setText('gpsTracking','Off');setText('gpsStatus','Stopped');document.getElementById('startGpsBtn').disabled=false;document.getElementById('stopGpsBtn').disabled=true;postJourneyEvent('gps_stopped','Driver stopped live GPS tracking.',{})});
document.getElementById('useGpsReportBtn')?.addEventListener('click',()=>{if(!currentGps){toast('Start GPS first, then tap this again.','error');return}updateReportGpsFields();document.getElementById('roadNameInput').value='GPS: '+currentGps.lat.toFixed(6)+', '+currentGps.lng.toFixed(6);toast('GPS position attached to report.','success')});
document.getElementById('journeyStartBtn')?.addEventListener('click',()=>{journeyStarted=true;followDriver=true;document.getElementById('journeyStartBtn').textContent='Journey in progress';document.getElementById('journeyStartBtn').disabled=true;logEvent('Journey started.');postJourneyEvent('journey_started','Driver tapped Start journey.',currentGps?{lat:currentGps.lat,lng:currentGps.lng,accuracyM:Math.round(currentGps.accuracy||0)}:{});if(!currentGps)toast('Start live GPS to enable automatic turn guidance.','error')});
document.getElementById('nextInstructionBtn')?.addEventListener('click',()=>{const ins=instructions[currentInstructionIndex]||instructions[0];if(ins){toast(ins.instruction,'success');logEvent('Instruction viewed: '+ins.instruction)}else{toast('No guidance instruction available.','error')}});
function rebuildInstructionList(){const list=document.getElementById('instructionList');if(!list)return;list.innerHTML='';const rows=instructions.length?instructions:[{instruction:'No guidance returned.'}];rows.forEach((ins,idx)=>{const li=document.createElement('li');const sp=document.createElement('span');sp.textContent=String(idx+1);li.appendChild(sp);li.appendChild(document.createTextNode(ins.instruction||'Continue'));list.appendChild(li)})}
function applyReroute(newRoute){data=newRoute||data;routePoints=(data.points||[]);instructions=(data.instructions||[]).map((i,idx)=>({index:idx,instruction:i.instruction||'Continue',street:i.street||'',distanceM:Number(i.distanceM||0),travelTimeSeconds:Number(i.travelTimeSeconds||0)})).sort((a,b)=>a.distanceM-b.distanceM);totalRouteM=Number(data.summary?.lengthInMeters||0);totalTravelS=Number(data.summary?.travelTimeInSeconds||0);routeMeasures=buildRouteMeasures(routePoints);currentInstructionIndex=0;lastLoggedInstruction=-1;drawRouteOnMap();rebuildInstructionList();if(routeUpEnabled)setMapBearing((currentGps&&Number.isFinite(currentGps.heading)?currentGps.heading:routeInitialBearing())||0);if(currentGps){const ll=[currentGps.lat,currentGps.lng];const dist=distanceFromRoute(ll,routePoints)||0;const progressM=nearestRouteProgressM(ll,routePoints);updateGuidance(progressM,dist)}else{updateGuidance(0,0)}fit()}
document.getElementById('recalcBtn')?.addEventListener('click',async()=>{const btn=document.getElementById('recalcBtn');if(!currentGps){toast('Start live GPS first so the app can reroute from your current position.','error');return}btn.disabled=true;const oldText=btn.textContent;btn.textContent='Recalculating…';try{const r=await fetch('/driver/route/'+encodeURIComponent(window.DRIVER_ROUTE_ID)+'/reroute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:currentGps.lat,lng:currentGps.lng,accuracyM:currentGps.accuracy})});const payload=await r.json();if(!r.ok)throw new Error(payload.error||'Could not recalculate route.');applyReroute(payload.route);toast('Coach-safe route recalculated from your GPS position.','success');logEvent('Coach-safe reroute calculated from driver GPS.')}catch(err){toast(err.message,'error');logEvent('Reroute failed: '+err.message)}finally{btn.disabled=false;btn.textContent=oldText}});
if(instructions.length){updateGuidance(0,0)}
document.getElementById('completeBtn')?.addEventListener('click',async()=>{const btn=document.getElementById('completeBtn');btn.disabled=true;btn.textContent='Marking complete…';try{const r=await fetch('/driver/route/'+encodeURIComponent(window.DRIVER_ROUTE_ID)+'/complete',{method:'POST'});const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not mark route completed.');document.getElementById('statusBadge').textContent='completed';toast('Route marked as completed.','success');logEvent('Journey completed.');btn.textContent='Completed';}catch(e){toast(e.message,'error');btn.disabled=false;btn.textContent='Mark completed';}});
document.getElementById('mapCompleteBtn')?.addEventListener('click',()=>document.getElementById('completeBtn')?.click());
document.getElementById('journeyCompleteBtn')?.addEventListener('click',()=>document.getElementById('completeBtn')?.click());
document.getElementById('driverReportForm')?.addEventListener('submit',async(e)=>{e.preventDefault();const form=e.currentTarget;updateReportGpsFields();const payload=Object.fromEntries(new FormData(form));try{const r=await fetch('/driver/route/'+encodeURIComponent(window.DRIVER_ROUTE_ID)+'/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not save report.');form.reset();toast('Road report sent to operations.','success');logEvent('Road report sent to operations.');}catch(err){toast(err.message,'error');}});
</script>
</body>
</html>`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function metresToMiles(m) {
  return ((Number(m) || 0) / 1609.344).toFixed(1);
}

function secondsToText(seconds) {
  const mins = Math.round((Number(seconds) || 0) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildRouteReportHtml(record) {
  const route = record.route || {};
  const title = `${route.origin?.label || 'Start'} to ${route.destination?.label || 'Destination'}`;
  const warningCards = (route.warnings || []).map((w) => `
    <article class="warning ${escapeHtml(w.level || 'notice')}">
      <strong>${escapeHtml(w.title || 'Route note')}</strong>
      <p>${escapeHtml(w.message || '')}</p>
    </article>`).join('') || '<p class="muted">No warnings returned.</p>';
  const instructionItems = (route.instructions || []).map((i) => `<li>${escapeHtml(i.instruction || 'Continue')}</li>`).join('') || '<li>No guidance returned.</li>';
  const driver = record.driver?.name || 'Not assigned';
  const vehicle = route.vehicle || {};
  const stops = Array.isArray(route.waypoints) ? route.waypoints : [];
  const stopsSummary = stops.length ? `<h3>Planned stops</h3><ol>${stops.map((stop, index) => `<li>${index + 1}. ${escapeHtml(stop.label || `Stop ${index + 1}`)}</li>`).join('')}</ol>` : '';
  const liveRouteUrl = `/driver/route/${escapeHtml(record.id || '')}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Coach Route Report - ${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  :root{--bg:#070707;--panel:#111;--gold:#d6ad52;--gold2:#f1d58a;--text:#f7f3e8;--muted:#b7aa8a;--line:rgba(214,173,82,.28);--danger:#ff6b6b;--warn:#ffd166;--notice:#9ed0ff;--good:#8ee6a8}
  *{box-sizing:border-box} body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:linear-gradient(135deg,#050505,#141414 65%,#1b160b);color:var(--text)}
  .live-nav-bar{position:sticky;top:0;z-index:5000;display:flex;justify-content:space-between;align-items:center;gap:.75rem;padding:.75rem 1rem;background:rgba(7,7,7,.96);border-bottom:1px solid var(--line);box-shadow:0 10px 30px rgba(0,0,0,.35)}.live-nav-bar a{border-radius:999px;padding:.75rem 1rem;font-weight:900;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#151006;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}.live-nav-bar span{color:var(--muted);font-size:.92rem}
  header{padding:1rem 1.25rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:1rem;align-items:flex-end}.eyebrow{color:var(--gold2);text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;margin-bottom:.25rem}h1{margin:.1rem 0;font-size:clamp(1.35rem,2.5vw,2.4rem)}p{margin-top:0}.muted,.meta{color:var(--muted)}
  .route-layout{display:grid;grid-template-columns:minmax(0,1fr) 26rem;gap:1rem;padding:1rem}.map-wrap,.panel{border:1px solid var(--line);background:rgba(17,17,17,.92);border-radius:1rem;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)}#exportMap{height:72vh;min-height:34rem;width:100%;background:#101418}.map-note{padding:.75rem 1rem;color:var(--muted);border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:1rem}.panel{padding:1rem;max-height:calc(72vh + 3.1rem);overflow:auto}.stats{display:grid;grid-template-columns:1fr 1fr;gap:.65rem;margin:1rem 0}.stat,.warning,.approval{border:1px solid var(--line);border-radius:.85rem;padding:.8rem;background:rgba(255,255,255,.035)}.stat strong{display:block;color:var(--gold2)}.risk{font-size:2.1rem;font-weight:900;color:var(--gold2)}.warning{margin-bottom:.65rem}.warning p{color:var(--muted);margin-bottom:0}.warning.high strong{color:var(--danger)}.warning.medium strong{color:var(--warn)}.warning.notice strong{color:var(--notice)}ol{padding-left:1.25rem;color:var(--muted)}li{margin-bottom:.45rem}.buttons{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.75rem}.button,button{border:0;border-radius:.7rem;padding:.7rem .9rem;font-weight:800;cursor:pointer;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#151006;text-decoration:none;display:inline-block}.secondary{background:rgba(255,255,255,.07);color:var(--gold2);border:1px solid var(--line)}.coach-map-pin{display:inline-flex;width:1.15rem;height:1.15rem;border-radius:999px;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,.55)}.coach-map-pin.start{background:#2fd36b}.coach-map-pin.end{background:#ff6b6b}.coach-route-line{stroke-linecap:round;stroke-linejoin:round}.brand{font-weight:900;color:var(--gold2)}
  @media(max-width:980px){.route-layout{grid-template-columns:1fr}.panel{max-height:none}#exportMap{height:65vh}}
  @media print{@page{size:A4 landscape;margin:10mm}html,body{width:auto;height:auto;overflow:visible;background:white!important;color:#111!important}header{padding:0 0 .35rem 0;border-bottom:1px solid #ddd;display:block;color:#111!important}h1{font-size:18pt;line-height:1.15;margin:.05rem 0}.eyebrow{color:#555!important}.meta,.muted,.map-note{color:#333!important}.route-layout{display:block;padding:0}.map-wrap{width:100%;margin:0 auto;border:1px solid #ccc;border-radius:0;box-shadow:none;overflow:hidden;page-break-inside:avoid;break-inside:avoid;background:white}#exportMap{width:100%!important;height:6.85in!important;min-height:0!important;max-height:none!important;display:block;background:#fff}.leaflet-container{width:100%!important}.map-note{padding:.35rem .5rem;border-top:1px solid #ddd;font-size:9pt}.panel{margin-top:1rem;padding:.75rem;max-height:none;page-break-before:always;break-before:page;border:1px solid #ccc;border-radius:0;box-shadow:none;background:white;color:#111!important}.stat,.warning,.approval{border-color:#ccc;background:white}.brand,.eyebrow,.stat strong{color:#111!important}ol,li{color:#111!important}.buttons,button,.live-nav-bar{display:none!important}}
</style>
</head>
<body>
<div class="live-nav-bar"><a href="${liveRouteUrl}">← Back to live route</a><span>Driver route pack</span></div>
<header>
  <div><div class="eyebrow">Coach Safe Route Planner</div><h1>${escapeHtml(title)}</h1><div class="meta"><span class="brand">Point 2 Point</span> • Approved route report • ${escapeHtml(record.status || 'approved')}</div></div>
  <div class="buttons"><a class="button" href="${liveRouteUrl}">Live route</a><button onclick="fitRouteForPrint()">Fit route</button><button onclick="window.print()">Print / Save PDF</button></div>
</header>
<main class="route-layout">
  <section class="map-wrap"><div id="exportMap"></div><div class="map-note"><span>Use + / − or pinch to zoom. Drag the map to inspect roads and junctions.</span><span>Created ${escapeHtml(new Date(record.createdAt).toLocaleString())}</span></div></section>
  <aside class="panel">
    <h2>Approval summary</h2>
    <div class="approval"><strong>Assigned driver:</strong> ${escapeHtml(driver)}<br><strong>Operator notes:</strong> ${escapeHtml(record.operatorNotes || 'None')}<br><strong>Route ID:</strong> ${escapeHtml(record.id || '')}<div class="buttons"><a class="button" href="${liveRouteUrl}">Back to live route</a></div></div>
    <div class="stats">
      <div class="stat"><strong>Distance</strong>${escapeHtml(metresToMiles(route.summary?.lengthInMeters))} miles</div>
      <div class="stat"><strong>Time</strong>${escapeHtml(secondsToText(route.summary?.travelTimeInSeconds))}</div>
      <div class="stat"><strong>Vehicle</strong>${escapeHtml(vehicle.name || 'Coach')}<br>${escapeHtml(vehicle.registration || '')}</div>
      <div class="stat"><strong>Dimensions</strong>${escapeHtml(vehicle.heightM)}m H • ${escapeHtml(vehicle.widthM)}m W • ${escapeHtml(vehicle.lengthM)}m L • ${Number(vehicle.weightKg || 0).toLocaleString()}kg</div>
    </div>
    <h2>Route risk score</h2>
    <div class="approval"><div class="risk">${escapeHtml(risk.score)} / 100</div><strong>${escapeHtml(risk.level)} risk</strong><p class="muted">${escapeHtml(risk.recommendation)}</p></div>
    <h2>Safety review</h2>${warningCards}
    <h2>Guidance preview</h2><ol>${instructionItems}</ol>
    <p class="muted"><strong>Important:</strong> This report supports route planning only. Drivers must follow road signs, temporary restrictions and operator approval.</p>
  </aside>
</main>
<script>window.ROUTE_EXPORT_DATA=${jsonForHtml(route)};</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const data=window.ROUTE_EXPORT_DATA;
  const map=L.map('exportMap',{zoomControl:true,preferCanvas:true,touchZoom:'center',scrollWheelZoom:true,doubleClickZoom:true,boxZoom:true,keyboard:true,dragging:true,tap:true}).setView([51.5072,-0.1276],10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors',detectRetina:true,crossOrigin:true}).addTo(map);
  const pin=(className)=>L.divIcon({className:'',html:'<span class="coach-map-pin '+className+'"></span>',iconSize:[22,22],iconAnchor:[11,11],popupAnchor:[0,-12]});
  window.routeLine=L.polyline(data.points||[],{weight:7,opacity:.9,className:'coach-route-line'}).addTo(map);
  const routeBounds=routeLine.getBounds();
  function fitExportMap(){if(!(data.points||[]).length)return;map.invalidateSize(true);requestAnimationFrame(()=>map.fitBounds(routeBounds,{padding:[36,36],maxZoom:14,animate:false}))}
  window.fitRouteForPrint=fitExportMap;
  if((data.points||[]).length){L.marker(data.points[0],{icon:pin('start')}).bindPopup('Start: '+(data.origin?.label||'Start')).addTo(map);(data.waypoints||[]).forEach((w,i)=>{if(Number.isFinite(Number(w.lat))&&Number.isFinite(Number(w.lon)))L.marker([Number(w.lat),Number(w.lon)],{icon:pin('stop')}).bindPopup('Stop '+(i+1)+': '+(w.label||'Planned stop')).addTo(map)});L.marker(data.points[data.points.length-1],{icon:pin('end')}).bindPopup('Destination: '+(data.destination?.label||'Destination')).addTo(map);[250,800,1500].forEach((delay)=>setTimeout(fitExportMap,delay))}
  window.addEventListener('beforeprint',()=>{fitExportMap();setTimeout(fitExportMap,350)});if(window.matchMedia){const mq=window.matchMedia('print');if(mq.addEventListener)mq.addEventListener('change',(event)=>{if(event.matches){fitExportMap();setTimeout(fitExportMap,350)}})}
</script>
</body>
</html>`;
}



function toApiStatus(value = 'APPROVED') {
  return String(value || 'APPROVED').toLowerCase();
}

function toDbStatus(value = 'approved') {
  const status = String(value || 'approved').toUpperCase();
  return ['DRAFT', 'APPROVED', 'ASSIGNED', 'COMPLETED'].includes(status) ? status : 'APPROVED';
}


function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function jsonBase64Url(value) {
  return base64Url(JSON.stringify(value));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 120000;
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 64, 'sha512').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash = '') {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isFinite(iterations) || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 64, 'sha512').toString('hex');
  return safeEqual(actual, expected);
}

function signToken(payload = {}) {
  const tokenPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (AUTH_TOKEN_HOURS * 60 * 60)
  };
  const body = jsonBase64Url(tokenPayload);
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token = '') {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) throw new Error('Missing token.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) throw new Error('Invalid token signature.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Session expired.');
  return payload;
}

function publicUser(row = {}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: String(row.role || 'DISPATCHER').toLowerCase(),
    companyId: row.companyId
  };
}

async function getUserFromRequest(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const payload = verifyToken(token);
  const result = await dbRequired().query('SELECT * FROM "User" WHERE id=$1 AND "companyId"=$2', [payload.sub, payload.companyId]);
  if (!result.rows.length) throw new Error('User not found.');
  return publicUser(result.rows[0]);
}

async function requireAuth(req, res, next) {
  try {
    req.user = await getUserFromRequest(req);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Please sign in again.' });
  }
}

function isPublicApiRequest(req) {
  if (req.path === '/auth/login') return true;
  if (req.path === '/health') return true;
  if (req.path === '/test-provider') return true;
  if (req.path === '/presets' && req.method === 'GET') return true;
  if (req.path === '/settings' && req.method === 'GET') return true;
  return false;
}

async function ensureCompany() {
  if (cachedCompanyId) return cachedCompanyId;
  const db = dbRequired();
  let result = await db.query('SELECT * FROM "Company" ORDER BY "createdAt" ASC LIMIT 1');
  if (!result.rows.length) {
    result = await db.query(
      'INSERT INTO "Company" (id, name, "brandingName", "logoUrl", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING *',
      [id('company'), DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_NAME, '']
    );
  }
  cachedCompanyId = result.rows[0].id;
  await ensureJourneyEventTable();
  await ensureSeedData(cachedCompanyId);
  return cachedCompanyId;
}

async function ensureJourneyEventTable() {
  const db = dbRequired();
  await db.query(`
    CREATE TABLE IF NOT EXISTS "JourneyEvent" (
      id TEXT PRIMARY KEY,
      "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
      "routeId" TEXT NOT NULL REFERENCES "Route"(id) ON DELETE CASCADE,
      "driverId" TEXT NULL REFERENCES "Driver"(id) ON DELETE SET NULL,
      "eventType" TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      metadata JSONB NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS "JourneyEvent_company_route_created_idx" ON "JourneyEvent" ("companyId", "routeId", "createdAt" DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS "JourneyEvent_company_created_idx" ON "JourneyEvent" ("companyId", "createdAt" DESC)');
}

async function logJourneyEvent(companyId, routeId, eventType, message, metadata = {}) {
  try {
    if (!companyId || !routeId) return;
    const route = await dbRequired().query('SELECT id,"driverId" FROM "Route" WHERE id=$1 AND "companyId"=$2', [routeId, companyId]);
    if (!route.rows.length) return;
    await dbRequired().query(
      'INSERT INTO "JourneyEvent" (id,"companyId","routeId","driverId","eventType",message,metadata,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())',
      [id('event'), companyId, routeId, route.rows[0].driverId || null, String(eventType || 'event').slice(0, 80), String(message || '').slice(0, 400), JSON.stringify(metadata || {})]
    );
  } catch (error) {
    console.error('Journey event log failed:', error.message);
  }
}

function apiJourneyEvent(row = {}) {
  return {
    id: row.id,
    routeId: row.routeId || '',
    driverId: row.driverId || '',
    driverName: row.driverName || '',
    eventType: row.eventType || 'event',
    message: row.message || '',
    metadata: row.metadata || {},
    createdAt: row.createdAt
  };
}

async function ensureSeedData(companyId) {
  const db = dbRequired();
  const vehicles = await db.query('SELECT COUNT(*)::int AS count FROM "Vehicle" WHERE "companyId"=$1', [companyId]);
  if (!vehicles.rows[0].count) {
    const demo = [
      cleanSavedVehicle({ name: 'P2P Standard Coach', registration: 'DEMO-57', preset: 'standard', notes: 'Demo 49–57 seat vehicle profile.' }),
      cleanSavedVehicle({ name: 'P2P Double Decker', registration: 'DEMO-DD', preset: 'doubleDecker', notes: 'Demo high vehicle profile.' })
    ];
    for (const v of demo) {
      await db.query(
        'INSERT INTO "Vehicle" (id,"companyId",registration,name,"coachType","heightM","widthM","lengthM","weightKg","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())',
        [v.id, companyId, v.registration, v.name, v.preset, v.heightM, v.widthM, v.lengthM, v.weightKg]
      );
    }
  }
  const drivers = await db.query('SELECT COUNT(*)::int AS count FROM "Driver" WHERE "companyId"=$1', [companyId]);
  if (!drivers.rows[0].count) {
    const d = cleanDriver({ name: 'Demo Driver', base: 'London', notes: 'Sample driver record. Replace with your team.' });
    await db.query(
      'INSERT INTO "Driver" (id,"companyId",name,phone,email,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW(),NOW())',
      [d.id, companyId, d.name, d.phone, d.email]
    );
  }
  const users = await db.query('SELECT COUNT(*)::int AS count FROM "User" WHERE "companyId"=$1', [companyId]);
  if (!users.rows[0].count) {
    await db.query(
      'INSERT INTO "User" (id,"companyId",name,email,"passwordHash",role,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())',
      [id('user'), companyId, 'Point 2 Point Admin', ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD), 'ADMIN']
    );
    console.log(`Seeded default admin user: ${ADMIN_EMAIL}. Change ADMIN_PASSWORD in Render before inviting real users.`);
  } else if (RESET_ADMIN_PASSWORD) {
    const existing = await db.query('SELECT id FROM "User" WHERE email=$1 AND "companyId"=$2 LIMIT 1', [ADMIN_EMAIL, companyId]);
    if (existing.rows.length) {
      await db.query('UPDATE "User" SET "passwordHash"=$1, role=$2, "updatedAt"=NOW() WHERE id=$3 AND "companyId"=$4', [hashPassword(ADMIN_PASSWORD), 'ADMIN', existing.rows[0].id, companyId]);
      console.log(`RESET_ADMIN_PASSWORD=true: updated admin password for ${ADMIN_EMAIL}. Set it back to false after login works.`);
    } else {
      await db.query(
        'INSERT INTO "User" (id,"companyId",name,email,"passwordHash",role,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())',
        [id('user'), companyId, 'Point 2 Point Admin', ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD), 'ADMIN']
      );
      console.log(`RESET_ADMIN_PASSWORD=true: created admin user ${ADMIN_EMAIL}. Set it back to false after login works.`);
    }
  }
}

function companyToSettings(row = {}) {
  return cleanSettings({
    companyName: row.brandingName || row.name || DEFAULT_COMPANY_NAME,
    appName: DEFAULT_APP_NAME,
    accentName: DEFAULT_DB.settings.accentName,
    logoDataUrl: row.logoUrl || ''
  });
}

function apiVehicle(row = {}) {
  return {
    id: row.id,
    name: row.name,
    registration: row.registration || '',
    preset: row.coachType || 'standard',
    heightM: Number(row.heightM || 0),
    widthM: Number(row.widthM || 0),
    lengthM: Number(row.lengthM || 0),
    weightKg: Number(row.weightKg || 0),
    maxSpeedKmh: 90,
    notes: '',
    createdAt: row.createdAt
  };
}

function apiDriver(row = {}) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    email: row.email || '',
    base: '',
    notes: '',
    createdAt: row.createdAt
  };
}

function apiReport(row = {}) {
  return {
    id: row.id,
    routeId: row.routeId || '',
    roadName: row.location || '',
    issueType: row.issueType || 'Unsuitable road',
    notes: row.notes || '',
    lat: null,
    lon: null,
    createdAt: row.createdAt
  };
}

function apiRoute(row = {}) {
  const route = row.routeGeometry || {};
  const driver = row.driverId ? apiDriver({ id: row.driverId, name: row.driverName, phone: row.driverPhone, email: row.driverEmail }) : null;
  const vehicleRecord = row.vehicleId ? apiVehicle({ id: row.vehicleId, name: row.vehicleName, registration: row.vehicleRegistration, coachType: row.vehicleCoachType, heightM: row.vehicleHeightM, widthM: row.vehicleWidthM, lengthM: row.vehicleLengthM, weightKg: row.vehicleWeightKg }) : null;
  return {
    id: row.id,
    status: toApiStatus(row.status),
    origin: row.startAddress || route.origin?.label || 'Start',
    destination: row.destinationAddress || route.destination?.label || 'Destination',
    driverId: row.driverId || '',
    driver,
    vehicleDatabaseId: row.vehicleId || '',
    vehicleRecord,
    operatorNotes: row.approvedNotes || '',
    route,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

const ROUTE_SELECT_SQL = `
  SELECT r.*, d.name AS "driverName", d.phone AS "driverPhone", d.email AS "driverEmail",
         v.name AS "vehicleName", v.registration AS "vehicleRegistration", v."coachType" AS "vehicleCoachType",
         v."heightM" AS "vehicleHeightM", v."widthM" AS "vehicleWidthM", v."lengthM" AS "vehicleLengthM", v."weightKg" AS "vehicleWeightKg"
  FROM "Route" r
  LEFT JOIN "Driver" d ON d.id = r."driverId"
  LEFT JOIN "Vehicle" v ON v.id = r."vehicleId"
`;



app.post('/api/auth/login', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const result = await dbRequired().query('SELECT * FROM "User" WHERE email=$1 AND "companyId"=$2', [email, companyId]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid email or password.' });
    const safeUser = publicUser(user);
    const token = signToken({ sub: safeUser.id, companyId: safeUser.companyId, role: safeUser.role, email: safeUser.email });
    res.json({ ok: true, token, user: safeUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Login failed.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.use('/api', (req, res, next) => {
  if (isPublicApiRequest(req)) return next();
  return requireAuth(req, res, next);
});

app.get('/api/settings', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query('SELECT * FROM "Company" WHERE id=$1', [companyId]);
    res.json(companyToSettings(result.rows[0] || {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/settings', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const settings = cleanSettings(req.body || {});
    const result = await dbRequired().query(
      'UPDATE "Company" SET name=$1, "brandingName"=$2, "logoUrl"=$3, "updatedAt"=NOW() WHERE id=$4 RETURNING *',
      [settings.companyName, settings.companyName, settings.logoDataUrl || '', companyId]
    );
    res.json(companyToSettings(result.rows[0] || {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/journey-events', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const limit = Math.min(250, Math.max(1, Number(req.query.limit || 100)));
    const result = await dbRequired().query(
      `SELECT e.*, d.name AS "driverName" FROM "JourneyEvent" e
       LEFT JOIN "Driver" d ON d.id=e."driverId"
       WHERE e."companyId"=$1
       ORDER BY e."createdAt" DESC
       LIMIT $2`,
      [companyId, limit]
    );
    res.json(result.rows.map(apiJourneyEvent));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/routes/:id/events', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const routeExists = await dbRequired().query('SELECT id FROM "Route" WHERE id=$1 AND "companyId"=$2', [req.params.id, companyId]);
    if (!routeExists.rows.length) return res.status(404).json({ error: 'Route not found.' });
    const result = await dbRequired().query(
      `SELECT e.*, d.name AS "driverName" FROM "JourneyEvent" e
       LEFT JOIN "Driver" d ON d.id=e."driverId"
       WHERE e."companyId"=$1 AND e."routeId"=$2
       ORDER BY e."createdAt" DESC
       LIMIT 150`,
      [companyId, req.params.id]
    );
    res.json(result.rows.map(apiJourneyEvent));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/routes/:id', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query(`${ROUTE_SELECT_SQL} WHERE r.id=$1 AND r."companyId"=$2`, [req.params.id, companyId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Route not found.' });
    res.json(apiRoute(result.rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/routes/:id', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    let statusSql = '';
    const values = [];
    let i = 1;
    if ('status' in (req.body || {})) {
      statusSql += `status=$${i++}, `;
      values.push(toDbStatus(req.body.status));
    }
    if ('driverId' in (req.body || {})) {
      const driverId = String(req.body.driverId || '') || null;
      if (driverId) {
        const driver = await dbRequired().query('SELECT id FROM "Driver" WHERE id=$1 AND "companyId"=$2', [driverId, companyId]);
        if (!driver.rows.length) return res.status(400).json({ error: 'Driver not found.' });
      }
      statusSql += `"driverId"=$${i++}, `;
      values.push(driverId);
      if (!('status' in (req.body || {})) && driverId) {
        statusSql += `status=$${i++}, `;
        values.push('ASSIGNED');
      }
    }
    if ('operatorNotes' in (req.body || {})) {
      statusSql += `"approvedNotes"=$${i++}, `;
      values.push(String(req.body.operatorNotes || '').trim().slice(0, 1000));
    }
    if (!statusSql) return res.status(400).json({ error: 'No update fields provided.' });
    values.push(req.params.id, companyId);
    const result = await dbRequired().query(
      `UPDATE "Route" SET ${statusSql}"updatedAt"=NOW() WHERE id=$${i++} AND "companyId"=$${i++} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Route not found.' });
    const full = await dbRequired().query(`${ROUTE_SELECT_SQL} WHERE r.id=$1 AND r."companyId"=$2`, [req.params.id, companyId]);
    const updatedRoute = apiRoute(full.rows[0]);
    await logJourneyEvent(companyId, req.params.id, 'operator_route_updated', 'Operator updated route status / driver assignment.', { status: updatedRoute.status, driverId: updatedRoute.driverId || null });
    res.json(updatedRoute);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function sendDriverRoutePage(req, res) {
  try {
    const companyId = await ensureCompany();
    const routeResult = await dbRequired().query(`${ROUTE_SELECT_SQL} WHERE r.id=$1 AND r."companyId"=$2`, [req.params.id, companyId]);
    if (!routeResult.rows.length) return res.status(404).send('Driver route not found.');
    const settingsResult = await dbRequired().query('SELECT * FROM "Company" WHERE id=$1', [companyId]);
    await logJourneyEvent(companyId, req.params.id, 'driver_route_opened', 'Driver opened the live route page.', { userAgent: req.headers['user-agent'] || '' });
    res.type('html').send(buildDriverRouteHtml(apiRoute(routeResult.rows[0]), companyToSettings(settingsResult.rows[0] || {})));
  } catch (error) {
    res.status(500).send(error.message || 'Driver route error.');
  }
}

app.get('/driver/route/:id', sendDriverRoutePage);
app.get('/driver-route/:id', sendDriverRoutePage);

app.get('/driver/route/:id/route-pack', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query(`${ROUTE_SELECT_SQL} WHERE r.id=$1 AND r."companyId"=$2`, [req.params.id, companyId]);
    if (!result.rows.length) return res.status(404).send('Route report not found.');
    await logJourneyEvent(companyId, req.params.id, 'driver_route_pack_opened', 'Driver opened the route pack.', { userAgent: req.headers['user-agent'] || '' });
    res.type('html').send(buildRouteReportHtml(apiRoute(result.rows[0])));
  } catch (error) {
    res.status(500).send(error.message || 'Route report failed.');
  }
});



app.post('/driver/route/:id/event', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const routeResult = await dbRequired().query('SELECT id FROM "Route" WHERE id=$1 AND "companyId"=$2', [req.params.id, companyId]);
    if (!routeResult.rows.length) return res.status(404).json({ error: 'Route not found.' });
    const eventType = String(req.body?.eventType || 'driver_event').trim().slice(0, 80);
    const message = String(req.body?.message || eventType).trim().slice(0, 400);
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    await logJourneyEvent(companyId, req.params.id, eventType, message, metadata);
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not save journey event.' });
  }
});


app.post('/driver/route/:id/reroute', async (req, res) => {
  try {
    if (!HAS_LIVE_TOMTOM_KEY) return res.status(400).json({ error: 'Live TomTom routing is not enabled.' });
    const companyId = await ensureCompany();
    const routeResult = await dbRequired().query(`${ROUTE_SELECT_SQL} WHERE r.id=$1 AND r."companyId"=$2`, [req.params.id, companyId]);
    if (!routeResult.rows.length) return res.status(404).json({ error: 'Route not found.' });

    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const accuracyM = Number(req.body?.accuracyM);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Current GPS latitude/longitude is required before recalculating.' });
    }
    if (Number.isFinite(accuracyM) && accuracyM > 150) {
      return res.status(400).json({ error: `GPS accuracy is ${Math.round(accuracyM)}m. Move to a clearer location and try again.` });
    }

    const record = apiRoute(routeResult.rows[0]);
    const existingRoute = record.route || {};
    const destination = existingRoute.destination;
    if (!destination || !Number.isFinite(Number(destination.lat)) || !Number.isFinite(Number(destination.lon))) {
      return res.status(400).json({ error: 'Saved route destination is missing GPS coordinates.' });
    }

    const origin = {
      label: `Driver GPS position (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
      lat,
      lon: lng,
      raw: { source: 'driver-gps', accuracyM: Number.isFinite(accuracyM) ? Math.round(accuracyM) : null }
    };
    const vehicle = cleanVehicle(existingRoute.vehicle || record.vehicleRecord || {});
    const options = existingRoute.options || { avoidFerries: true, avoidUnpaved: true };
    const reroute = await tomtomRoute(origin, destination, vehicle, options);
    reroute.warnings = [
      { level: 'medium', title: 'Rerouted from driver GPS', message: 'This is a live recovery route from the driver location. Driver must still follow road signs, coach access restrictions and operator instructions.' },
      ...(reroute.warnings || [])
    ];
    reroute.risk = calculateRisk(reroute, vehicle, options);
    await logJourneyEvent(companyId, req.params.id, 'reroute_calculated', 'Driver recalculated a coach-safe route from live GPS.', { lat, lng, accuracyM: Number.isFinite(accuracyM) ? Math.round(accuracyM) : null });
    res.json({ ok: true, route: stripRouteForStorage(reroute) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not recalculate coach-safe route.' });
  }
});

app.post('/driver/route/:id/complete', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query(
      'UPDATE "Route" SET status=$1, "updatedAt"=NOW() WHERE id=$2 AND "companyId"=$3 RETURNING id,status',
      ['COMPLETED', req.params.id, companyId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Route not found.' });
    await logJourneyEvent(companyId, req.params.id, 'route_completed', 'Driver marked the route as completed.', {});
    res.json({ ok: true, status: toApiStatus(result.rows[0].status) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not mark route completed.' });
  }
});

app.post('/driver/route/:id/report', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const routeResult = await dbRequired().query('SELECT id,"driverId" FROM "Route" WHERE id=$1 AND "companyId"=$2', [req.params.id, companyId]);
    if (!routeResult.rows.length) return res.status(404).json({ error: 'Route not found.' });
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const accuracyM = Number(req.body?.accuracyM);
    const hasGps = Number.isFinite(lat) && Number.isFinite(lng);
    const gpsText = hasGps
      ? `GPS ${lat.toFixed(6)}, ${lng.toFixed(6)}${Number.isFinite(accuracyM) ? ` accuracy ${Math.round(accuracyM)}m` : ''}`
      : '';
    const baseNotes = String(req.body?.notes || '').trim().slice(0, 1000);
    const report = {
      id: id('issue'),
      roadName: String(req.body?.roadName || gpsText || '').trim().slice(0, 180),
      issueType: String(req.body?.issueType || 'Unsuitable road').trim().slice(0, 120),
      notes: [baseNotes, gpsText ? `Driver GPS position: ${gpsText}` : ''].filter(Boolean).join('\n\n').slice(0, 1200)
    };
    if (!report.roadName && !report.notes) return res.status(400).json({ error: 'Please add a road/location, notes or attach GPS before submitting.' });
    const result = await dbRequired().query(
      'INSERT INTO "UnsuitableRoadReport" (id,"companyId","routeId","driverId","issueType",location,notes,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *',
      [report.id, companyId, req.params.id, routeResult.rows[0].driverId || null, report.issueType, report.roadName, report.notes]
    );
    await logJourneyEvent(companyId, req.params.id, 'road_report_submitted', `Driver submitted road report: ${report.issueType}`, { reportId: result.rows[0].id, location: report.roadName, hasGps });
    res.status(201).json({ ok: true, report: apiReport(result.rows[0]) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not save road report.' });
  }
});

app.get('/api/health', async (req, res) => {
  let databaseReady = false;
  try {
    if (pool) {
      await pool.query('SELECT 1');
      databaseReady = true;
    }
  } catch {
    databaseReady = false;
  }
  res.json({
    ok: true,
    providerReady: HAS_LIVE_TOMTOM_KEY,
    databaseReady,
    mockMode: ENABLE_MOCK_MODE,
    liveRoadRouting: HAS_LIVE_TOMTOM_KEY,
    defaultCountrySet: DEFAULT_COUNTRY_SET,
    travelMode: TOMTOM_TRAVEL_MODE,
    keyLength: TOMTOM_API_KEY.length
  });
});

app.get('/api/test-provider', async (req, res) => {
  try {
    if (!HAS_LIVE_TOMTOM_KEY) {
      return res.status(400).json({ ok: false, error: 'No TOMTOM_API_KEY found. Check .env location and filename.' });
    }
    const origin = await tomtomGeocode('Hounslow, London');
    const dest = await tomtomGeocode('Wembley Stadium, London');
    const vehicle = cleanVehicle({ preset: 'standard' });
    const result = await tomtomRoute(origin, dest, vehicle, { avoidFerries: true, avoidUnpaved: true });
    res.json({
      ok: true,
      provider: result.provider,
      travelMode: TOMTOM_TRAVEL_MODE,
      origin: result.origin.label,
      destination: result.destination.label,
      miles: Math.round((result.summary.lengthInMeters / 1609.344) * 10) / 10,
      minutes: Math.round(result.summary.travelTimeInSeconds / 60),
      risk: result.risk
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message || 'Provider test failed.' });
  }
});

app.get('/api/presets', (req, res) => res.json(COACH_PRESETS));

app.post('/api/route', async (req, res) => {
  try {
    const { start, destination, vehicle: rawVehicle, options } = req.body || {};
    if (!start || !destination) return res.status(400).json({ error: 'Start and destination are required.' });
    const stopQueries = Array.isArray(req.body?.stops)
      ? req.body.stops.map((stop) => String(stop || '').trim()).filter(Boolean).slice(0, 8)
      : [];
    const vehicle = cleanVehicle(rawVehicle);
    if (!HAS_LIVE_TOMTOM_KEY) {
      if (ENABLE_MOCK_MODE) return res.json(mockRoute(start, destination, vehicle, options));
      return res.status(400).json({
        error: 'Live TomTom routing is not enabled. Add TOMTOM_API_KEY to the .env file in this exact project folder, restart with npm.cmd start, then recalculate. Mock mode is disabled so the map will not draw an approximate straight route.'
      });
    }
    const [origin, dest, ...waypoints] = await Promise.all([
      tomtomGeocode(start),
      tomtomGeocode(destination),
      ...stopQueries.map((stop) => tomtomGeocode(stop))
    ]);
    const result = await tomtomRoute(origin, dest, vehicle, options || {}, waypoints);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Route calculation failed.' });
  }
});

app.get('/api/vehicles', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query('SELECT * FROM "Vehicle" WHERE "companyId"=$1 ORDER BY "createdAt" DESC', [companyId]);
    res.json(result.rows.map(apiVehicle));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/vehicles', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const vehicle = cleanSavedVehicle(req.body || {});
    const result = await dbRequired().query(
      'INSERT INTO "Vehicle" (id,"companyId",registration,name,"coachType","heightM","widthM","lengthM","weightKg","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()) RETURNING *',
      [vehicle.id, companyId, vehicle.registration, vehicle.name, vehicle.preset, vehicle.heightM, vehicle.widthM, vehicle.lengthM, vehicle.weightKg]
    );
    res.status(201).json(apiVehicle(result.rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/vehicles/:id', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query('DELETE FROM "Vehicle" WHERE id=$1 AND "companyId"=$2', [req.params.id, companyId]);
    res.json({ ok: true, deleted: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/drivers', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query('SELECT * FROM "Driver" WHERE "companyId"=$1 ORDER BY "createdAt" DESC', [companyId]);
    res.json(result.rows.map(apiDriver));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/drivers', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const driver = cleanDriver(req.body || {});
    const result = await dbRequired().query(
      'INSERT INTO "Driver" (id,"companyId",name,phone,email,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW(),NOW()) RETURNING *',
      [driver.id, companyId, driver.name, driver.phone, driver.email]
    );
    res.status(201).json(apiDriver(result.rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/drivers/:id', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query('DELETE FROM "Driver" WHERE id=$1 AND "companyId"=$2', [req.params.id, companyId]);
    res.json({ ok: true, deleted: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/routes', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query(`${ROUTE_SELECT_SQL} WHERE r."companyId"=$1 ORDER BY r."createdAt" DESC`, [companyId]);
    res.json(result.rows.map(apiRoute));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/routes', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const route = stripRouteForStorage(req.body.route || {});
    if (!route.origin || !route.destination || !route.points?.length) return res.status(400).json({ error: 'A calculated route is required before approval.' });
    const driverId = String(req.body.driverId || '') || null;
    const vehicleId = String(req.body.vehicleDatabaseId || '') || null;
    const recordId = id('route');
    const status = toDbStatus(req.body.status || (driverId ? 'assigned' : 'approved'));
    const distanceMiles = route.summary?.lengthInMeters ? Math.round((route.summary.lengthInMeters / 1609.344) * 10) / 10 : null;
    const durationMinutes = route.summary?.travelTimeInSeconds ? Math.round(route.summary.travelTimeInSeconds / 60) : null;
    await dbRequired().query(
      `INSERT INTO "Route" (id,"companyId","vehicleId","driverId",title,"startAddress","destinationAddress","distanceMiles","durationMinutes","riskScore",status,"routeGeometry",guidance,warnings,"approvedNotes","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
      [recordId, companyId, vehicleId, driverId, `${route.origin.label} to ${route.destination.label}`, route.origin.label, route.destination.label, distanceMiles, durationMinutes, route.risk?.score || null, status, JSON.stringify(route), JSON.stringify(route.instructions || []), JSON.stringify(route.warnings || []), String(req.body.operatorNotes || '').trim().slice(0, 1000)]
    );
    const full = await dbRequired().query(`${ROUTE_SELECT_SQL} WHERE r.id=$1 AND r."companyId"=$2`, [recordId, companyId]);
    await logJourneyEvent(companyId, recordId, 'route_approved', 'Operator saved an approved route.', { status, driverId, vehicleId, riskScore: route.risk?.score || null });
    res.status(201).json(apiRoute(full.rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/routes/:id', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query('DELETE FROM "Route" WHERE id=$1 AND "companyId"=$2', [req.params.id, companyId]);
    res.json({ ok: true, deleted: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/routes/:id/report', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query(`${ROUTE_SELECT_SQL} WHERE r.id=$1 AND r."companyId"=$2`, [req.params.id, companyId]);
    if (!result.rows.length) return res.status(404).send('Route report not found.');
    res.type('html').send(buildRouteReportHtml(apiRoute(result.rows[0])));
  } catch (error) {
    res.status(500).send(error.message || 'Route report failed.');
  }
});

app.get('/api/reports', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query('SELECT * FROM "UnsuitableRoadReport" WHERE "companyId"=$1 ORDER BY "createdAt" DESC', [companyId]);
    res.json(result.rows.map(apiReport));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reports', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const report = {
      id: id('issue'),
      routeId: String(req.body.routeId || '') || null,
      roadName: String(req.body.roadName || '').trim().slice(0, 160),
      issueType: String(req.body.issueType || 'Unsuitable road').trim().slice(0, 120),
      notes: String(req.body.notes || '').trim().slice(0, 1000)
    };
    const result = await dbRequired().query(
      'INSERT INTO "UnsuitableRoadReport" (id,"companyId","routeId","issueType",location,notes,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *',
      [report.id, companyId, report.routeId, report.issueType, report.roadName, report.notes]
    );
    res.status(201).json(apiReport(result.rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/reports/:id', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const result = await dbRequired().query('DELETE FROM "UnsuitableRoadReport" WHERE id=$1 AND "companyId"=$2', [req.params.id, companyId]);
    res.json({ ok: true, deleted: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

await ensureCompany().catch((error) => {
  console.error('Database startup check failed:', error.message);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Coach Safe Route Planner PostgreSQL beta running at http://localhost:${PORT}`);
  if (HAS_LIVE_TOMTOM_KEY) {
    console.log(`Live TomTom provider enabled. Mode: ${TOMTOM_TRAVEL_MODE}. Key length: ${TOMTOM_API_KEY.length}`);
  } else if (ENABLE_MOCK_MODE) {
    console.log('No TOMTOM_API_KEY found. ENABLE_MOCK_MODE=true, so demo routes will be approximate and not road-accurate.');
  } else {
    console.log('No live TOMTOM_API_KEY found. Mock routes are disabled. Add .env and restart before calculating routes.');
  }
});
