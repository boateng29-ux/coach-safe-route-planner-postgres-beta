function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');

  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.position = 'fixed';
    container.style.right = '20px';
    container.style.bottom = '20px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.textContent = message;

  const isSuccess = type === 'success';
  const isError = type === 'error';

  toast.style.padding = '14px 16px';
  toast.style.borderRadius = '12px';
  toast.style.maxWidth = '360px';
  toast.style.fontWeight = '700';
  toast.style.boxShadow = '0 12px 30px rgba(0,0,0,0.35)';
  toast.style.border = isSuccess
    ? '1px solid #2ecc71'
    : isError
      ? '1px solid #ff6b6b'
      : '1px solid #e8c35a';

  toast.style.background = isSuccess
    ? '#12351f'
    : isError
      ? '#3b1111'
      : '#2b2208';

  toast.style.color = isSuccess
    ? '#d8ffe5'
    : isError
      ? '#ffd4d4'
      : '#ffe9a6';

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4500);
}
const form = document.getElementById('routeForm');
const presetSelect = document.getElementById('presetSelect');
const vehicleSelect = document.getElementById('vehicleSelect');
const driverSelect = document.getElementById('driverSelect');
const providerStatus = document.getElementById('providerStatus');
const warningsEl = document.getElementById('warnings');
const instructionsEl = document.getElementById('instructions');
const summaryBar = document.getElementById('summaryBar');
const riskCard = document.getElementById('riskCard');
const saveButton = document.getElementById('saveRoute');showToast('Approved route saved successfully. It is now available in Saved routes.', 'success');
const printButton = document.getElementById('printRoute');
const exportButton = document.getElementById('exportInteractive');
const openPdfButton = document.getElementById('openPdfReport');
const submitReportButton = document.getElementById('submitReport');
const operatorNotesEl = document.getElementById('operatorNotes');
const reportForm = document.getElementById('reportForm');
const approvedRoutesEl = document.getElementById('approvedRoutes');
const vehicleForm = document.getElementById('vehicleForm');
const vehicleList = document.getElementById('vehicleList');
const driverForm = document.getElementById('driverForm');
const driverList = document.getElementById('driverList');
const reportList = document.getElementById('reportList');
const loginScreen = document.getElementById('loginScreen');
const loginPin = document.getElementById('loginPin');
const loginButton = document.getElementById('loginButton');
const loginMessage = document.getElementById('loginMessage');
const workspaceTabs = document.querySelectorAll('.workspace-tabs button');
const viewPanels = document.querySelectorAll('.view-panel');
const dashboardStats = document.getElementById('dashboardStats');
const settingsForm = document.getElementById('settingsForm');
const companyNameInput = document.getElementById('companyNameInput');
const appNameInput = document.getElementById('appNameInput');
const accentNameInput = document.getElementById('accentNameInput');
const logoUpload = document.getElementById('logoUpload');
const logoPreview = document.getElementById('logoPreview');
const logoPreviewText = document.getElementById('logoPreviewText');
const clearLogoButton = document.getElementById('clearLogo');
const brandLogo = document.getElementById('brandLogo');
const brandInitials = document.getElementById('brandInitials');
const brandCompany = document.getElementById('brandCompany');
const brandTitle = document.getElementById('brandTitle');

let routeLayer;
let markerLayer;
let currentRoute = null;
let latestSavedRoute = null;
let presets = {};
let vehicles = [];
let drivers = [];
let approvedRoutes = [];
let reports = [];
let settings = {};
let pendingLogoDataUrl = '';

const map = L.map('map', {
  zoomControl: true,
  preferCanvas: true
}).setView([51.5072, -0.1276], 10);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
  detectRetina: true,
  crossOrigin: true
}).addTo(map);

function refreshMapSize(delay = 100) {
  setTimeout(() => map.invalidateSize(true), delay);
}

function refreshMapSeveralTimes() {
  [0, 100, 300, 700].forEach(refreshMapSize);
}

window.addEventListener('load', refreshMapSeveralTimes);
window.addEventListener('resize', refreshMapSeveralTimes);

loginButton?.addEventListener('click', handleLogin);
loginPin?.addEventListener('keydown', (event) => { if (event.key === 'Enter') handleLogin(); });
workspaceTabs.forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view, tab.dataset.focus || '')));

function metresToMiles(m) {
  return (m / 1609.344).toFixed(1);
}

function secondsToText(seconds) {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function cleanFilename(value = 'route') {
  return String(value)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'route';
}

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || 'Request failed.');
  return data;
}


function unlockApp() {
  document.body.classList.remove('locked');
  document.getElementById('appShell')?.removeAttribute('aria-hidden');
  refreshMapSeveralTimes();
}

