const form = document.getElementById('routeForm');
const presetSelect = document.getElementById('presetSelect');
const vehicleSelect = document.getElementById('vehicleSelect');
const driverSelect = document.getElementById('driverSelect');
const providerStatus = document.getElementById('providerStatus');
const warningsEl = document.getElementById('warnings');
const instructionsEl = document.getElementById('instructions');
const summaryBar = document.getElementById('summaryBar');
const riskCard = document.getElementById('riskCard');
const saveButton = document.getElementById('saveRoute');
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
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginButton = document.getElementById('loginButton');
const loginMessage = document.getElementById('loginMessage');
const currentUserBadge = document.getElementById('currentUserBadge');
const logoutButton = document.getElementById('logoutButton');
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

const toast = document.createElement('div');
toast.id = 'appToast';
toast.className = 'app-toast';
toast.setAttribute('role', 'status');
toast.setAttribute('aria-live', 'polite');
document.body.appendChild(toast);
let toastTimer;

function showToast(message, type = 'success') {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `app-toast ${type} show`;
  toastTimer = setTimeout(() => {
    toast.className = `app-toast ${type}`;
  }, 4200);
}

let routeLayer;
let markerLayer;
let currentRoute = null;
let latestSavedRoute = null;
let presets = {};
let vehicles = [];
let drivers = [];
let approvedRoutes = [];
let reports = [];
let latestJourneyEvents = [];
let routeTrackingMap = {};
let settings = {};
let pendingLogoDataUrl = '';
let authToken = localStorage.getItem('p2pCoachAuthToken') || '';
let currentUser = null;

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
loginPassword?.addEventListener('keydown', (event) => { if (event.key === 'Enter') handleLogin(); });
logoutButton?.addEventListener('click', handleLogout);
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
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(path, { ...options, headers });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (res.status === 401) {
    clearAuth();
    lockApp();
    throw new Error(data?.error || 'Please sign in again.');
  }
  if (!res.ok) throw new Error(data?.error || data || 'Request failed.');
  return data;
}

function setCurrentUser(user) {
  currentUser = user || null;
  if (currentUserBadge) {
    currentUserBadge.textContent = currentUser
      ? `${currentUser.name || currentUser.email} • ${String(currentUser.role || '').toUpperCase()}`
      : 'Not signed in';
  }
}

function setAuth(token, user) {
  authToken = token || '';
  if (authToken) localStorage.setItem('p2pCoachAuthToken', authToken);
  setCurrentUser(user);
}

function clearAuth() {
  authToken = '';
  localStorage.removeItem('p2pCoachAuthToken');
  setCurrentUser(null);
}

function lockApp() {
  document.body.classList.add('locked');
  document.getElementById('appShell')?.setAttribute('aria-hidden', 'true');
}

function unlockApp() {
  document.body.classList.remove('locked');
  document.getElementById('appShell')?.removeAttribute('aria-hidden');
  refreshMapSeveralTimes();
}

async function loadPrivateData() {
  await loadVehicles();
  await loadDrivers();
  await loadApprovedRoutes();
  await loadReports();
  renderDashboardStats();
}

async function handleLogin() {
  const email = String(loginEmail?.value || '').trim().toLowerCase();
  const password = String(loginPassword?.value || '');
  if (!email || !password) {
    if (loginMessage) loginMessage.innerHTML = '<strong>Email and password are required.</strong>';
    return;
  }
  loginButton.disabled = true;
  loginButton.textContent = 'Signing in…';
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    setAuth(result.token, result.user);
    unlockApp();
    switchView('planner');
    await loadPrivateData();
    showToast('Signed in successfully.', 'success');
    if (loginPassword) loginPassword.value = '';
    if (loginMessage) loginMessage.textContent = '';
  } catch (error) {
    if (loginMessage) loginMessage.innerHTML = `<strong>${escapeHtml(error.message)}</strong>`;
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Sign in';
  }
}

function handleLogout() {
  clearAuth();
  lockApp();
  showToast('Signed out.', 'info');
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
  return `${window.location.origin}/driver/route/${encodeURIComponent(id)}`;
}

function routePackUrl(id) {
  return `${window.location.origin}/driver/route/${encodeURIComponent(id)}/route-pack`;
}


