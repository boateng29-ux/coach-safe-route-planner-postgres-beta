import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

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

async function tomtomRoute(origin, destination, vehicle, options = {}) {
  const routeLocations = `${origin.lat},${origin.lon}:${destination.lat},${destination.lon}`;
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
  const instructionItems = (route.instructions || []).map((i) => `<li>${escapeHtml(i.instruction || 'Continue')}</li>`).join('') || '<li>No guidance returned.</li>';
  const vehicle = route.vehicle || {};
  const risk = route.risk || { score: 0, level: 'Not scored', recommendation: 'Review route manually.' };
  const logo = settings.logoDataUrl ? `<img class="logo-img" src="${escapeHtml(settings.logoDataUrl)}" alt="Company logo">` : '<div class="logo-mark">P2P</div>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Driver Route - ${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  :root{--bg:#070707;--panel:#111;--gold:#d6ad52;--gold2:#f1d58a;--text:#f7f3e8;--muted:#b7aa8a;--line:rgba(214,173,82,.28);--danger:#ff6b6b;--warn:#ffd166;--notice:#9ed0ff;--good:#8ee6a8}
  *{box-sizing:border-box} body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#070707;color:var(--text)}
  header{position:sticky;top:0;z-index:1000;background:linear-gradient(135deg,#050505,#17120a);border-bottom:1px solid var(--line);padding:.8rem 1rem;display:flex;gap:.85rem;align-items:center}.logo-mark{width:44px;height:44px;border-radius:999px;background:linear-gradient(135deg,var(--gold2),var(--gold));display:grid;place-items:center;color:#151006;font-weight:900}.logo-img{max-width:54px;max-height:54px;border-radius:.7rem;object-fit:contain;background:#fff;padding:.15rem}.eyebrow{color:var(--gold2);text-transform:uppercase;letter-spacing:.12em;font-size:.68rem}h1{font-size:1.15rem;margin:.15rem 0}.muted{color:var(--muted)}
  #driverMap{height:56vh;min-height:22rem;width:100%;background:#101418}.content{padding:1rem;display:grid;gap:1rem}.card{border:1px solid var(--line);border-radius:1rem;background:rgba(255,255,255,.045);padding:1rem}.stats{display:grid;grid-template-columns:1fr 1fr;gap:.65rem}.stat{border:1px solid var(--line);border-radius:.8rem;padding:.75rem}.stat strong{display:block;color:var(--gold2)}.status{display:inline-block;padding:.28rem .55rem;border:1px solid var(--line);border-radius:999px;color:var(--gold2);font-weight:800;text-transform:capitalize}.warning{border:1px solid var(--line);border-radius:.75rem;padding:.75rem;margin-bottom:.65rem}.warning p{margin:.35rem 0 0;color:var(--muted)}.warning.high strong{color:var(--danger)}.warning.medium strong{color:var(--warn)}.warning.notice strong{color:var(--notice)}ol{padding-left:1.25rem;color:var(--muted)}li{margin-bottom:.5rem}.buttons{display:flex;gap:.6rem;flex-wrap:wrap}.button{border:0;border-radius:.7rem;padding:.75rem .9rem;font-weight:900;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#151006;text-decoration:none;display:inline-block}.coach-map-pin{display:inline-flex;width:1.15rem;height:1.15rem;border-radius:999px;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,.55)}.coach-map-pin.start{background:#2fd36b}.coach-map-pin.end{background:#ff6b6b}.coach-route-line{stroke-linecap:round;stroke-linejoin:round}
  @media(min-width:900px){.content{grid-template-columns:1fr 1fr}.wide{grid-column:1/-1}#driverMap{height:64vh}}
  @media print{@page{size:A4 portrait;margin:10mm}header{position:static}.buttons{display:none}.content{display:block}.card{break-inside:avoid;margin-bottom:1rem}#driverMap{height:6in}}
</style>
</head>
<body>
<header>${logo}<div><div class="eyebrow">${escapeHtml(settings.companyName || 'Point 2 Point')} • Driver route</div><h1>${escapeHtml(title)}</h1><div class="muted">${escapeHtml(metresToMiles(route.summary?.lengthInMeters || 0))} miles • ${escapeHtml(secondsToText(route.summary?.travelTimeInSeconds || 0))} • <span class="status">${escapeHtml(record.status || 'approved')}</span></div></div></header>
<div id="driverMap"></div>
<main class="content">
  <section class="card"><h2>Driver summary</h2><div class="stats"><div class="stat"><strong>Driver</strong>${escapeHtml(record.driver?.name || 'Not assigned')}</div><div class="stat"><strong>Vehicle</strong>${escapeHtml(vehicle.name || 'Coach')}<br>${escapeHtml(vehicle.registration || '')}</div><div class="stat"><strong>Height</strong>${escapeHtml(vehicle.heightM)}m</div><div class="stat"><strong>Weight</strong>${Number(vehicle.weightKg || 0).toLocaleString()}kg</div></div><p class="muted"><strong>Operator notes:</strong> ${escapeHtml(record.operatorNotes || 'None')}</p><div class="buttons"><a class="button" href="/api/routes/${escapeHtml(record.id)}/report" target="_blank">Open full report</a><button class="button" onclick="window.print()">Print</button></div></section>
  <section class="card"><h2>Risk score</h2><p style="font-size:2rem;font-weight:900;color:var(--gold2);margin:.2rem 0">${escapeHtml(risk.score)} / 100</p><strong>${escapeHtml(risk.level)} risk</strong><p class="muted">${escapeHtml(risk.recommendation)}</p></section>
  <section class="card"><h2>Safety review</h2>${warningCards}</section>
  <section class="card"><h2>Guidance preview</h2><ol>${instructionItems}</ol></section>
  <section class="card wide"><p class="muted"><strong>Important:</strong> This driver view supports route planning only. Follow road signs, temporary restrictions and operator instructions at all times.</p></section>
</main>
<script>window.ROUTE_EXPORT_DATA=${jsonForHtml(route)};</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const data=window.ROUTE_EXPORT_DATA;const map=L.map('driverMap',{zoomControl:true,preferCanvas:true}).setView([51.5072,-0.1276],10);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors',detectRetina:true,crossOrigin:true}).addTo(map);const pin=(c)=>L.divIcon({className:'',html:'<span class="coach-map-pin '+c+'"></span>',iconSize:[22,22],iconAnchor:[11,11],popupAnchor:[0,-12]});if((data.points||[]).length){const line=L.polyline(data.points,{weight:7,opacity:.9,className:'coach-route-line'}).addTo(map);L.marker(data.points[0],{icon:pin('start')}).bindPopup('Start: '+(data.origin?.label||'Start')).addTo(map);L.marker(data.points[data.points.length-1],{icon:pin('end')}).bindPopup('Destination: '+(data.destination?.label||'Destination')).addTo(map);function fit(){map.invalidateSize(true);map.fitBounds(line.getBounds(),{padding:[34,34],maxZoom:15})}[250,800,1400].forEach((d)=>setTimeout(fit,d));window.addEventListener('resize',fit)}
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
  const risk = route.risk || { score: 0, level: 'Not scored', recommendation: 'Review route manually.' };
  const driver = record.driver?.name || 'Not assigned';
  const vehicle = route.vehicle || {};

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
  header{padding:1rem 1.25rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:1rem;align-items:flex-end}.eyebrow{color:var(--gold2);text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;margin-bottom:.25rem}h1{margin:.1rem 0;font-size:clamp(1.35rem,2.5vw,2.4rem)}p{margin-top:0}.muted,.meta{color:var(--muted)}
  .route-layout{display:grid;grid-template-columns:minmax(0,1fr) 26rem;gap:1rem;padding:1rem}.map-wrap,.panel{border:1px solid var(--line);background:rgba(17,17,17,.92);border-radius:1rem;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)}#exportMap{height:72vh;min-height:34rem;width:100%;background:#101418}.map-note{padding:.75rem 1rem;color:var(--muted);border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:1rem}.panel{padding:1rem;max-height:calc(72vh + 3.1rem);overflow:auto}.stats{display:grid;grid-template-columns:1fr 1fr;gap:.65rem;margin:1rem 0}.stat,.warning,.approval{border:1px solid var(--line);border-radius:.85rem;padding:.8rem;background:rgba(255,255,255,.035)}.stat strong{display:block;color:var(--gold2)}.risk{font-size:2.1rem;font-weight:900;color:var(--gold2)}.warning{margin-bottom:.65rem}.warning p{color:var(--muted);margin-bottom:0}.warning.high strong{color:var(--danger)}.warning.medium strong{color:var(--warn)}.warning.notice strong{color:var(--notice)}ol{padding-left:1.25rem;color:var(--muted)}li{margin-bottom:.45rem}.buttons{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.75rem}button{border:0;border-radius:.7rem;padding:.7rem .9rem;font-weight:800;cursor:pointer;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#151006}.coach-map-pin{display:inline-flex;width:1.15rem;height:1.15rem;border-radius:999px;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,.55)}.coach-map-pin.start{background:#2fd36b}.coach-map-pin.end{background:#ff6b6b}.coach-route-line{stroke-linecap:round;stroke-linejoin:round}.brand{font-weight:900;color:var(--gold2)}
  @media(max-width:980px){.route-layout{grid-template-columns:1fr}.panel{max-height:none}#exportMap{height:65vh}}
  @media print{@page{size:A4 landscape;margin:10mm}html,body{width:auto;height:auto;overflow:visible;background:white!important;color:#111!important}header{padding:0 0 .35rem 0;border-bottom:1px solid #ddd;display:block;color:#111!important}h1{font-size:18pt;line-height:1.15;margin:.05rem 0}.eyebrow{color:#555!important}.meta,.muted,.map-note{color:#333!important}.route-layout{display:block;padding:0}.map-wrap{width:100%;margin:0 auto;border:1px solid #ccc;border-radius:0;box-shadow:none;overflow:hidden;page-break-inside:avoid;break-inside:avoid;background:white}#exportMap{width:100%!important;height:6.85in!important;min-height:0!important;max-height:none!important;display:block;background:#fff}.leaflet-container{width:100%!important}.map-note{padding:.35rem .5rem;border-top:1px solid #ddd;font-size:9pt}.panel{margin-top:1rem;padding:.75rem;max-height:none;page-break-before:always;break-before:page;border:1px solid #ccc;border-radius:0;box-shadow:none;background:white;color:#111!important}.stat,.warning,.approval{border-color:#ccc;background:white}.brand,.eyebrow,.stat strong{color:#111!important}ol,li{color:#111!important}.buttons,button{display:none!important}}
</style>
</head>
<body>
<header>
  <div><div class="eyebrow">Coach Safe Route Planner</div><h1>${escapeHtml(title)}</h1><div class="meta"><span class="brand">Point 2 Point</span> • Approved route report • ${escapeHtml(record.status || 'approved')}</div></div>
  <div class="buttons"><button onclick="fitRouteForPrint()">Fit route</button><button onclick="window.print()">Print / Save PDF</button></div>
</header>
<main class="route-layout">
  <section class="map-wrap"><div id="exportMap"></div><div class="map-note"><span>Use + / − to zoom. Drag the map to inspect roads and junctions.</span><span>Created ${escapeHtml(new Date(record.createdAt).toLocaleString())}</span></div></section>
  <aside class="panel">
    <h2>Approval summary</h2>
    <div class="approval"><strong>Assigned driver:</strong> ${escapeHtml(driver)}<br><strong>Operator notes:</strong> ${escapeHtml(record.operatorNotes || 'None')}<br><strong>Route ID:</strong> ${escapeHtml(record.id || '')}</div>
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
  const map=L.map('exportMap',{zoomControl:true,preferCanvas:true}).setView([51.5072,-0.1276],10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors',detectRetina:true,crossOrigin:true}).addTo(map);
  const pin=(className)=>L.divIcon({className:'',html:'<span class="coach-map-pin '+className+'"></span>',iconSize:[22,22],iconAnchor:[11,11],popupAnchor:[0,-12]});
  window.routeLine=L.polyline(data.points||[],{weight:7,opacity:.9,className:'coach-route-line'}).addTo(map);
  const routeBounds=routeLine.getBounds();
  function fitExportMap(){if(!(data.points||[]).length)return;map.invalidateSize(true);requestAnimationFrame(()=>map.fitBounds(routeBounds,{padding:[36,36],maxZoom:14,animate:false}))}
  window.fitRouteForPrint=fitExportMap;
  if((data.points||[]).length){L.marker(data.points[0],{icon:pin('start')}).bindPopup('Start: '+(data.origin?.label||'Start')).addTo(map);L.marker(data.points[data.points.length-1],{icon:pin('end')}).bindPopup('Destination: '+(data.destination?.label||'Destination')).addTo(map);[250,800,1500].forEach((delay)=>setTimeout(fitExportMap,delay))}
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
  await ensureSeedData(cachedCompanyId);
  return cachedCompanyId;
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
    res.json(apiRoute(full.rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/driver-route/:id', async (req, res) => {
  try {
    const companyId = await ensureCompany();
    const routeResult = await dbRequired().query(`${ROUTE_SELECT_SQL} WHERE r.id=$1 AND r."companyId"=$2`, [req.params.id, companyId]);
    if (!routeResult.rows.length) return res.status(404).send('Driver route not found.');
    const settingsResult = await dbRequired().query('SELECT * FROM "Company" WHERE id=$1', [companyId]);
    res.type('html').send(buildDriverRouteHtml(apiRoute(routeResult.rows[0]), companyToSettings(settingsResult.rows[0] || {})));
  } catch (error) {
    res.status(500).send(error.message || 'Driver route error.');
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
    const vehicle = cleanVehicle(rawVehicle);
    if (!HAS_LIVE_TOMTOM_KEY) {
      if (ENABLE_MOCK_MODE) return res.json(mockRoute(start, destination, vehicle, options));
      return res.status(400).json({
        error: 'Live TomTom routing is not enabled. Add TOMTOM_API_KEY to the .env file in this exact project folder, restart with npm.cmd start, then recalculate. Mock mode is disabled so the map will not draw an approximate straight route.'
      });
    }
    const [origin, dest] = await Promise.all([tomtomGeocode(start), tomtomGeocode(destination)]);
    const result = await tomtomRoute(origin, dest, vehicle, options || {});
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

app.listen(PORT, () => {
  console.log(`Coach Safe Route Planner PostgreSQL beta running at http://localhost:${PORT}`);
  if (HAS_LIVE_TOMTOM_KEY) {
    console.log(`Live TomTom provider enabled. Mode: ${TOMTOM_TRAVEL_MODE}. Key length: ${TOMTOM_API_KEY.length}`);
  } else if (ENABLE_MOCK_MODE) {
    console.log('No TOMTOM_API_KEY found. ENABLE_MOCK_MODE=true, so demo routes will be approximate and not road-accurate.');
  } else {
    console.log('No live TOMTOM_API_KEY found. Mock routes are disabled. Add .env and restart before calculating routes.');
  }
});