function handleLogin() {
  const pin = String(loginPin?.value || '').trim();
  const expected = String(settings.demoPin || '1234');
  if (pin === expected) {
    sessionStorage.setItem('p2pCoachPlannerLoggedIn', 'true');
    unlockApp();
    switchView('planner');
    return;
  }
  if (loginMessage) loginMessage.innerHTML = '<strong>Incorrect PIN.</strong> Demo PIN: <strong>1234</strong>';
}

function switchView(view, focusId = '') {
  const panelName = view === 'planner' ? 'planner' : 'dashboard';
  viewPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === panelName));
  workspaceTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  refreshMapSeveralTimes();
  if (focusId) {
    setTimeout(() => document.getElementById(focusId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  } else {
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
  }
}

function routeStatusOptions(current = 'approved') {
  return ['draft', 'approved', 'assigned', 'completed'].map((status) => `<option value="${status}" ${status === current ? 'selected' : ''}>${status[0].toUpperCase()}${status.slice(1)}</option>`).join('');
}

function driverOptions(current = '') {
  return '<option value="">No driver assigned</option>' + drivers.map((d) => `<option value="${escapeHtml(d.id)}" ${d.id === current ? 'selected' : ''}>${escapeHtml(d.name)}${d.base ? ` • ${escapeHtml(d.base)}` : ''}</option>`).join('');
}

function driverRouteUrl(id) {
  return `${window.location.origin}/driver-route/${encodeURIComponent(id)}`;
}

function renderDashboardStats() {
  if (!dashboardStats) return;
  const assigned = approvedRoutes.filter((r) => r.status === 'assigned').length;
  const completed = approvedRoutes.filter((r) => r.status === 'completed').length;
  dashboardStats.innerHTML = `
    <div class="dash-stat"><strong>${approvedRoutes.length}</strong><span>Saved routes</span></div>
    <div class="dash-stat"><strong>${assigned}</strong><span>Assigned routes</span></div>
    <div class="dash-stat"><strong>${vehicles.length}</strong><span>Vehicles</span></div>
    <div class="dash-stat"><strong>${reports.length}</strong><span>Road reports</span></div>
  `;
}

function applyBranding() {
  const company = settings.companyName || 'Point 2 Point';
  const appName = settings.appName || 'Coach Safe Route Planner';
  if (brandCompany) brandCompany.textContent = `${company} Operations MVP`;
  if (brandTitle) brandTitle.textContent = appName;
  document.title = `${appName} | ${company}`;
  if (companyNameInput) companyNameInput.value = company;
  if (appNameInput) appNameInput.value = appName;
  if (accentNameInput) accentNameInput.value = settings.accentName || 'Gold / Black';
  const logo = settings.logoDataUrl || '';
  pendingLogoDataUrl = logo;
  if (logo) {
    if (brandLogo) { brandLogo.src = logo; brandLogo.hidden = false; }
    if (brandInitials) brandInitials.hidden = true;
    if (logoPreview) { logoPreview.src = logo; logoPreview.hidden = false; }
    if (logoPreviewText) logoPreviewText.textContent = 'Logo uploaded';
  } else {
    if (brandLogo) brandLogo.hidden = true;
    if (brandInitials) brandInitials.hidden = false;
    if (logoPreview) logoPreview.hidden = true;
    if (logoPreviewText) logoPreviewText.textContent = 'No logo uploaded';
  }
}

async function loadSettings() {
  settings = await api('/api/settings');
  applyBranding();
  if (sessionStorage.getItem('p2pCoachPlannerLoggedIn') === 'true') unlockApp();
}

async function updateSavedRoute(id, payload) {
  const updated = await api(`/api/routes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  await loadApprovedRoutes();
  return updated;
}

function selectedVehicleRecord() {
  return vehicles.find((v) => v.id === vehicleSelect.value) || null;
}

function selectedDriverRecord() {
  return drivers.find((d) => d.id === driverSelect.value) || null;
}

function formData() {
  const data = new FormData(form);
  const savedVehicle = selectedVehicleRecord();
  return {
    start: data.get('start'),
    destination: data.get('destination'),
    driverId: data.get('driverId') || '',
    vehicleDatabaseId: data.get('vehicleDatabaseId') || '',
    vehicle: {
      id: savedVehicle?.id,
      name: savedVehicle?.name,
      registration: savedVehicle?.registration,
      preset: data.get('preset'),
      heightM: Number(data.get('heightM')),
      widthM: Number(data.get('widthM')),
      lengthM: Number(data.get('lengthM')),
      weightKg: Number(data.get('weightKg')),
      maxSpeedKmh: 90
    },
    options: {
      avoidLowEmissionZones: data.has('avoidLowEmissionZones'),
      avoidTolls: data.has('avoidTolls'),
      avoidFerries: data.has('avoidFerries'),
      avoidUnpaved: data.has('avoidUnpaved'),
      avoidTunnels: data.has('avoidTunnels')
    }
  };
}

function setPresetFields(presetKey) {
  const preset = presets[presetKey];
  if (!preset) return;
  form.heightM.value = preset.heightM;
  form.widthM.value = preset.widthM;
  form.lengthM.value = preset.lengthM;
  form.weightKg.value = preset.weightKg;
}

function setVehicleFields(vehicle) {
  if (!vehicle) return;
  form.preset.value = vehicle.preset || 'standard';
  form.heightM.value = vehicle.heightM;
  form.widthM.value = vehicle.widthM;
  form.lengthM.value = vehicle.lengthM;
  form.weightKg.value = vehicle.weightKg;
}

function renderRisk(risk) {
  if (!risk) {
    riskCard.className = 'risk-card empty';
    riskCard.textContent = 'No risk score yet.';
    return;
  }
  const levelClass = String(risk.level || '').toLowerCase();
  riskCard.className = `risk-card ${levelClass}`;
  riskCard.innerHTML = `
    <div class="risk-score">
      <div>
        <div class="risk-number">${escapeHtml(risk.score)} / 100</div>
        <div class="risk-level">${escapeHtml(risk.level)} route risk</div>
      </div>
      <span class="badge">Auto score</span>
    </div>
    <p>${escapeHtml(risk.recommendation || 'Review route manually.')}</p>
  `;
}

function renderWarnings(warnings = []) {
  if (!warnings.length) {
    warningsEl.className = 'warnings empty';
    warningsEl.textContent = 'No warnings returned.';
    return;
  }
  warningsEl.className = 'warnings';
  warningsEl.innerHTML = warnings.map((w) => `
    <div class="warning-card ${escapeHtml(w.level)}">
      <strong>${escapeHtml(w.title)}</strong>
      <p>${escapeHtml(w.message)}</p>
    </div>
  `).join('');
}

function renderInstructions(instructions = []) {
  instructionsEl.innerHTML = instructions.map((i) => `<li>${escapeHtml(i.instruction || 'Continue')}</li>`).join('');
}

function routePin(className) {
  return L.divIcon({
    className: '',
    html: `<span class="coach-map-pin ${className}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12]
  });
}