function ensureWaypointUi() {
  if (!form || document.getElementById('waypointSection')) return;
  const destinationInput = form.elements.destination;
  const destinationLabel = destinationInput?.closest('label');
  const section = document.createElement('section');
  section.id = 'waypointSection';
  section.className = 'waypoint-section';
  section.innerHTML = `
    <div class="waypoint-head">
      <div>
        <strong>Multiple stops</strong>
        <span>Add intermediate stops in the order the coach should visit them.</span>
      </div>
      <button id="addWaypointBtn" class="secondary small-button" type="button">+ Add stop</button>
    </div>
    <div id="waypointList" class="waypoint-list"></div>
  `;
  if (destinationLabel) destinationLabel.insertAdjacentElement('afterend', section);
  else form.insertBefore(section, form.firstChild);
  section.querySelector('#addWaypointBtn')?.addEventListener('click', () => addWaypointInput());
}

function addWaypointInput(value = '') {
  const list = document.getElementById('waypointList');
  if (!list) return;
  const count = list.querySelectorAll('[data-waypoint-row]').length;
  if (count >= 8) {
    showToast('Maximum 8 intermediate stops for this beta.', 'error');
    return;
  }
  const row = document.createElement('div');
  row.className = 'waypoint-row';
  row.dataset.waypointRow = 'true';
  row.innerHTML = `
    <label>Stop ${count + 1}<input data-waypoint-input autocomplete="off" placeholder="Example: Hotel pickup, school, service station" /></label>
    <button class="secondary danger" type="button" data-remove-waypoint>Remove</button>
  `;
  row.querySelector('[data-waypoint-input]').value = value;
  row.querySelector('[data-remove-waypoint]')?.addEventListener('click', () => {
    row.remove();
    renumberWaypointInputs();
  });
  list.appendChild(row);
}

function renumberWaypointInputs() {
  document.querySelectorAll('[data-waypoint-row]').forEach((row, index) => {
    const label = row.querySelector('label');
    if (label && label.firstChild) label.firstChild.textContent = `Stop ${index + 1}`;
  });
}