function renderMap(route) {
  if (routeLayer) routeLayer.remove();
  if (markerLayer) markerLayer.remove();

  const points = route.points || [];
  if (points.length < 3) {
    renderWarnings([{ level: 'high', title: 'Route geometry problem', message: 'The route has too few map points and would draw like a straight line. Recalculate with live TomTom routing enabled before exporting.' }].concat(route.warnings || []));
    return;
  }

  refreshMapSeveralTimes();
  routeLayer = L.polyline(points, {
    weight: 7,
    opacity: 0.9,
    className: 'coach-route-line'
  }).addTo(map);

  markerLayer = L.layerGroup([
    L.marker(points[0], { icon: routePin('start') }).bindPopup(`Start: ${escapeHtml(route.origin.label)}`),
    L.marker(points[points.length - 1], { icon: routePin('end') }).bindPopup(`Destination: ${escapeHtml(route.destination.label)}`)
  ]).addTo(map);

  setTimeout(() => {
    map.invalidateSize(true);
    map.fitBounds(routeLayer.getBounds(), { padding: [60, 60], maxZoom: 15 });
  }, 250);
}

function renderSummary(route) {
  const s = route.summary || {};
  const driver = selectedDriverRecord();
  summaryBar.innerHTML = `
    <strong>${escapeHtml(route.origin.label)} → ${escapeHtml(route.destination.label)}</strong>
    <span>${metresToMiles(s.lengthInMeters || 0)} miles • ${secondsToText(s.travelTimeInSeconds || 0)} • ${route.provider === 'tomtom' ? 'Live TomTom road route' : 'Mock/demo route'}${driver ? ` • Driver: ${escapeHtml(driver.name)}` : ''}</span>
  `;
}

async function loadHealth() {
  const health = await api('/api/health');
  providerStatus.innerHTML = health.providerReady
    ? `<strong>Live road routing ready</strong><br>TomTom enabled • Country: ${health.defaultCountrySet} • Mode: ${health.travelMode}`
    : `<strong>Live routing not enabled</strong><br>Add TOMTOM_API_KEY to the .env file in this exact folder, restart the app, then recalculate. Mock routes are disabled by default.`;
}

async function loadPresets() {
  presets = await api('/api/presets');
  setPresetFields(presetSelect.value);
}

async function loadVehicles() {
  vehicles = await api('/api/vehicles');
  vehicleSelect.innerHTML = '<option value="">Use manual coach profile</option>' + vehicles.map((v) => `
    <option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}${v.registration ? ` • ${escapeHtml(v.registration)}` : ''}</option>
  `).join('');

  renderDashboardStats();
  if (!vehicles.length) {
    vehicleList.className = 'database-list empty';
    vehicleList.textContent = 'No vehicles saved yet.';
    return;
  }
  vehicleList.className = 'database-list';
  vehicleList.innerHTML = vehicles.map((v) => `
    <div class="db-item">
      <strong>${escapeHtml(v.name)}</strong>
      <span>${escapeHtml(v.registration || 'No registration')} • ${escapeHtml(v.heightM)}m H • ${escapeHtml(v.widthM)}m W • ${escapeHtml(v.lengthM)}m L • ${Number(v.weightKg || 0).toLocaleString()}kg</span>
      <div class="card-actions">
        <button class="secondary" data-action="use-vehicle" data-id="${escapeHtml(v.id)}">Use</button>
        <button class="secondary danger" data-action="delete-vehicle" data-id="${escapeHtml(v.id)}">Delete</button>
      </div>
    </div>
  `).join('');
}

async function loadDrivers() {
  drivers = await api('/api/drivers');
  driverSelect.innerHTML = '<option value="">No driver assigned</option>' + drivers.map((d) => `
    <option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}${d.base ? ` • ${escapeHtml(d.base)}` : ''}</option>
  `).join('');

  renderDashboardStats();
  if (!drivers.length) {
    driverList.className = 'database-list empty';
    driverList.textContent = 'No drivers saved yet.';
    return;
  }
  driverList.className = 'database-list';
  driverList.innerHTML = drivers.map((d) => `
    <div class="db-item">
      <strong>${escapeHtml(d.name)}</strong>
      <span>${escapeHtml(d.phone || 'No phone')} ${d.email ? `• ${escapeHtml(d.email)}` : ''} ${d.base ? `• ${escapeHtml(d.base)}` : ''}</span>
      <div class="card-actions">
        <button class="secondary" data-action="assign-driver" data-id="${escapeHtml(d.id)}">Assign</button>
        <button class="secondary danger" data-action="delete-driver" data-id="${escapeHtml(d.id)}">Delete</button>
      </div>
    </div>
  `).join('');
}