function routeStops() {
  return Array.from(document.querySelectorAll('[data-waypoint-input]'))
    .map((input) => String(input.value || '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function stopsText(route = currentRoute) {
  const count = Array.isArray(route?.waypoints) ? route.waypoints.length : routeStops().length;
  return count ? ` • ${count} stop${count === 1 ? '' : 's'}` : '';
}

ensureWaypointUi();

function routeTrackingFromEvent(record = {}, event = null) {
  const status = String(record.status || 'approved').toLowerCase();
  if (status === 'completed' || event?.eventType === 'route_completed') {
    return { label: 'Completed', className: 'tracking-completed', detail: event ? `Completed ${new Date(event.createdAt).toLocaleString()}` : 'Driver marked the journey complete.' };
  }
  if (!record.driverId) {
    return { label: 'Not assigned', className: 'tracking-idle', detail: 'No driver has been assigned yet.' };
  }
  if (!event) {
    return { label: 'Assigned, not opened', className: 'tracking-waiting', detail: 'Driver link generated. Waiting for driver activity.' };
  }
  const when = new Date(event.createdAt).toLocaleString();
  const map = {
    operator_route_updated: ['Assigned / updated', 'tracking-waiting', 'Operator changed the driver or status.'],
    driver_route_opened: ['Driver opened route', 'tracking-active', 'Driver opened the live route page.'],
    driver_route_pack_opened: ['Route pack opened', 'tracking-active', 'Driver opened the printable route pack.'],
    gps_started: ['GPS active', 'tracking-live', 'Driver started live GPS tracking.'],
    gps_stopped: ['GPS stopped', 'tracking-waiting', 'Driver stopped live GPS tracking.'],
    journey_started: ['Journey started', 'tracking-live', 'Driver tapped Start journey.'],
    off_route_warning: ['Off-route warning', 'tracking-alert', event.message || 'Driver is away from the approved route.'],
    reroute_calculated: ['Rerouted', 'tracking-rerouted', 'Coach-safe reroute calculated from driver GPS.'],
    road_report_submitted: ['Road report submitted', 'tracking-alert', event.message || 'Driver submitted an issue report.'],
    screen_wake_lock_enabled: ['Screen kept on', 'tracking-live', 'Driver enabled keep-screen-on mode.'],
    screen_wake_lock_disabled: ['Screen wake off', 'tracking-active', 'Driver disabled keep-screen-on mode.']
  };
  const [label, className, detail] = map[event.eventType] || ['Driver activity', 'tracking-active', event.message || 'Driver activity recorded.'];
  return { label, className, detail: `${detail} • ${when}` };
}

function buildRouteTrackingMap(routes = [], events = []) {
  const latestByRoute = new Map();
  events.forEach((event) => {
    if (!event.routeId) return;
    const current = latestByRoute.get(event.routeId);
    if (!current || new Date(event.createdAt) > new Date(current.createdAt)) latestByRoute.set(event.routeId, event);
  });
  routeTrackingMap = {};
  routes.forEach((route) => {
    routeTrackingMap[route.id] = routeTrackingFromEvent(route, latestByRoute.get(route.id) || null);
  });
}

async function refreshJourneyTracking() {
  try {
    latestJourneyEvents = await api('/api/journey-events?limit=250');
  } catch (error) {
    latestJourneyEvents = [];
    console.warn('Could not load journey tracking', error);
  }
  buildRouteTrackingMap(approvedRoutes, latestJourneyEvents);
}

function normalisePhoneForWhatsApp(phone = '') {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `44${digits.slice(1)}`;
  return digits;
}

function routeAssignmentMessage(record) {
  const route = record?.route || {};
  const driver = record?.driver?.name || 'Driver';
  const vehicle = route.vehicle || record?.vehicle || {};
  const vehicleText = [vehicle.name, vehicle.registration].filter(Boolean).join(' ') || 'Assigned coach';
  const riskScore = route.risk?.score ?? record?.riskScore ?? '-';
  const riskLevel = route.risk?.level || 'Review required';
  const warnings = Array.isArray(route.warnings) ? route.warnings : [];
  const warningSummary = warnings.length
    ? warnings.slice(0, 3).map((w) => `- ${w.title || w.message || w}`).join('\n')
    : '- No route-specific warnings recorded. Driver must still follow road signs.';

  return `Hi ${driver}, your coach route has been assigned.\n\nRoute: ${record?.origin || record?.startAddress || 'Start'} → ${record?.destination || record?.destinationAddress || 'Destination'}\nVehicle: ${vehicleText}\nRisk score: ${riskScore}/100 (${riskLevel})\n\nOpen your live route here:\n${driverRouteUrl(record.id)}\n\nRoute pack / printable guidance:\n${routePackUrl(record.id)}\n\nSafety warning summary:\n${warningSummary}\n\nPlease review the safety warnings before departure and follow all road signs, restrictions and operator instructions.`;
}

async function copyTextToClipboard(text, successMessage = 'Copied.') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage, 'success');
    return true;
  } catch {
    prompt('Copy this text:', text);
    return false;
  }
}

function openWhatsAppForRoute(record) {
  const message = routeAssignmentMessage(record);
  const phone = normalisePhoneForWhatsApp(record?.driver?.phone || '');
  const encoded = encodeURIComponent(message);
  const url = phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
  window.open(url, '_blank');
}