async function loadApprovedRoutes() {
  approvedRoutes = await api('/api/routes');
  renderDashboardStats();
  if (!approvedRoutes.length) {
    approvedRoutesEl.className = 'saved-routes empty';
    approvedRoutesEl.textContent = 'No approved routes yet.';
    return;
  }
  approvedRoutesEl.className = 'saved-routes';
  approvedRoutesEl.innerHTML = approvedRoutes.map((r) => {
    const shareUrl = driverRouteUrl(r.id);
    return `
    <div class="saved-item" data-route-id="${escapeHtml(r.id)}">
      <strong>${escapeHtml(r.origin)} → ${escapeHtml(r.destination)}</strong>
      <span>${escapeHtml(r.route?.vehicle?.name || 'Coach')} • ${escapeHtml(r.driver?.name || 'No driver')} • ${new Date(r.createdAt).toLocaleString()}</span>
      <span class="badge">Risk ${escapeHtml(r.route?.risk?.score ?? '-')}/100 • ${escapeHtml(r.route?.risk?.level || 'Not scored')}</span>
      <span class="status-pill">${escapeHtml(r.status || 'approved')}</span>
      <div class="route-management-grid">
        <label>Route status
          <select data-field="status">${routeStatusOptions(r.status || 'approved')}</select>
        </label>
        <label>Assigned driver
          <select data-field="driverId">${driverOptions(r.driverId || '')}</select>
        </label>
        <label>Driver link
          <input readonly value="${escapeHtml(shareUrl)}" />
        </label>
        <label>Report
          <input readonly value="${escapeHtml(`/api/routes/${r.id}/report`)}" />
        </label>
      </div>
      <span class="driver-link">Driver mobile view: ${escapeHtml(shareUrl)}</span>
      <div class="card-actions">
        <button class="secondary" data-action="save-route-management" data-id="${escapeHtml(r.id)}">Save status / driver</button>
        <button class="secondary" data-action="load-route" data-id="${escapeHtml(r.id)}">Load map</button>
        <button class="secondary" data-action="open-driver-view" data-id="${escapeHtml(r.id)}">Open driver link</button>
        <button class="secondary" data-action="copy-driver-link" data-id="${escapeHtml(r.id)}">Copy driver link</button>
        <button class="secondary" data-action="open-report" data-id="${escapeHtml(r.id)}">Open PDF report</button>
        <button class="secondary danger" data-action="delete-route" data-id="${escapeHtml(r.id)}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function loadReports() {
  reports = await api('/api/reports');
  renderDashboardStats();
  if (!reports.length) {
    reportList.className = 'database-list empty';
    reportList.textContent = 'No road reports yet.';
    return;
  }
  reportList.className = 'database-list';
  reportList.innerHTML = reports.map((r) => `
    <div class="db-item">
      <strong>${escapeHtml(r.issueType)}</strong>
      <span>${escapeHtml(r.roadName || 'Unnamed location')} • ${new Date(r.createdAt).toLocaleString()}</span>
      <span>${escapeHtml(r.notes || 'No notes')}</span>
      <div class="card-actions">
        <button class="secondary danger" data-action="delete-report" data-id="${escapeHtml(r.id)}">Delete</button>
      </div>
    </div>
  `).join('');
}

function buildStandaloneRouteHtml(route, { autoPrint = false } = {}) {
  const exportData = {
    origin: route.origin,
    destination: route.destination,
    vehicle: route.vehicle,
    summary: route.summary,
    provider: route.provider,
    points: route.points || [],
    instructions: route.instructions || [],
    warnings: route.warnings || [],
    risk: route.risk,
    exportedAt: new Date().toISOString()
  };
  const title = `${route.origin?.label || 'Start'} to ${route.destination?.label || 'Destination'}`;
  const miles = metresToMiles(route.summary?.lengthInMeters || 0);
  const time = secondsToText(route.summary?.travelTimeInSeconds || 0);
  const warningCards = (route.warnings || []).map((w) => `
    <article class="warning ${escapeHtml(w.level || 'notice')}">
      <strong>${escapeHtml(w.title || 'Route note')}</strong>
      <p>${escapeHtml(w.message || '')}</p>
    </article>
  `).join('') || '<p class="muted">No warnings returned.</p>';
  const instructionItems = (route.instructions || []).map((i) => `<li>${escapeHtml(i.instruction || 'Continue')}</li>`).join('') || '<li>No guidance returned.</li>';
  const risk = route.risk || { score: 0, level: 'Not scored', recommendation: 'Review route manually.' };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Coach Route Export - ${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    :root { --bg:#070707; --panel:#111; --gold:#d6ad52; --gold2:#f1d58a; --text:#f7f3e8; --muted:#b7aa8a; --line:rgba(214,173,82,.28); --danger:#ff6b6b; --warn:#ffd166; --notice:#9ed0ff; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif; background:linear-gradient(135deg,#050505,#131313 62%,#1b160b); color:var(--text); }
    header { padding:1rem 1.25rem; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:1rem; align-items:flex-end; }
    h1 { margin:.1rem 0; font-size:clamp(1.35rem,2.5vw,2.4rem); }
    p { margin-top:0; }
    .eyebrow { color:var(--gold2); text-transform:uppercase; letter-spacing:.14em; font-size:.72rem; margin-bottom:.25rem; }
    .muted, .meta { color:var(--muted); }
    .route-layout { display:grid; grid-template-columns:minmax(0,1fr) 25rem; gap:1rem; padding:1rem; }
    .map-wrap, .panel { border:1px solid var(--line); background:rgba(17,17,17,.9); border-radius:1rem; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.3); }
    #exportMap { height:72vh; min-height:34rem; width:100%; background:#101418; }
    .map-note { padding:.75rem 1rem; color:var(--muted); border-top:1px solid var(--line); display:flex; justify-content:space-between; gap:1rem; }
    .panel { padding:1rem; max-height:calc(72vh + 3.1rem); overflow:auto; }
    .stats { display:grid; grid-template-columns:1fr 1fr; gap:.65rem; margin:1rem 0; }
    .stat, .warning, .risk { border:1px solid var(--line); border-radius:.85rem; padding:.8rem; background:rgba(255,255,255,.035); }
    .stat strong { display:block; color:var(--gold2); }
    .risk strong { color:var(--gold2); font-size:1.7rem; }
    .warning { margin-bottom:.65rem; }
    .warning p { color:var(--muted); margin-bottom:0; }
    .warning.high strong { color:var(--danger); }
    .warning.medium strong { color:var(--warn); }
    .warning.notice strong { color:var(--notice); }
    ol { padding-left:1.25rem; color:var(--muted); }
    li { margin-bottom:.45rem; }
    .buttons { display:flex; gap:.6rem; flex-wrap:wrap; margin-top:.75rem; }
    button { border:0; border-radius:.7rem; padding:.7rem .9rem; font-weight:800; cursor:pointer; background:linear-gradient(135deg,var(--gold2),var(--gold)); color:#151006; }
    .coach-map-pin { display:inline-flex; width:1.15rem; height:1.15rem; border-radius:999px; border:3px solid white; box-shadow:0 2px 10px rgba(0,0,0,.55); }
    .coach-map-pin.start { background:#2fd36b; }
    .coach-map-pin.end { background:#ff6b6b; }
    .coach-route-line { stroke-linecap:round; stroke-linejoin:round; }
    @media (max-width: 980px) { .route-layout { grid-template-columns:1fr; } .panel { max-height:none; } #exportMap { height:65vh; } }
    @media print {
      @page { size: A4 landscape; margin: 10mm; }
      html, body { width:auto; height:auto; overflow:visible; background:white !important; color:#111 !important; }
      header { padding:0 0 .35rem 0; border-bottom:1px solid #ddd; display:block; color:#111 !important; }
      h1 { font-size:18pt; line-height:1.15; margin:.05rem 0; }
      .eyebrow { color:#555 !important; }
      .meta, .muted, .map-note { color:#333 !important; }
      .route-layout { display:block; padding:0; }
      .map-wrap { width:100%; margin:0 auto; border:1px solid #ccc; border-radius:0; box-shadow:none; overflow:hidden; page-break-inside:avoid; break-inside:avoid; background:white; }
      #exportMap { width:100% !important; height:6.85in !important; min-height:0 !important; max-height:none !important; display:block; background:#fff; }
      .leaflet-container { width:100% !important; }
      .map-note { padding:.35rem .5rem; border-top:1px solid #ddd; font-size:9pt; }
      .panel { margin-top:1rem; padding:.75rem; max-height:none; page-break-before:always; break-before:page; border:1px solid #ccc; border-radius:0; box-shadow:none; background:white; color:#111 !important; }
      .stat, .warning, .risk { border-color:#ccc; background:white; }
      .stat strong, .risk strong { color:#111 !important; }
      ol, li { color:#111 !important; }
      button, .buttons { display:none !important; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="eyebrow">Point 2 Point • Coach Safe Route Export</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${escapeHtml(miles)} miles • ${escapeHtml(time)} • ${escapeHtml(route.provider === 'tomtom' ? 'Live TomTom road route' : 'Mock/demo route - not road accurate')}</div>
    </div>
    <div class="buttons">
      <button type="button" onclick="fitRouteForPrint()">Fit route</button>
      <button type="button" onclick="window.print()">Print / Save PDF</button>
    </div>
  </header>
  <main class="route-layout">
    <section class="map-wrap">
      <div id="exportMap"></div>
      <div class="map-note"><span>Use + / − to zoom. Drag the map to inspect roads and junctions.</span><span>Exported ${new Date().toLocaleString()}</span></div>
    </section>
    <aside class="panel">
      <h2>Route summary</h2>
      <div class="stats">
        <div class="stat"><strong>Distance</strong>${escapeHtml(miles)} miles</div>
        <div class="stat"><strong>Time</strong>${escapeHtml(time)}</div>
        <div class="stat"><strong>Vehicle</strong>${escapeHtml(route.vehicle?.name || 'Coach')}<br>${escapeHtml(route.vehicle?.registration || '')}</div>
        <div class="stat"><strong>Dimensions</strong>${escapeHtml(route.vehicle?.heightM)}m H • ${escapeHtml(route.vehicle?.widthM)}m W • ${escapeHtml(route.vehicle?.lengthM)}m L</div>
      </div>
      <h2>Route risk score</h2>
      <div class="risk"><strong>${escapeHtml(risk.score)} / 100</strong><br>${escapeHtml(risk.level)} risk<br><span class="muted">${escapeHtml(risk.recommendation)}</span></div>
      <h2>Safety review</h2>
      ${warningCards}
      <h2>Guidance preview</h2>
      <ol>${instructionItems}</ol>
      <p class="muted"><strong>Important:</strong> This export supports route planning only. Drivers must follow road signs, temporary restrictions and operator approval.</p>
    </aside>
  </main>
  <script>window.ROUTE_EXPORT_DATA = ${jsonForHtml(exportData)};</script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const data = window.ROUTE_EXPORT_DATA;
    const map = L.map('exportMap', { zoomControl:true, preferCanvas:true }).setView([51.5072, -0.1276], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; OpenStreetMap contributors', detectRetina:true, crossOrigin:true }).addTo(map);
    const pin = (className) => L.divIcon({ className:'', html:'<span class="coach-map-pin '+className+'"></span>', iconSize:[22,22], iconAnchor:[11,11], popupAnchor:[0,-12] });
    window.routeLine = L.polyline(data.points, { weight:7, opacity:.9, className:'coach-route-line' }).addTo(map);
    const routeBounds = routeLine.getBounds();
    function fitExportMap() {
      if (!data.points.length) return;
      map.invalidateSize(true);
      requestAnimationFrame(() => map.fitBounds(routeBounds, { padding:[36,36], maxZoom:14, animate:false }));
    }
    window.fitRouteForPrint = fitExportMap;
    if (data.points.length) {
      L.marker(data.points[0], { icon:pin('start') }).bindPopup('Start: ' + (data.origin?.label || 'Start')).addTo(map);
      L.marker(data.points[data.points.length - 1], { icon:pin('end') }).bindPopup('Destination: ' + (data.destination?.label || 'Destination')).addTo(map);
      [250, 800, 1500].forEach((delay) => setTimeout(fitExportMap, delay));
    }
    window.addEventListener('beforeprint', () => { fitExportMap(); setTimeout(fitExportMap, 350); });
    if (window.matchMedia) {
      const mq = window.matchMedia('print');
      if (mq.addEventListener) mq.addEventListener('change', (event) => { if (event.matches) { fitExportMap(); setTimeout(fitExportMap, 350); } });
    }
    ${autoPrint ? "setTimeout(() => { fitExportMap(); window.print(); }, 1500);" : ''}
  </script>
</body>
</html>`;
}

function enableRouteActions(enabled) {
  saveButton.disabled = !enabled;
  printButton.disabled = !enabled;
  exportButton.disabled = !enabled;
  submitReportButton.disabled = !enabled;
}

function setLatestSavedRoute(record) {
  latestSavedRoute = record || null;
  openPdfButton.disabled = !latestSavedRoute;
}

presetSelect.addEventListener('change', (e) => {
  vehicleSelect.value = '';
  setPresetFields(e.target.value);
});

vehicleSelect.addEventListener('change', () => {
  const vehicle = selectedVehicleRecord();
  if (vehicle) setVehicleFields(vehicle);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = formData();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Calculating route…';
  setLatestSavedRoute(null);
  try {
    const data = await api('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    currentRoute = data;
    renderSummary(data);
    renderRisk(data.risk);
    renderWarnings(data.warnings);
    renderInstructions(data.instructions);
    renderMap(data);
    enableRouteActions(true);
  } catch (error) {
    currentRoute = null;
    enableRouteActions(false);
    renderRisk(null);
    renderWarnings([{ level: 'high', title: 'Route calculation failed', message: error.message }]);
  } finally {
    button.disabled = false;
    button.textContent = 'Calculate coach-safe route';
  }
});

saveButton.addEventListener('click', async () => {
  if (!currentRoute) return;
  saveButton.disabled = true;
  saveButton.textContent = 'Saving…';
  try {
    const payload = formData();
    const saved = await api('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route: currentRoute,
        driverId: payload.driverId,
        vehicleDatabaseId: payload.vehicleDatabaseId,
        operatorNotes: operatorNotesEl.value,
        status: payload.driverId ? 'assigned' : 'approved'
      })
    });
    setLatestSavedRoute(saved);
    await loadApprovedRoutes();
    saveButton.textContent = 'Saved as approved route';
  } catch (error) {
    alert(error.message);
    saveButton.textContent = 'Save approved route';
  } finally {
    saveButton.disabled = false;
  }
});