function renderDashboardStats() {
  if (!dashboardStats) return;
  const assigned = approvedRoutes.filter((r) => r.status === 'assigned').length;
  const completed = approvedRoutes.filter((r) => r.status === 'completed').length;
  const liveCount = Object.values(routeTrackingMap).filter((t) => ['tracking-live', 'tracking-alert', 'tracking-rerouted'].includes(t.className)).length;
  dashboardStats.innerHTML = `
    <div class="dash-stat"><strong>${approvedRoutes.length}</strong><span>Saved routes</span></div>
    <div class="dash-stat"><strong>${assigned}</strong><span>Assigned routes</span></div>
    <div class="dash-stat"><strong>${liveCount}</strong><span>Live / active</span></div>
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
    stops: routeStops(),
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

  const routeMarkers = [
    L.marker(points[0], { icon: routePin('start') }).bindPopup(`Start: ${escapeHtml(route.origin.label)}`),
    ...((route.waypoints || [])
      .filter((stop) => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lon)))
      .map((stop, index) => L.marker([Number(stop.lat), Number(stop.lon)], { icon: routePin('stop') }).bindPopup(`Stop ${index + 1}: ${escapeHtml(stop.label || 'Planned stop')}`))),
    L.marker(points[points.length - 1], { icon: routePin('end') }).bindPopup(`Destination: ${escapeHtml(route.destination.label)}`)
  ];
  markerLayer = L.layerGroup(routeMarkers).addTo(map);

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
    <span>${metresToMiles(s.lengthInMeters || 0)} miles • ${secondsToText(s.travelTimeInSeconds || 0)}${stopsText(route)} • ${route.provider === 'tomtom' ? 'Live TomTom road route' : 'Mock/demo route'}${driver ? ` • Driver: ${escapeHtml(driver.name)}` : ''}</span>
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
  const current = presetSelect.value || 'standard';
  const groups = {};
  Object.entries(presets).forEach(([key, preset]) => {
    const group = preset.category || 'Coach / bus';
    if (!groups[group]) groups[group] = [];
    groups[group].push([key, preset]);
  });

  presetSelect.innerHTML = Object.entries(groups).map(([group, entries]) => `
    <optgroup label="${escapeHtml(group)}">
      ${entries.map(([key, preset]) => `<option value="${escapeHtml(key)}">${escapeHtml(preset.name || key)}${preset.seats ? ` • ${escapeHtml(preset.seats)} seats` : ''}</option>`).join('')}
    </optgroup>
  `).join('');

  presetSelect.value = presets[current] ? current : 'standard';
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
  await refreshJourneyTracking();
  renderDashboardStats();
  if (!approvedRoutes.length) {
    approvedRoutesEl.className = 'saved-routes empty';
    approvedRoutesEl.textContent = 'No approved routes yet.';
    return;
  }
  approvedRoutesEl.className = 'saved-routes';
  approvedRoutesEl.innerHTML = approvedRoutes.map((r) => {
    const shareUrl = driverRouteUrl(r.id);
    const tracking = routeTrackingMap[r.id] || routeTrackingFromEvent(r, null);
    return `
    <div class="saved-item" data-route-id="${escapeHtml(r.id)}">
      <strong>${escapeHtml(r.origin)} → ${escapeHtml(r.destination)}</strong>
      <span>${escapeHtml(r.route?.vehicle?.name || 'Coach')} • ${escapeHtml(r.driver?.name || 'No driver')} • ${new Date(r.createdAt).toLocaleString()}</span>
      <span class="badge">Risk ${escapeHtml(r.route?.risk?.score ?? '-')}/100 • ${escapeHtml(r.route?.risk?.level || 'Not scored')}</span>
      <span class="status-pill">${escapeHtml(r.status || 'approved')}</span>
      <div class="tracking-summary ${escapeHtml(tracking.className)}"><strong>${escapeHtml(tracking.label)}</strong><span>${escapeHtml(tracking.detail)}</span></div>
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
      <details class="assignment-message-box">
        <summary>Driver assignment message</summary>
        <textarea readonly>${escapeHtml(routeAssignmentMessage(r))}</textarea>
        <div class="hint">Copy this into WhatsApp, SMS or email when assigning the route.</div>
      </details>
      <div class="journey-events-panel" data-events-for="${escapeHtml(r.id)}" hidden>
        <strong>Journey events</strong>
        <div class="journey-events-list muted">Click “View journey events” to load driver activity.</div>
      </div>
      <div class="card-actions">
        <button class="secondary" data-action="save-route-management" data-id="${escapeHtml(r.id)}">Save status / driver</button>
        <button class="secondary" data-action="load-route" data-id="${escapeHtml(r.id)}">Load map</button>
        <button class="secondary" data-action="open-driver-view" data-id="${escapeHtml(r.id)}">Open driver link</button>
        <button class="secondary" data-action="copy-driver-link" data-id="${escapeHtml(r.id)}">Copy driver link</button>
        <button class="secondary" data-action="copy-assignment-message" data-id="${escapeHtml(r.id)}">Copy WhatsApp/SMS message</button>
        <button class="secondary" data-action="open-whatsapp-message" data-id="${escapeHtml(r.id)}">Open WhatsApp</button>
        <button class="secondary" data-action="refresh-tracking" data-id="${escapeHtml(r.id)}">Refresh tracking</button>
        <button class="secondary" data-action="view-events" data-id="${escapeHtml(r.id)}">View journey events</button>
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
      (data.waypoints || []).forEach((stop, index) => {
        if (Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lon))) {
          L.marker([Number(stop.lat), Number(stop.lon)], { icon:pin('stop') }).bindPopup('Stop ' + (index + 1) + ': ' + (stop.label || 'Planned stop')).addTo(map);
        }
      });
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
    showToast('Approved route saved successfully. It is now available in Saved routes.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
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
    showToast('Unsuitable road report saved.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
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
    showToast('Vehicle saved to the database.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
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
    showToast('Driver saved to the database.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
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

async function loadJourneyEventsForRoute(id, card) {
  const panel = card?.querySelector(`[data-events-for="${CSS.escape(id)}"]`);
  const list = panel?.querySelector('.journey-events-list');
  if (!panel || !list) return;
  panel.hidden = false;
  list.textContent = 'Loading journey events…';
  try {
    const events = await api(`/api/routes/${encodeURIComponent(id)}/events`);
    if (!events.length) {
      list.innerHTML = '<p>No driver journey events recorded yet.</p>';
      return;
    }
    list.innerHTML = events.map((ev) => {
      const meta = ev.metadata || {};
      const extra = meta.distanceM ? ` • ${escapeHtml(String(meta.distanceM))}m from route` : '';
      return `<div class="journey-event-row"><strong>${escapeHtml(eventLabel(ev.eventType))}</strong><span>${escapeHtml(new Date(ev.createdAt).toLocaleString())}${extra}</span><p>${escapeHtml(ev.message || '')}</p></div>`;
    }).join('');
  } catch (error) {
    list.innerHTML = `<p class="error-text">${escapeHtml(error.message || 'Could not load journey events.')}</p>`;
  }
}

function eventLabel(type = '') {
  return String(type || 'event')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    window.open(`/driver/route/${encodeURIComponent(id)}`, '_blank');
  }
  if (action === 'copy-driver-link') {
    const url = driverRouteUrl(id);
    const copied = await copyTextToClipboard(url, 'Driver route link copied.');
    if (copied) {
      button.textContent = 'Copied link';
      setTimeout(() => { button.textContent = 'Copy driver link'; }, 1400);
    }
  }
  if (action === 'copy-assignment-message') {
    if (!record) return;
    const copied = await copyTextToClipboard(routeAssignmentMessage(record), 'Driver assignment message copied.');
    if (copied) {
      button.textContent = 'Copied message';
      setTimeout(() => { button.textContent = 'Copy WhatsApp/SMS message'; }, 1600);
    }
  }
  if (action === 'open-whatsapp-message') {
    if (!record) return;
    openWhatsAppForRoute(record);
    showToast('WhatsApp message opened. Review before sending.', 'info');
  }
  if (action === 'refresh-tracking') {
    button.disabled = true;
    button.textContent = 'Refreshing…';
    try {
      await loadApprovedRoutes();
      showToast('Route tracking refreshed.', 'success');
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (action === 'view-events') {
    const card = button.closest('.saved-item');
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Loading events…';
    try {
      await loadJourneyEventsForRoute(id, card);
      button.textContent = 'Refresh events';
    } finally {
      button.disabled = false;
      if (button.textContent === 'Loading events…') button.textContent = oldText;
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
      showToast(driverId ? 'Route assigned. Copy the WhatsApp/SMS message to notify the driver.' : 'Route status saved.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
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
    showToast('Branding saved. New route reports and driver links will use this branding.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

async function boot() {
  enableRouteActions(false);
  openPdfButton.disabled = true;
  await loadSettings();
  await Promise.all([loadHealth(), loadPresets()]);
  if (authToken) {
    try {
      const me = await api('/api/auth/me');
      setCurrentUser(me.user);
      unlockApp();
      await loadPrivateData();
    } catch {
      clearAuth();
      lockApp();
    }
  } else {
    lockApp();
  }
}

boot().catch((error) => {
  providerStatus.innerHTML = `<strong>Startup error</strong><br>${escapeHtml(error.message)}`;
});