printButton.addEventListener('click', () => {
  if (!currentRoute) return;
  if (currentRoute.provider !== 'tomtom') {
    alert('This is not a live TomTom road route. Recalculate after enabling TOMTOM_API_KEY before printing/exporting.');
    return;
  }
  const html = buildStandaloneRouteHtml(currentRoute, { autoPrint: true });
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    window.print();
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
});

exportButton.addEventListener('click', () => {
  if (!currentRoute) return;
  if (currentRoute.provider !== 'tomtom') {
    alert('This is not a live TomTom road route. Recalculate after enabling TOMTOM_API_KEY before exporting.');
    return;
  }
  const html = buildStandaloneRouteHtml(currentRoute, { autoPrint: false });
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const origin = cleanFilename(currentRoute.origin?.label || 'start');
  const destination = cleanFilename(currentRoute.destination?.label || 'destination');
  link.href = url;
  link.download = `coach-route-${origin}-to-${destination}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

openPdfButton.addEventListener('click', () => {
  if (!latestSavedRoute) return;
  window.open(`/api/routes/${encodeURIComponent(latestSavedRoute.id)}/report`, '_blank');
});

reportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentRoute) return;
  const points = currentRoute.points || [];
  const middle = points[Math.floor(points.length / 2)] || [null, null];
  const data = new FormData(reportForm);
  try {
    await api('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routeId: latestSavedRoute?.id || '',
        roadName: data.get('roadName'),
        issueType: data.get('issueType'),
        notes: data.get('notes'),
        lat: middle[0],
        lon: middle[1]
      })
    });
    reportForm.reset();
    await loadReports();
    alert('Unsuitable road report saved.');
  } catch (error) {
    alert(error.message);
  }
});

vehicleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(vehicleForm));
  try {
    await api('/api/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    vehicleForm.reset();
    vehicleForm.preset.value = 'standard';
    vehicleForm.heightM.value = '3.65';
    vehicleForm.widthM.value = '2.55';
    vehicleForm.lengthM.value = '12.2';
    vehicleForm.weightKg.value = '18000';
    await loadVehicles();
  } catch (error) {
    alert(error.message);
  }
});

vehicleList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === 'use-vehicle') {
    vehicleSelect.value = id;
    const vehicle = vehicles.find((v) => v.id === id);
    setVehicleFields(vehicle);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (action === 'delete-vehicle') {
    if (!confirm('Delete this vehicle?')) return;
    await api(`/api/vehicles/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadVehicles();
  }
});

driverForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(driverForm));
  try {
    await api('/api/drivers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    driverForm.reset();
    await loadDrivers();
    await loadApprovedRoutes();
  } catch (error) {
    alert(error.message);
  }
});

driverList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === 'assign-driver') {
    driverSelect.value = id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (action === 'delete-driver') {
    if (!confirm('Delete this driver?')) return;
    await api(`/api/drivers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadDrivers();
    await loadApprovedRoutes();
  }
});

approvedRoutesEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  const record = approvedRoutes.find((r) => r.id === id);
  if (action === 'load-route' && record?.route) {
    currentRoute = record.route;
    latestSavedRoute = record;
    renderSummary(currentRoute);
    renderRisk(currentRoute.risk);
    renderWarnings(currentRoute.warnings);
    renderInstructions(currentRoute.instructions);
    renderMap(currentRoute);
    enableRouteActions(true);
    openPdfButton.disabled = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (action === 'open-report') {
    window.open(`/api/routes/${encodeURIComponent(id)}/report`, '_blank');
  }
  if (action === 'open-driver-view') {
    window.open(`/driver-route/${encodeURIComponent(id)}`, '_blank');
  }
  if (action === 'copy-driver-link') {
    const url = driverRouteUrl(id);
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = 'Copied link';
      setTimeout(() => { button.textContent = 'Copy driver link'; }, 1400);
    } catch {
      prompt('Copy this driver link:', url);
    }
  }
  if (action === 'save-route-management') {
    const card = button.closest('.saved-item');
    const status = card?.querySelector('[data-field="status"]')?.value || 'approved';
    const driverId = card?.querySelector('[data-field="driverId"]')?.value || '';
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const updated = await updateSavedRoute(id, { status, driverId });
      if (latestSavedRoute?.id === id) setLatestSavedRoute(updated);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }
  if (action === 'delete-route') {
    if (!confirm('Delete this approved route?')) return;
    await api(`/api/routes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadApprovedRoutes();
  }
});

reportList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'delete-report') {
    if (!confirm('Delete this road report?')) return;
    await api(`/api/reports/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
    await loadReports();
  }
});


logoUpload?.addEventListener('change', () => {
  const file = logoUpload.files?.[0];
  if (!file) return;
  if (file.size > 700000) {
    alert('Logo is too large. Please use an image under 700 KB for this local MVP.');
    logoUpload.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    pendingLogoDataUrl = String(reader.result || '');
    if (logoPreview) { logoPreview.src = pendingLogoDataUrl; logoPreview.hidden = false; }
    if (logoPreviewText) logoPreviewText.textContent = file.name;
  };
  reader.readAsDataURL(file);
});

clearLogoButton?.addEventListener('click', async () => {
  pendingLogoDataUrl = '';
  if (logoUpload) logoUpload.value = '';
  settings.logoDataUrl = '';
  applyBranding();
});

settingsForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    companyName: companyNameInput?.value || 'Point 2 Point',
    appName: appNameInput?.value || 'Coach Safe Route Planner',
    accentName: accentNameInput?.value || 'Gold / Black',
    logoDataUrl: pendingLogoDataUrl || ''
  };
  try {
    settings = await api('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    applyBranding();
    alert('Branding saved. New route reports and driver links will use this branding.');
  } catch (error) {
    alert(error.message);
  }
});

async function boot() {
  enableRouteActions(false);
  openPdfButton.disabled = true;
  await loadSettings();
  await Promise.all([loadHealth(), loadPresets()]);
  await loadVehicles();
  await loadDrivers();
  await loadApprovedRoutes();
  await loadReports();
  renderDashboardStats();
}

boot().catch((error) => {
  providerStatus.innerHTML = `<strong>Startup error</strong><br>${escapeHtml(error.message)}`;
});
