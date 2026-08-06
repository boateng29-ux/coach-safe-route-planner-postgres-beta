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
const loginCompanySlug = document.getElementById('loginCompanySlug');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginButton = document.getElementById('loginButton');
const loginMessage = document.getElementById('loginMessage');
const runDiagnosticsBtn = document.getElementById('runDiagnosticsBtn');
const downloadDiagnosticsBtn = document.getElementById('downloadDiagnosticsBtn');
const diagnosticOverallIcon = document.getElementById('diagnosticOverallIcon');
const diagnosticOverallStatus = document.getElementById('diagnosticOverallStatus');
const diagnosticCheckedAt = document.getElementById('diagnosticCheckedAt');
const diagnosticSummaryGrid = document.getElementById('diagnosticSummaryGrid');
const diagnosticIdentity = document.getElementById('diagnosticIdentity');
const diagnosticDataCounts = document.getElementById('diagnosticDataCounts');
const diagnosticTenantWarning = document.getElementById('diagnosticTenantWarning');
const diagnosticApiTests = document.getElementById('diagnosticApiTests');
const diagnosticApiLatency = document.getElementById('diagnosticApiLatency');
const diagnosticInfrastructure = document.getElementById('diagnosticInfrastructure');
const diagnosticCompanyDistributionSection = document.getElementById('diagnosticCompanyDistributionSection');
const diagnosticCompanyDistribution = document.getElementById('diagnosticCompanyDistribution');
const diagnosticFindings = document.getElementById('diagnosticFindings');
const diagnosticErrorSection = document.getElementById('diagnosticErrorSection');
const diagnosticErrorDetail = document.getElementById('diagnosticErrorDetail');
let latestDiagnosticReport = null;

const currentUserBadge = document.getElementById('currentUserBadge');
const logoutButton = document.getElementById('logoutButton');
const workspaceTabs = document.querySelectorAll('.workspace-tabs button');
const viewPanels = document.querySelectorAll('.view-panel');
const dashboardStats = document.getElementById('dashboardStats');
const operatorPriorities = document.getElementById('operatorPriorities');
const operationsMapElement = document.getElementById('operationsMap');
const operationalSummaryTitle = document.getElementById('operationalSummaryTitle');
const operationalSummaryText = document.getElementById('operationalSummaryText');
const refreshMissionControlBtn = document.getElementById('refreshMissionControlBtn');
const dispatchStatusFilter = document.getElementById('dispatchStatusFilter');
let missionMapLayers = { routes: true, fleet: true, reports: true };
let missionMapBounds = [];

const operationsMapEmpty = document.getElementById('operationsMapEmpty');
const missionDispatchBoard = document.getElementById('missionDispatchBoard');
const missionNotifications = document.getElementById('missionNotifications');
const missionFleetStatus = document.getElementById('missionFleetStatus');
const missionDriverStatus = document.getElementById('missionDriverStatus');
let operationsMap = null;
let operationsMapLayer = null;
let operationsMapResizeObserver = null;
let operationsMapResizeTimers = [];

const overviewActivityFeed = document.getElementById('overviewActivityFeed');
const vehicleKpis = document.getElementById('vehicleKpis');
const driverKpis = document.getElementById('driverKpis');
const reportKpis = document.getElementById('reportKpis');

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
const heroBrandLogos = document.querySelectorAll('[data-hero-brand-logo]');
const heroBrandInitialsNodes = document.querySelectorAll('[data-hero-brand-initials]');
const heroBrandCompanyNodes = document.querySelectorAll('[data-hero-brand-company]');
const heroBrandTitleNodes = document.querySelectorAll('[data-hero-brand-title]');
const heroCurrentUserNodes = document.querySelectorAll('[data-hero-current-user]');
const heroLogoutButtons = document.querySelectorAll('[data-hero-logout]');

const operatorPreferencesForm = document.getElementById('operatorPreferencesForm');
const defaultLandingView = document.getElementById('defaultLandingView');
const prefAvoidTolls = document.getElementById('prefAvoidTolls');
const prefAvoidFerries = document.getElementById('prefAvoidFerries');
const prefAvoidUnpaved = document.getElementById('prefAvoidUnpaved');
const prefAvoidTunnels = document.getElementById('prefAvoidTunnels');
const prefAvoidLez = document.getElementById('prefAvoidLez');
const compactDashboard = document.getElementById('compactDashboard');


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
let currentCompany = null;
let commercialOnboardStep = 1;

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
heroLogoutButtons.forEach((button) => button.addEventListener('click', handleLogout));
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


function apiList(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload;

  if (payload && typeof payload === 'object') {
    for (const key of preferredKeys) {
      if (Array.isArray(payload[key])) return payload[key];
    }

    for (const value of Object.values(payload)) {
      if (Array.isArray(value)) return value;
    }
  }

  return [];
}

function normaliseOperationalRecord(record = {}) {
  const route = record.route && typeof record.route === 'object'
    ? record.route
    : {};

  return {
    ...record,
    id: record.id || record.routeId || '',
    origin:
      record.origin ||
      record.startAddress ||
      route.origin?.label ||
      route.origin ||
      'Start',
    destination:
      record.destination ||
      record.destinationAddress ||
      route.destination?.label ||
      route.destination ||
      'Destination',
    status: String(record.status || 'approved').toLowerCase(),
    route
  };
}

function operationalLoadError(target, label, error) {
  if (!target) return;

  target.className = `${target.className || ''} operational-load-error`.trim();
  target.innerHTML = `
    <div class="mission-empty-state error-state">
      <span class="empty-state-icon">!</span>
      <strong>${escapeHtml(label)} could not load</strong>
      <small>${escapeHtml(error?.message || 'The server returned an unexpected response.')}</small>
      <button type="button" data-retry-operational-load>Retry data load</button>
    </div>
  `;
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

  const label = currentUser
    ? `${currentUser.name || currentUser.email} · ${String(currentUser.role || '').toUpperCase()}`
    : 'Not signed in';

  if (currentUserBadge) {
    currentUserBadge.textContent = label;
  }

  heroCurrentUserNodes.forEach((node) => {
    node.textContent = label;
  });
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
  if (selected === 'overview') {
    setTimeout(() => {
      renderMissionControl();
      scheduleOperationsMapResize({ fit: true });
    }, 120);
  }
}


const OPERATOR_PREFS_KEY = 'coachSafeOperatorPreferencesV1';

function loadOperatorPreferences() {
  let prefs = {};
  try {
    prefs = JSON.parse(localStorage.getItem(OPERATOR_PREFS_KEY) || '{}');
  } catch {
    prefs = {};
  }

  if (prefs.defaultLandingView === 'dashboard') {
    prefs.defaultLandingView = 'overview';
  }

  if (defaultLandingView) {
    defaultLandingView.value =
      prefs.defaultLandingView || 'planner';
  }
  if (prefAvoidTolls) prefAvoidTolls.checked = !!prefs.avoidTolls;
  if (prefAvoidFerries) prefAvoidFerries.checked = prefs.avoidFerries !== false;
  if (prefAvoidUnpaved) prefAvoidUnpaved.checked = prefs.avoidUnpaved !== false;
  if (prefAvoidTunnels) prefAvoidTunnels.checked = !!prefs.avoidTunnels;
  if (prefAvoidLez) prefAvoidLez.checked = !!prefs.avoidLowEmissionZones;
  if (compactDashboard) compactDashboard.checked = !!prefs.compactDashboard;

  document.body.classList.toggle(
    'compact-operator-dashboard',
    !!prefs.compactDashboard
  );

  const routeForm = document.getElementById('routeForm');
  if (routeForm) {
    const setChecked = (name, value) => {
      const input = routeForm.elements[name];
      if (input) input.checked = !!value;
    };
    setChecked('avoidTolls', prefs.avoidTolls);
    setChecked('avoidFerries', prefs.avoidFerries !== false);
    setChecked('avoidUnpaved', prefs.avoidUnpaved !== false);
    setChecked('avoidTunnels', prefs.avoidTunnels);
    setChecked('avoidLowEmissionZones', prefs.avoidLowEmissionZones);
  }

  return prefs;
}

function saveOperatorPreferences() {
  const prefs = {
    defaultLandingView: defaultLandingView?.value || 'planner',
    avoidTolls: !!prefAvoidTolls?.checked,
    avoidFerries: !!prefAvoidFerries?.checked,
    avoidUnpaved: !!prefAvoidUnpaved?.checked,
    avoidTunnels: !!prefAvoidTunnels?.checked,
    avoidLowEmissionZones: !!prefAvoidLez?.checked,
    compactDashboard: !!compactDashboard?.checked
  };

  localStorage.setItem(OPERATOR_PREFS_KEY, JSON.stringify(prefs));
  loadOperatorPreferences();
  return prefs;
}


function applyCommercialCompany(company = {}) {
  currentCompany = company;
  const name = company.brandingName || company.name || 'Coach Safe Company';
  document.querySelectorAll('[data-hero-brand-company]').forEach((n) => n.textContent = name);
  document.querySelectorAll('[data-company-plan]').forEach((n) => {
    const plan = String(company.plan || 'starter').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
    const status = String(company.status || 'trial').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
    n.textContent = `${plan} · ${status}`;
  });
  const branding = company.branding || {};
  if (branding.primaryColor) document.documentElement.style.setProperty('--gold', branding.primaryColor);
  if (branding.secondaryColor) document.documentElement.style.setProperty('--panel', branding.secondaryColor);
  if (company.logoUrl) {
    heroBrandLogos.forEach((n)=>{n.src=company.logoUrl;n.hidden=false;});
    heroBrandInitialsNodes.forEach((n)=>n.hidden=true);
  }
  fillCommercialForms();
  renderCommercialStatus();
}
function fillCommercialForms() {
  if (!currentCompany) return;
  const s=currentCompany.settings||{}, b=currentCompany.branding||{};
  const set=(id,v)=>{const n=document.getElementById(id);if(n)n.value=v??'';};
  set('commercialCompanyName',currentCompany.name); set('commercialLegalName',currentCompany.legalName);
  set('commercialCompanySlug',currentCompany.slug); set('commercialCountry',currentCompany.countryCode||'GB');
  set('commercialTimezone',currentCompany.timezone||'Europe/London'); set('commercialSupportPhone',s.supportPhone);
  set('commercialSupportEmail',s.supportEmail); set('commercialDepotAddress',s.depotAddress);
  set('commercialBrandName',currentCompany.brandingName||currentCompany.name);
  set('commercialPrimaryColor',b.primaryColor||'#edc553'); set('commercialSecondaryColor',b.secondaryColor||'#101821');
  set('commercialDriverTitle',b.driverAppTitle||'Driver Navigation'); set('commercialPdfFooter',b.pdfFooter||'Powered by Coach Safe');
  set('commercialLogoUrl',currentCompany.logoUrl||''); set('onboardCompanyName',currentCompany.name);
  set('onboardLegalName',currentCompany.legalName); set('onboardCountry',currentCompany.countryCode||'GB');
  set('onboardBrandName',currentCompany.brandingName||currentCompany.name); set('onboardPrimaryColour',b.primaryColor||'#edc553');
  set('onboardLogoUrl',currentCompany.logoUrl||'');
}
function renderCommercialStatus() {
  const complete=!!currentCompany?.onboardingComplete;
  const title=document.getElementById('onboardingProgressTitle'), text=document.getElementById('onboardingProgressText');
  if(title) title.textContent=complete?'Company setup complete':'Complete your company setup';
  if(text) text.textContent=complete?'Your company profile and branding are active.':'Finish the onboarding wizard before inviting the wider team.';
  const sum=document.getElementById('commercialSubscriptionSummary');
  if(sum&&currentCompany) sum.innerHTML=`<div><span>Plan</span><strong>${escapeHtml(currentCompany.plan||'starter')}</strong></div><div><span>Status</span><strong>${escapeHtml(currentCompany.status||'trial')}</strong></div><div><span>Workspace</span><strong>${escapeHtml(currentCompany.slug||'—')}</strong></div><div><span>Onboarding</span><strong>${complete?'Complete':'In progress'}</strong></div>`;
}
async function loadCommercialCompany() {
  try { applyCommercialCompany(await api('/api/platform/company')); }
  catch(e){ console.warn('Commercial company API unavailable:',e.message); }
}
async function loadCommercialUsers() {
  const box=document.getElementById('companyUserList'); if(!box)return;
  try { const users=await api('/api/platform/users'); box.innerHTML=users.map(u=>`<article class="commercial-row"><div><strong>${escapeHtml(u.name||u.email)}</strong><span>${escapeHtml(u.email||'')}</span></div><span>${escapeHtml(String(u.role||'').replaceAll('_',' '))}</span><span class="status-pill">${escapeHtml(u.status||'active')}</span></article>`).join('')||'<p class="muted">No users.</p>'; }
  catch(e){box.innerHTML=`<p class="muted">${escapeHtml(e.message)}</p>`;}
}
async function loadCommercialAudit() {
  const box=document.getElementById('commercialAuditList'); if(!box)return;
  try { const rows=await api('/api/platform/audit?limit=50'); box.innerHTML=rows.map(r=>`<article class="commercial-row"><div><strong>${escapeHtml(r.action||'Activity')}</strong><span>${escapeHtml(r.userName||r.userEmail||'System')}</span></div><span>${r.createdAt?new Date(r.createdAt).toLocaleString():'—'}</span></article>`).join('')||'<p class="muted">No audit entries.</p>'; }
  catch(e){box.innerHTML=`<p class="muted">${escapeHtml(e.message)}</p>`;}
}

function diagnosticStatusClass(ok, warning = false) {
  if (!ok) return 'fail';
  return warning ? 'warning' : 'pass';
}

function diagnosticValue(value, fallback = '—') {
  return value === undefined || value === null || value === ''
    ? fallback
    : String(value);
}

function renderDiagnosticReport(report) {
  latestDiagnosticReport = report;
  if (downloadDiagnosticsBtn) downloadDiagnosticsBtn.disabled = false;

  const checks = report.checks || {};
  const failed = Object.values(checks).filter((item) => item && item.ok === false);
  const warnings = (report.findings || []).filter((item) => item.level === 'warning');
  const overall = failed.length ? 'fail' : warnings.length ? 'warning' : 'pass';

  if (diagnosticOverallIcon) {
    diagnosticOverallIcon.className = `diagnostic-overall-icon ${overall}`;
    diagnosticOverallIcon.textContent = overall === 'pass' ? '✓' : overall === 'warning' ? '!' : '×';
  }
  if (diagnosticOverallStatus) {
    diagnosticOverallStatus.textContent = overall === 'pass' ? 'Healthy' : overall === 'warning' ? 'Attention required' : 'Checks failed';
  }
  if (diagnosticCheckedAt) {
    diagnosticCheckedAt.textContent = `Checked ${new Date(report.generatedAt || Date.now()).toLocaleString()}`;
  }

  const cards = [
    ['Database', checks.database, checks.database?.detail || `${diagnosticValue(report.performance?.databaseMs)} ms`],
    ['API', checks.api, checks.api?.detail || `${diagnosticValue(report.performance?.totalMs)} ms total`],
    ['Company', checks.company, checks.company?.detail || report.company?.name || 'Unknown'],
    ['Operational data', checks.operationalData, checks.operationalData?.detail || `${Number(report.counts?.routes || 0)} routes visible`]
  ];
  if (diagnosticSummaryGrid) {
    diagnosticSummaryGrid.innerHTML = cards.map(([title, check, detail]) => `
      <article class="${diagnosticStatusClass(check?.ok, check?.warning)}">
        <span>${escapeHtml(title)}</span>
        <strong>${check?.ok ? (check.warning ? 'Warning' : 'Pass') : 'Fail'}</strong>
        <small>${escapeHtml(detail)}</small>
      </article>`).join('');
  }

  if (diagnosticIdentity) {
    diagnosticIdentity.innerHTML = `
      <div><span>User</span><strong>${escapeHtml(report.user?.name || report.user?.email || 'Unknown')}</strong></div>
      <div><span>Email</span><strong>${escapeHtml(report.user?.email || '—')}</strong></div>
      <div><span>Role</span><strong>${escapeHtml(report.user?.role || '—')}</strong></div>
      <div><span>User company ID</span><strong class="technical-value">${escapeHtml(report.user?.companyId || '—')}</strong></div>
      <div><span>Company</span><strong>${escapeHtml(report.company?.name || 'Unknown')}</strong></div>
      <div><span>Workspace</span><strong>${escapeHtml(report.company?.slug || '—')}</strong></div>
      <div><span>Company ID</span><strong class="technical-value">${escapeHtml(report.company?.id || '—')}</strong></div>
      <div><span>Plan / status</span><strong>${escapeHtml(`${report.company?.plan || '—'} / ${report.company?.status || '—'}`)}</strong></div>`;
  }

  const countEntries = [
    ['Routes', report.counts?.routes], ['Vehicles', report.counts?.vehicles],
    ['Drivers', report.counts?.drivers], ['Road reports', report.counts?.reports],
    ['Journey events', report.counts?.journeyEvents], ['Users', report.counts?.users]
  ];
  if (diagnosticDataCounts) {
    diagnosticDataCounts.innerHTML = countEntries.map(([label,value]) => `
      <article><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong></article>`).join('');
  }

  if (diagnosticTenantWarning) {
    const mismatch = report.tenantMismatch;
    diagnosticTenantWarning.hidden = !mismatch?.suspected;
    diagnosticTenantWarning.innerHTML = mismatch?.suspected
      ? `<strong>Possible company mismatch detected</strong><span>${escapeHtml(mismatch.message || '')}</span>`
      : '';
  }

  if (diagnosticApiTests) {
    diagnosticApiTests.innerHTML = (report.apiTests || []).map((test) => `
      <article class="diagnostic-test ${test.ok ? 'pass' : 'fail'}">
        <span>${test.ok ? '✓' : '×'}</span>
        <div><strong>${escapeHtml(test.name)}</strong><small>${escapeHtml(test.detail || '')}</small></div>
        <time>${Number(test.ms || 0)} ms</time>
      </article>`).join('');
  }
  if (diagnosticApiLatency) diagnosticApiLatency.textContent = `${Number(report.performance?.totalMs || 0)} ms total`;

  if (diagnosticInfrastructure) {
    diagnosticInfrastructure.innerHTML = `
      <div><span>Database</span><strong>${escapeHtml(report.infrastructure?.database || 'Unknown')}</strong></div>
      <div><span>Routing provider</span><strong>${escapeHtml(report.infrastructure?.routingProvider || 'Unknown')}</strong></div>
      <div><span>Node.js</span><strong>${escapeHtml(report.infrastructure?.nodeVersion || '—')}</strong></div>
      <div><span>Environment</span><strong>${escapeHtml(report.infrastructure?.environment || '—')}</strong></div>
      <div><span>Server uptime</span><strong>${escapeHtml(report.infrastructure?.uptime || '—')}</strong></div>
      <div><span>Memory used</span><strong>${escapeHtml(report.infrastructure?.memoryUsed || '—')}</strong></div>`;
  }

  const distribution = report.companyDistribution || [];
  if (diagnosticCompanyDistributionSection) diagnosticCompanyDistributionSection.hidden = !distribution.length;
  if (diagnosticCompanyDistribution && distribution.length) {
    diagnosticCompanyDistribution.innerHTML = `<table><thead><tr><th>Company</th><th>ID</th><th>Users</th><th>Routes</th><th>Vehicles</th><th>Drivers</th><th>Reports</th></tr></thead><tbody>${distribution.map((row) => `
      <tr class="${row.id === report.company?.id ? 'current-company' : ''}"><td>${escapeHtml(row.name || 'Unnamed')}</td><td class="technical-value">${escapeHtml(row.id || '')}</td><td>${Number(row.users||0)}</td><td>${Number(row.routes||0)}</td><td>${Number(row.vehicles||0)}</td><td>${Number(row.drivers||0)}</td><td>${Number(row.reports||0)}</td></tr>`).join('')}</tbody></table>`;
  }

  const endpointError =
    report.endpointError ||
    report.serverError ||
    report.diagnosticsError ||
    null;

  if (diagnosticErrorSection) {
    diagnosticErrorSection.hidden = !endpointError;
  }

  if (diagnosticErrorDetail) {
    diagnosticErrorDetail.innerHTML = endpointError
      ? `
        <div><span>Stage</span><strong>${escapeHtml(endpointError.stage || 'Unknown')}</strong></div>
        <div><span>PostgreSQL code</span><strong class="technical-value">${escapeHtml(endpointError.code || '—')}</strong></div>
        <div class="wide"><span>Message</span><strong>${escapeHtml(endpointError.message || 'No error message supplied.')}</strong></div>
        <div class="wide"><span>Operation</span><code>${escapeHtml(endpointError.operation || endpointError.query || '—')}</code></div>
        <div class="wide"><span>Suggested repair</span><em>${escapeHtml(endpointError.suggestion || 'Review the database schema and server logs before changing data.')}</em></div>
      `
      : '';
  }

  if (diagnosticFindings) {
    const findings = report.findings || [];
    diagnosticFindings.innerHTML = findings.length ? findings.map((item) => `
      <article class="${escapeHtml(item.level || 'info')}"><span></span><div><strong>${escapeHtml(item.title || 'Finding')}</strong><small>${escapeHtml(item.detail || '')}</small>${item.suggestion ? `<em>${escapeHtml(item.suggestion)}</em>` : ''}</div></article>`).join('') : '<article class="pass"><span></span><div><strong>No problems detected</strong><small>All available diagnostic checks passed.</small></div></article>';
  }
}

async function runSystemDiagnostics() {
  if (!runDiagnosticsBtn) return;
  runDiagnosticsBtn.disabled = true;
  runDiagnosticsBtn.textContent = 'Running…';
  const started = performance.now();
  try {
    const serverReport = await api('/api/platform/diagnostics');
    serverReport.client = {
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      location: window.location.origin,
      viewport: `${window.innerWidth}x${window.innerHeight}`
    };
    serverReport.performance = serverReport.performance || {};
    serverReport.performance.clientRoundTripMs = Math.round(performance.now() - started);
    renderDiagnosticReport(serverReport);
    showToast('Diagnostics completed.', 'success');
  } catch (error) {
    const fallbackTests = [];
    for (const [name,path] of [['Health','/api/health'],['Vehicles','/api/vehicles'],['Drivers','/api/drivers'],['Routes','/api/routes'],['Reports','/api/reports']]) {
      const t=performance.now();
      try { const value=await api(path); fallbackTests.push({name,path,ok:true,ms:Math.round(performance.now()-t),detail:Array.isArray(value)?`${value.length} records`:'Responded'}); }
      catch(e){ fallbackTests.push({name,path,ok:false,ms:Math.round(performance.now()-t),detail:e.message}); }
    }
    renderDiagnosticReport({
      generatedAt:new Date().toISOString(),
      user:currentUser||{},
      company:currentCompany||{},
      counts:{routes:approvedRoutes.length,vehicles:vehicles.length,drivers:drivers.length,reports:reports.length,journeyEvents:latestJourneyEvents.length},
      checks:{
        database:{ok:false,detail:'Server endpoint failed before returning database result'},
        api:{ok:fallbackTests.some(t=>t.ok),warning:true,detail:'Browser fallback checks'},
        company:{ok:!!currentUser?.companyId,warning:!currentCompany?.id,detail:currentCompany?.name||'Token has company ID; Company API unresolved'},
        operationalData:{ok:true,warning:!approvedRoutes.length,detail:`${approvedRoutes.length} routes visible in browser`}
      },
      apiTests:fallbackTests,
      performance:{totalMs:Math.round(performance.now()-started)},
      infrastructure:{database:'Server diagnostic endpoint unavailable',routingProvider:'See Health test',nodeVersion:'Server unavailable',environment:'Browser fallback',uptime:'—',memoryUsed:'—'},
      endpointError:{
        stage:'GET /api/platform/diagnostics',
        code:error.code||error.status||'HTTP/API',
        message:error.message||'Diagnostics endpoint failed.',
        operation:'/api/platform/diagnostics',
        suggestion:'Install Stage 1.2.1 and redeploy. Operational data is still visible, so do not move or delete records.'
      },
      findings:[{level:'warning',title:'Server diagnostics endpoint unavailable',detail:error.message,suggestion:'Install the Stage 1.2.1 server diagnostics and redeploy.'}]
    });
    showToast('Fallback diagnostics completed.', 'warning');
  } finally { runDiagnosticsBtn.disabled=false; runDiagnosticsBtn.textContent='Run diagnostics'; }
}

function downloadDiagnosticReport() {
  if (!latestDiagnosticReport) return;
  const safeReport = JSON.parse(JSON.stringify(latestDiagnosticReport));
  if (safeReport.user) delete safeReport.user.token;
  const blob = new Blob([JSON.stringify(safeReport,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=`coach-safe-diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function showCompanyTab(name) {
  document.querySelectorAll('[data-company-tab]').forEach(n=>n.classList.toggle('active',n.dataset.companyTab===name));
  document.querySelectorAll('[data-company-panel]').forEach(n=>n.classList.toggle('active',n.dataset.companyPanel===name));
  if(name==='users')loadCommercialUsers(); if(name==='audit')loadCommercialAudit(); if(name==='system-health' && !latestDiagnosticReport)runSystemDiagnostics();
}
function setCommercialOnboardStep(step) {
  commercialOnboardStep=Math.max(1,Math.min(4,Number(step)||1));
  document.querySelectorAll('[data-onboard-step]').forEach(n=>n.classList.toggle('active',Number(n.dataset.onboardStep)===commercialOnboardStep));
  document.querySelectorAll('[data-onboard-panel]').forEach(n=>n.classList.toggle('active',Number(n.dataset.onboardPanel)===commercialOnboardStep));
  document.getElementById('onboardBack').disabled=commercialOnboardStep===1;
  document.getElementById('onboardNext').hidden=commercialOnboardStep===4;
  document.getElementById('onboardFinish').hidden=commercialOnboardStep!==4;
}
async function saveCommercialCompany(complete=false, onboarding=false) {
  const b=currentCompany?.branding||{}, s=currentCompany?.settings||{};
  const body=onboarding?{
    name:document.getElementById('onboardCompanyName')?.value.trim(),
    legalName:document.getElementById('onboardLegalName')?.value.trim(),
    countryCode:document.getElementById('onboardCountry')?.value||'GB',
    brandingName:document.getElementById('onboardBrandName')?.value.trim(),
    logoUrl:document.getElementById('onboardLogoUrl')?.value.trim(),
    branding:{...b,primaryColor:document.getElementById('onboardPrimaryColour')?.value||'#edc553'},
    settings:{...s,requireVerifiedPins:document.getElementById('onboardPins')?.checked!==false,avoidFerries:document.getElementById('onboardFerries')?.checked!==false,avoidUnpaved:document.getElementById('onboardUnpaved')?.checked!==false},
    onboardingComplete:complete
  }:null;
  if(body) applyCommercialCompany(await api('/api/platform/company',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
}

async function loadPrivateData() {
  if (typeof loadCommercialCompany === 'function') {
    await loadCommercialCompany();
  }

  const results = await Promise.allSettled([
    loadVehicles(),
    loadDrivers(),
    loadApprovedRoutes(),
    loadReports()
  ]);

  const rejected = results.filter((result) => result.status === 'rejected');

  // Final render after every operational dataset has settled.
  renderDashboardStats();

  if (rejected.length) {
    console.error(
      'One or more operational datasets failed:',
      rejected.map((result) => result.reason)
    );
  }

  return {
    ok: rejected.length === 0,
    failures: rejected.length
  };
}

async function handleLogin() {
  const email = String(loginEmail?.value || '').trim().toLowerCase();
  const password = String(loginPassword?.value || '');
  if (!email || !password) {
    if (loginMessage) loginMessage.innerHTML = '<strong>Email and password are required.</strong>';
    return;
  }
  loginButton.disabled = true;
  loginButton.textContent = 'Signing inÔÇª';
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companySlug: loginCompanySlug?.value.trim() || '', email, password })
    });
    setAuth(result.token, result.user);
    unlockApp();
    const operatorPrefs = loadOperatorPreferences();
    switchView(operatorPrefs.defaultLandingView || 'planner');
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
  const supportedViews = new Set([
    'planner',
    'overview',
    'routes',
    'vehicles',
    'drivers',
    'reports',
    'settings'
  ]);

  const selected = supportedViews.has(view) ? view : 'overview';

  document.body.className = document.body.className
    .replace(/\bactive-view-[a-z-]+\b/g, '')
    .trim();
  document.body.classList.add(`active-view-${selected}`);

  viewPanels.forEach((panel) => {
    panel.classList.toggle(
      'active',
      panel.dataset.panel === selected
    );
  });

  workspaceTabs.forEach((tab) => {
    tab.classList.toggle(
      'active',
      tab.dataset.view === selected
    );
  });

  refreshMapSeveralTimes();

  if (focusId) {
    setTimeout(() => {
      document.getElementById(focusId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 120);
  } else {
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  }
}

function routeStatusOptions(current = 'approved') {
  return ['draft', 'approved', 'assigned', 'completed'].map((status) => `<option value="${status}" ${status === current ? 'selected' : ''}>${status[0].toUpperCase()}${status.slice(1)}</option>`).join('');
}

function driverOptions(current = '') {
  return '<option value="">No driver assigned</option>' + drivers.map((d) => `<option value="${escapeHtml(d.id)}" ${d.id === current ? 'selected' : ''}>${escapeHtml(d.name)}${d.base ? ` ÔÇó ${escapeHtml(d.base)}` : ''}</option>`).join('');
}

function driverRouteUrl(id) {
  return `${window.location.origin}/driver-v3/route/${encodeURIComponent(id)}`;
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
  return count ? ` ÔÇó ${count} stop${count === 1 ? '' : 's'}` : '';
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
  return { label, className, detail: `${detail} ÔÇó ${when}` };
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
    latestJourneyEvents = apiList(
      await api('/api/journey-events?limit=250'),
      ['events', 'journeyEvents', 'data']
    );
  } catch (error) {
    latestJourneyEvents = [];
    console.warn('Could not load journey tracking', error);
  }
  buildRouteTrackingMap(approvedRoutes, latestJourneyEvents);
  renderOverviewActivity();
  renderOperatorPriorities();
  renderMissionControl();
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

  return `Hi ${driver}, your coach route has been assigned.\n\nRoute: ${record?.origin || record?.startAddress || 'Start'} ÔåÆ ${record?.destination || record?.destinationAddress || 'Destination'}\nVehicle: ${vehicleText}\nRisk score: ${riskScore}/100 (${riskLevel})\n\nOpen your live route here:\n${driverRouteUrl(record.id)}\n\nRoute pack / printable guidance:\n${routePackUrl(record.id)}\n\nSafety warning summary:\n${warningSummary}\n\nPlease review the safety warnings before departure and follow all road signs, restrictions and operator instructions.`;
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


function routeLifecycle(status = 'approved', tracking = null) {
  const stages = [
    ['draft', 'Planning'],
    ['approved', 'Approved'],
    ['assigned', 'Assigned'],
    ['started', 'Started'],
    ['on-route', 'On route'],
    ['completed', 'Completed']
  ];

  const normalStatus = String(status || 'approved').toLowerCase();
  let currentIndex = {
    draft: 0,
    approved: 1,
    assigned: 2,
    completed: 5
  }[normalStatus] ?? 1;

  if (tracking) {
    if (['tracking-active'].includes(tracking.className)) currentIndex = Math.max(currentIndex, 2);
    if (['tracking-live', 'tracking-alert', 'tracking-rerouted'].includes(tracking.className)) currentIndex = 4;
    if (tracking.className === 'tracking-completed') currentIndex = 5;
  }

  return `<div class="route-lifecycle">${stages.map((stage, index) => `
    <div class="${index < currentIndex ? 'done' : index === currentIndex ? 'current' : ''}">
      <span>${index < currentIndex ? '✓' : index + 1}</span>
      <small>${stage[1]}</small>
    </div>
  `).join('')}</div>`;
}

function renderPlatformStatus(health = null) {
  const routingReady = !!health?.providerReady;
  const databaseReady = health?.databaseReady !== false;

  document.querySelectorAll('.platform-status-strip').forEach((strip) => {
    const routing = strip.querySelector('[data-status="routing"]');
    const database = strip.querySelector('[data-status="database"]');

    if (routing) {
      routing.querySelector('.status-dot')?.classList.toggle('ready', routingReady);
      const small = routing.querySelector('small');
      if (small) small.textContent = routingReady ? 'Online' : 'Unavailable';
    }

    if (database) {
      database.querySelector('.status-dot')?.classList.toggle('ready', databaseReady);
      const small = database.querySelector('small');
      if (small) small.textContent = databaseReady ? 'Connected' : 'Unavailable';
    }
  });
}

function renderModuleKpis() {
  const assignedVehicleIds = new Set(
    approvedRoutes
      .filter((route) => ['assigned', 'completed'].includes(String(route.status || '').toLowerCase()))
      .map((route) => route.vehicleDatabaseId || route.route?.vehicle?.id)
      .filter(Boolean)
  );

  const assignedDriverIds = new Set(
    approvedRoutes
      .filter((route) => ['assigned', 'completed'].includes(String(route.status || '').toLowerCase()))
      .map((route) => route.driverId)
      .filter(Boolean)
  );

  const render = (container, values) => {
    if (!container) return;
    container.querySelectorAll('strong').forEach((node, index) => {
      node.textContent = String(values[index] ?? 0);
    });
  };

  render(vehicleKpis, [
    vehicles.length,
    assignedVehicleIds.size,
    Math.max(vehicles.length - assignedVehicleIds.size, 0),
    vehicles.filter((vehicle) =>
      Number(vehicle.heightM) > 0 &&
      Number(vehicle.widthM) > 0 &&
      Number(vehicle.lengthM) > 0 &&
      Number(vehicle.weightKg) > 0
    ).length
  ]);

  render(driverKpis, [
    drivers.length,
    assignedDriverIds.size,
    Math.max(drivers.length - assignedDriverIds.size, 0),
    drivers.filter((driver) => driver.phone || driver.email).length
  ]);

  const today = new Date();
  const isToday = (value) => {
    if (!value) return false;
    const date = new Date(value);
    return date.toDateString() === today.toDateString();
  };

  render(reportKpis, [
    reports.length,
    reports.filter((report) => isToday(report.createdAt)).length,
    reports.filter((report) => report.routeId).length,
    reports.length
  ]);
}


function animateNumber(node,value,duration=420){if(!node)return;const target=Number(value)||0,start=Number(node.dataset.currentValue||node.textContent||0)||0,started=performance.now();function frame(now){const p=Math.min(1,(now-started)/duration),e=1-Math.pow(1-p,3);node.textContent=String(Math.round(start+(target-start)*e));if(p<1)requestAnimationFrame(frame);else node.dataset.currentValue=String(target)}requestAnimationFrame(frame)}
function routeNeedsAction(route){return String(route.status||'').toLowerCase()==='draft'||!route.driverId||!route.vehicleDatabaseId}
function missionRouteStatus(route){const t=missionTracking(route),s=String(route.status||'approved').toLowerCase();if(t.className==='tracking-alert')return'alert';if(['tracking-live','tracking-rerouted','tracking-active'].includes(t.className))return'active';if(s==='completed')return'completed';if(routeNeedsAction(route))return'needs-action';return'assigned'}
function renderOperationalSummary(){if(!operationalSummaryTitle||!operationalSummaryText)return;const routes=missionTodayRoutes(),needs=routes.filter(routeNeedsAction).length,active=routes.filter(r=>missionRouteStatus(r)==='active').length,critical=routes.filter(r=>missionTracking(r).className==='tracking-alert').length,available=Math.max(vehicles.length-new Set(routes.map(r=>r.vehicleDatabaseId).filter(Boolean)).size,0),company=currentCompany?.brandingName||currentCompany?.name||settings.companyName||'Your operation';operationalSummaryTitle.textContent=`${company}: ${routes.length} journey${routes.length===1?'':'s'} in view`;const parts=[`${active} active`,`${needs} requiring action`,`${available} vehicle${available===1?'':'s'} available`,critical?`${critical} critical alert${critical===1?'':'s'}`:'no critical journey alerts'];operationalSummaryText.textContent=parts.join(' · ')+'.'}
function missionEmptyState(title,detail,actionLabel='',actionView=''){return `<div class="mission-empty-state"><span class="empty-state-icon">◇</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small>${actionLabel&&actionView?`<button type="button" data-view-shortcut="${escapeHtml(actionView)}">${escapeHtml(actionLabel)}</button>`:''}</div>`}
function missionTodayRoutes() {
  const today = new Date().toDateString();
  const todays = approvedRoutes.filter((route) => {
    const value =
      route.route?.departureAt ||
      route.route?.journeyDate ||
      route.departureAt ||
      route.createdAt;
    return value && new Date(value).toDateString() === today;
  });

  return todays.length ? todays : approvedRoutes.slice(0, 12);
}

function missionTracking(route) {
  return routeTrackingMap[route.id] || {
    label: route.driverId ? 'Assigned' : 'Not assigned',
    className: route.driverId ? 'tracking-waiting' : 'tracking-idle',
    detail: ''
  };
}

function eventGps(event = {}) {
  const metadata = event.metadata || {};
  const lat = Number(metadata.lat ?? metadata.latitude);
  const lng = Number(metadata.lng ?? metadata.lon ?? metadata.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function routePointsForMission(route = {}) {
  const stored = route.route || {};
  const candidates = [
    stored.points,
    stored.geometry,
    stored.routePoints,
    stored.coordinates
  ];

  const raw = candidates.find(Array.isArray) || [];
  return raw.map((point) => {
    if (Array.isArray(point)) {
      return [Number(point[0]), Number(point[1])];
    }
    return [
      Number(point.lat ?? point.latitude),
      Number(point.lon ?? point.lng ?? point.longitude)
    ];
  }).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

function scheduleOperationsMapResize({ fit = false } = {}) {
  if (!operationsMap || !operationsMapElement) return;

  operationsMapResizeTimers.forEach((timer) => clearTimeout(timer));
  operationsMapResizeTimers = [];

  [0, 80, 220, 480, 900].forEach((delay, index) => {
    const timer = setTimeout(() => {
      if (!operationsMap || !operationsMapElement?.offsetParent) return;

      operationsMap.invalidateSize({
        pan: false,
        animate: false
      });

      if (fit && index === 4 && missionMapBounds.length) {
        operationsMap.fitBounds(missionMapBounds, {
          padding: [35, 35],
          maxZoom: 13,
          animate: false
        });
      }
    }, delay);

    operationsMapResizeTimers.push(timer);
  });
}

function observeOperationsMapSize() {
  if (!operationsMapElement || operationsMapResizeObserver) return;

  if ('ResizeObserver' in window) {
    operationsMapResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const width = entry.contentRect?.width || 0;
      const height = entry.contentRect?.height || 0;

      if (width > 100 && height > 100) {
        scheduleOperationsMapResize();
      }
    });

    operationsMapResizeObserver.observe(operationsMapElement);
  }

  window.addEventListener('resize', () => {
    scheduleOperationsMapResize();
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleOperationsMapResize({ fit: true });
  });
}

function initialiseOperationsMap() {
  if (!operationsMapElement || operationsMap) return;
  operationsMap = L.map(operationsMapElement, {
    zoomControl: true,
    preferCanvas: true
  }).setView([54.4, -3.2], 6);

  L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }
  ).addTo(operationsMap);

  operationsMapLayer = L.layerGroup().addTo(operationsMap);
  observeOperationsMapSize();
  scheduleOperationsMapResize();
}

function renderOperationsMap() {
  if (!operationsMapElement) return;
  initialiseOperationsMap();
  operationsMapLayer?.clearLayers();

  const bounds = [];
  let rendered = 0;
  missionMapBounds=[];

  if(missionMapLayers.routes) approvedRoutes.slice(0, 40).forEach((route) => {
    const points = routePointsForMission(route);
    if (points.length < 2) return;

    const tracking = missionTracking(route);
    const isAlert = tracking.className === 'tracking-alert';
    const isActive = [
      'tracking-live',
      'tracking-rerouted',
      'tracking-alert'
    ].includes(tracking.className);

    const line = L.polyline(points, {
      weight: isActive ? 5 : 3,
      opacity: isActive ? 0.92 : 0.55,
      dashArray: isActive ? null : '7 8'
    }).bindPopup(`
      <strong>${escapeHtml(route.origin || 'Start')} → ${escapeHtml(route.destination || 'Destination')}</strong><br>
      ${escapeHtml(tracking.label || route.status || 'Route')}<br>
      ${escapeHtml(route.driver?.name || 'No driver assigned')}
    `);

    line.addTo(operationsMapLayer);
    bounds.push(...points);
    rendered += 1;
  });

  const latestGpsByRoute = new Map();
  latestJourneyEvents.forEach((event) => {
    if (!event.routeId || latestGpsByRoute.has(event.routeId)) return;
    const gps = eventGps(event);
    if (gps) latestGpsByRoute.set(event.routeId, { event, gps });
  });

  if(missionMapLayers.fleet) latestGpsByRoute.forEach(({ event, gps }, routeId) => {
    const route = approvedRoutes.find((item) => item.id === routeId);
    const tracking = route ? missionTracking(route) : null;
    const marker = L.circleMarker([gps.lat, gps.lng], {
      radius: 9,
      weight: 3,
      fillOpacity: 0.9
    }).bindPopup(`
      <strong>${escapeHtml(route?.vehicleRecord?.name || route?.route?.vehicle?.name || 'Coach')}</strong><br>
      ${escapeHtml(route?.driver?.name || event.driverName || 'Driver')}<br>
      ${escapeHtml(tracking?.label || humanEventLabel(event))}
    `);

    marker.addTo(operationsMapLayer);
    bounds.push([gps.lat, gps.lng]);
    rendered += 1;
  });

  if(missionMapLayers.reports){reports.forEach(report=>{const lat=Number(report.lat),lng=Number(report.lon??report.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return;L.circleMarker([lat,lng],{radius:7,weight:2,fillOpacity:.85}).bindPopup(`<strong>${escapeHtml(report.issueType||'Road report')}</strong><br>${escapeHtml(report.roadName||report.location||'Location')}`).addTo(operationsMapLayer);bounds.push([lat,lng]);rendered+=1})}

  if (operationsMapEmpty) operationsMapEmpty.hidden = rendered > 0;

  missionMapBounds=bounds;

  if (bounds.length) {
    operationsMap.fitBounds(bounds, { padding: [35, 35], maxZoom: 13 });
  } else {
    operationsMap.setView([54.4, -3.2], 6);
  }

  scheduleOperationsMapResize({ fit: bounds.length > 0 });
}

function renderMissionKpis() {
  const routes = missionTodayRoutes();
  const active = routes.filter((route) => [
    'tracking-live',
    'tracking-alert',
    'tracking-rerouted',
    'tracking-active'
  ].includes(missionTracking(route).className)).length;

  const assignedVehicleIds = new Set(
    routes.map((route) => route.vehicleDatabaseId).filter(Boolean)
  );
  const assignedDriverIds = new Set(
    routes.map((route) => route.driverId).filter(Boolean)
  );
  const alerts = reports.length + routes.filter(
    (route) => missionTracking(route).className === 'tracking-alert'
  ).length;
  const unassigned = routes.filter((route) =>
    String(route.status || '').toLowerCase() === 'approved' &&
    (!route.driverId || !route.vehicleDatabaseId)
  ).length;

  const set = (id, value) => animateNumber(document.getElementById(id), value);
  const availableVehicles=Math.max(vehicles.length-assignedVehicleIds.size,0);
  const availableDrivers=Math.max(drivers.length-assignedDriverIds.size,0);
  set('missionJourneys',routes.length); set('missionActive',active); set('missionVehicles',availableVehicles); set('missionDrivers',availableDrivers); set('missionAlerts',alerts); set('missionUnassigned',unassigned);
  const jd=document.getElementById('missionJourneysDetail'),vd=document.getElementById('missionVehiclesDetail'),dd=document.getElementById('missionDriversDetail');
  if(jd)jd.textContent=`${routes.filter(r=>r.status==='assigned').length} assigned · ${routes.filter(r=>r.status==='completed').length} completed`;
  if(vd)vd.textContent=`${assignedVehicleIds.size} assigned · ${vehicles.length} total`;
  if(dd)dd.textContent=`${assignedDriverIds.size} assigned · ${drivers.length} total`;

  const company =
    currentCompany?.brandingName ||
    currentCompany?.name ||
    settings.companyName ||
    'Coach operation';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const greetingNode = document.getElementById('missionGreeting');
  const companyNode = document.getElementById('missionCompanyHeading');
  const dateNode = document.getElementById('missionDateLine');

  if (greetingNode) greetingNode.textContent = greeting;
  if (companyNode) companyNode.textContent = company;
  if (dateNode) {
    dateNode.textContent = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date());
  }
}

function renderMissionDispatch(){if(!missionDispatchBoard)return;const filter=dispatchStatusFilter?.value||'all',routes=missionTodayRoutes().filter(r=>filter==='all'||missionRouteStatus(r)===filter);if(!routes.length){missionDispatchBoard.innerHTML=missionEmptyState(filter==='all'?'No journeys planned':'No journeys match this filter',filter==='all'?'Plan and approve a route to begin dispatching.':'Choose another status or open Saved Routes.',filter==='all'?'Plan a journey':'Open saved routes',filter==='all'?'planner':'routes');return}missionDispatchBoard.innerHTML=routes.map(route=>{const t=missionTracking(route),status=missionRouteStatus(route),tv=route.route?.departureAt||route.route?.journeyDate||route.createdAt,time=tv?new Date(tv).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—',driver=route.driver?.name||'Driver required',vehicle=route.vehicleRecord?.name||route.route?.vehicle?.name||'Vehicle required';return `<article class="dispatch-card ${escapeHtml(status)}"><div class="dispatch-card-time"><time>${escapeHtml(time)}</time><span>${escapeHtml(status.replaceAll('-',' '))}</span></div><div class="dispatch-card-route"><strong>${escapeHtml(route.origin||'Start')}</strong><span class="route-arrow">→</span><strong>${escapeHtml(route.destination||'Destination')}</strong></div><div class="dispatch-card-assignments"><div><small>Driver</small><strong>${escapeHtml(driver)}</strong></div><div><small>Vehicle</small><strong>${escapeHtml(vehicle)}</strong></div></div><div class="dispatch-card-status"><span class="tracking-badge ${escapeHtml(t.className)}">${escapeHtml(t.label)}</span><small>${escapeHtml(t.detail||route.status||'')}</small></div><div class="dispatch-card-actions"><button type="button" data-open-driver-route="${escapeHtml(route.id)}">Track</button><button type="button" data-copy-assignment="${escapeHtml(route.id)}">Message</button><button type="button" data-view-shortcut="routes">Manage</button></div></article>`}).join('')}

function renderMissionNotifications() {
  if (!missionNotifications) return;
  const notifications = [];

  approvedRoutes.forEach((route) => {
    const tracking = missionTracking(route);
    if (tracking.className === 'tracking-alert') {
      notifications.push({
        level: 'danger',
        title: tracking.label,
        detail: `${route.origin} → ${route.destination}`
      });
    }
    if (String(route.status || '').toLowerCase() === 'approved' && !route.driverId) {
      notifications.push({
        level: 'warning',
        title: 'Driver assignment required',
        detail: `${route.origin} → ${route.destination}`
      });
    }
  });

  reports.slice(0, 4).forEach((report) => {
    notifications.push({
      level: 'info',
      title: report.issueType || 'Road report',
      detail: report.roadName || report.location || 'Location not supplied'
    });
  });

  if (!notifications.length) { missionNotifications.innerHTML=missionEmptyState('No operational alerts','Coach Safe has not recorded any journey or road warnings.'); return; }
  missionNotifications.innerHTML=notifications.slice(0,7).map(item=>`<article class="notification-item ${item.level}" data-view-shortcut="${item.level==='info'?'reports':'routes'}"><span></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div><b>›</b></article>`).join('');
}

function renderMissionReadiness() {
  if (missionFleetStatus) {
    const complete = vehicles.filter((vehicle) =>
      Number(vehicle.heightM) &&
      Number(vehicle.widthM) &&
      Number(vehicle.lengthM) &&
      Number(vehicle.weightKg)
    ).length;
    const incomplete = Math.max(vehicles.length - complete, 0);

    missionFleetStatus.innerHTML=vehicles.length?`<div class="readiness-item good"><strong>${vehicles.length}</strong><span>Total vehicles</span><i></i></div><div class="readiness-item good"><strong>${complete}</strong><span>Routing profiles ready</span><i></i></div><div class="readiness-item ${incomplete?'warning':'good'}"><strong>${incomplete}</strong><span>Profiles incomplete</span><i></i></div>`:missionEmptyState('No vehicles added','Add the company fleet to begin matching coaches to journeys.','Add vehicle','vehicles');
  }

  if (missionDriverStatus) {
    const contactReady = drivers.filter((driver) => driver.phone || driver.email).length;
    const assigned = new Set(approvedRoutes.map((route) => route.driverId).filter(Boolean)).size;

    missionDriverStatus.innerHTML=drivers.length?`<div class="readiness-item good"><strong>${drivers.length}</strong><span>Total drivers</span><i></i></div><div class="readiness-item ${assigned?'active':'good'}"><strong>${assigned}</strong><span>Currently assigned</span><i></i></div><div class="readiness-item ${contactReady<drivers.length?'warning':'good'}"><strong>${contactReady}</strong><span>Contact details ready</span><i></i></div>`:missionEmptyState('No drivers added','Add drivers before assigning journeys.','Add driver','drivers');
  }
}

function renderMissionControl() {
  renderMissionKpis();
  renderOperationalSummary();
  renderMissionDispatch();
  renderMissionNotifications();
  renderMissionReadiness();
  renderOperationsMap();

  const priorityBadge = document.getElementById('priorityCountBadge');
  if (priorityBadge && operatorPriorities) {
    priorityBadge.textContent =
      String(operatorPriorities.querySelectorAll('.priority-item.warning,.priority-item.danger').length);
  }
}

function renderOperatorPriorities() {
  if (!operatorPriorities) return;

  const draftRoutes = approvedRoutes.filter((route) =>
    String(route.status || '').toLowerCase() === 'draft'
  ).length;

  const approvedUnassigned = approvedRoutes.filter((route) =>
    String(route.status || '').toLowerCase() === 'approved' &&
    !route.driverId
  ).length;

  const activeAlerts = Object.values(routeTrackingMap).filter((tracking) =>
    tracking.className === 'tracking-alert'
  ).length;

  const incompleteVehicles = vehicles.filter((vehicle) =>
    !Number(vehicle.heightM) ||
    !Number(vehicle.widthM) ||
    !Number(vehicle.lengthM) ||
    !Number(vehicle.weightKg)
  ).length;

  const priorities = [
    {
      level: draftRoutes ? 'warning' : 'good',
      title: `${draftRoutes} route${draftRoutes === 1 ? '' : 's'} awaiting approval`,
      detail: draftRoutes ? 'Open Saved Routes and complete the safety review.' : 'No draft routes require approval.'
    },
    {
      level: approvedUnassigned ? 'warning' : 'good',
      title: `${approvedUnassigned} approved route${approvedUnassigned === 1 ? '' : 's'} without a driver`,
      detail: approvedUnassigned ? 'Assign a driver before departure.' : 'Approved routes have driver assignments.'
    },
    {
      level: activeAlerts ? 'danger' : 'good',
      title: `${activeAlerts} live route alert${activeAlerts === 1 ? '' : 's'}`,
      detail: activeAlerts ? 'Review the latest driver activity immediately.' : 'No active journey alerts.'
    },
    {
      level: incompleteVehicles ? 'warning' : 'good',
      title: `${incompleteVehicles} vehicle profile${incompleteVehicles === 1 ? '' : 's'} missing routing dimensions`,
      detail: incompleteVehicles ? 'Complete height, width, length and weight.' : 'All vehicle profiles contain routing dimensions.'
    },
    {
      level: reports.length ? 'info' : 'good',
      title: `${reports.length} road report${reports.length === 1 ? '' : 's'} recorded`,
      detail: reports.length ? 'Review reports before planning affected journeys.' : 'No road reports are currently recorded.'
    }
  ];

  operatorPriorities.innerHTML = priorities.map((item) => `
    <article class="priority-item ${item.level}">
      <span class="priority-icon"></span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </div>
    </article>
  `).join('');
}

function humanEventLabel(event = {}) {
  const labels = {
    operator_route_updated: 'Route assignment updated',
    driver_route_opened: 'Driver opened route',
    driver_route_pack_opened: 'Route pack opened',
    gps_started: 'Driver GPS started',
    gps_stopped: 'Driver GPS stopped',
    journey_started: 'Journey started',
    off_route_warning: 'Off-route warning',
    reroute_calculated: 'Coach-safe reroute calculated',
    road_report_submitted: 'Road report submitted',
    route_completed: 'Journey completed'
  };

  return labels[event.eventType] || event.message || 'Journey activity';
}

function renderOverviewActivity() {
  if (!overviewActivityFeed) return;

  const items = latestJourneyEvents.slice(0, 10);

  if (!items.length) {
    overviewActivityFeed.innerHTML =
      '<p class="muted">No driver activity has been recorded yet.</p>';
    return;
  }

  overviewActivityFeed.innerHTML = items.map((event) => {
    const route = approvedRoutes.find((item) => item.id === event.routeId);
    const when = event.createdAt
      ? new Date(event.createdAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';

    return `<article class="overview-activity-item">
      <time>${escapeHtml(when)}</time>
      <div>
        <strong>${escapeHtml(humanEventLabel(event))}</strong>
        <small>${escapeHtml(route ? `${route.origin} → ${route.destination}` : event.message || 'Coach Safe activity')}</small>
      </div>
    </article>`;
  }).join('');
}

function renderDashboardStats() {
  const assigned = approvedRoutes.filter((r) => r.status === 'assigned').length;
  const liveCount = Object.values(routeTrackingMap).filter((t) =>
    ['tracking-live', 'tracking-alert', 'tracking-rerouted'].includes(t.className)
  ).length;

  // The original dashboardStats card no longer exists in Mission Control.
  // Keep supporting it when present, but never block the new dashboard.
  if (dashboardStats) {
    dashboardStats.innerHTML = `
      <div class="dash-stat"><strong>${approvedRoutes.length}</strong><span>Saved routes</span></div>
      <div class="dash-stat"><strong>${assigned}</strong><span>Assigned routes</span></div>
      <div class="dash-stat"><strong>${liveCount}</strong><span>Live / active</span></div>
      <div class="dash-stat"><strong>${reports.length}</strong><span>Road reports</span></div>
    `;
  }

  renderModuleKpis();
  renderOperatorPriorities();
  renderOverviewActivity();
  renderMissionControl();
}

function applyBranding() {
  const company = settings.companyName || 'Point 2 Point';
  const appName = settings.appName || 'Coach Safe Route Planner';
  if (brandCompany) brandCompany.textContent = `${company} Operations MVP`;
  if (brandTitle) brandTitle.textContent = appName;
  heroBrandCompanyNodes.forEach((node) => {
    node.textContent = company;
  });
  heroBrandTitleNodes.forEach((node) => {
    node.textContent = appName;
  });
  document.title = `${appName} | ${company}`;
  if (companyNameInput) companyNameInput.value = company;
  if (appNameInput) appNameInput.value = appName;
  if (accentNameInput) accentNameInput.value = settings.accentName || 'Gold / Black';
  const logo = settings.logoDataUrl || '';
  pendingLogoDataUrl = logo;
  if (logo) {
    if (brandLogo) { brandLogo.src = logo; brandLogo.hidden = false; }
    if (brandInitials) brandInitials.hidden = true;
    heroBrandLogos.forEach((node) => {
      node.src = logo;
      node.hidden = false;
    });
    heroBrandInitialsNodes.forEach((node) => {
      node.hidden = true;
    });
    if (logoPreview) { logoPreview.src = logo; logoPreview.hidden = false; }
    if (logoPreviewText) logoPreviewText.textContent = 'Logo uploaded';
  } else {
    if (brandLogo) brandLogo.hidden = true;
    if (brandInitials) brandInitials.hidden = false;
    heroBrandLogos.forEach((node) => {
      node.hidden = true;
    });
    heroBrandInitialsNodes.forEach((node) => {
      node.hidden = false;
    });
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
    <strong>${escapeHtml(route.origin.label)} ÔåÆ ${escapeHtml(route.destination.label)}</strong>
    <span>${metresToMiles(s.lengthInMeters || 0)} miles ÔÇó ${secondsToText(s.travelTimeInSeconds || 0)}${stopsText(route)} ÔÇó ${route.provider === 'tomtom' ? 'Live TomTom road route' : 'Mock/demo route'}${driver ? ` ÔÇó Driver: ${escapeHtml(driver.name)}` : ''}</span>
  `;
}

async function loadHealth() {
  const health = await api('/api/health');
  renderPlatformStatus(health);
  providerStatus.innerHTML = health.providerReady
    ? `<strong>Live road routing ready</strong><br>TomTom enabled ÔÇó Country: ${health.defaultCountrySet} ÔÇó Mode: ${health.travelMode}`
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
      ${entries.map(([key, preset]) => `<option value="${escapeHtml(key)}">${escapeHtml(preset.name || key)}${preset.seats ? ` ÔÇó ${escapeHtml(preset.seats)} seats` : ''}</option>`).join('')}
    </optgroup>
  `).join('');

  presetSelect.value = presets[current] ? current : 'standard';
  setPresetFields(presetSelect.value);
}

async function loadVehicles() {
  try {
    const payload = await api('/api/vehicles');
    vehicles = apiList(payload, ['vehicles', 'data']).map((vehicle) => ({
      ...vehicle,
      id: vehicle.id || vehicle.vehicleId || ''
    }));
  } catch (error) {
    vehicles = [];
    operationalLoadError(vehicleList, 'Vehicles', error);
    throw error;
  }

  vehicleSelect.innerHTML = '<option value="">Use manual coach profile</option>' + vehicles.map((v) => `
    <option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}${v.registration ? ` ÔÇó ${escapeHtml(v.registration)}` : ''}</option>
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
      <span>${escapeHtml(v.registration || 'No registration')} ÔÇó ${escapeHtml(v.heightM)}m H ÔÇó ${escapeHtml(v.widthM)}m W ÔÇó ${escapeHtml(v.lengthM)}m L ÔÇó ${Number(v.weightKg || 0).toLocaleString()}kg</span>
      <div class="card-actions">
        <button class="secondary" data-action="use-vehicle" data-id="${escapeHtml(v.id)}">Use</button>
        <button class="secondary danger" data-action="delete-vehicle" data-id="${escapeHtml(v.id)}">Delete</button>
      </div>
    </div>
  `).join('');
}

async function loadDrivers() {
  try {
    const payload = await api('/api/drivers');
    drivers = apiList(payload, ['drivers', 'data']).map((driver) => ({
      ...driver,
      id: driver.id || driver.driverId || ''
    }));
  } catch (error) {
    drivers = [];
    operationalLoadError(driverList, 'Drivers', error);
    throw error;
  }

  driverSelect.innerHTML = '<option value="">No driver assigned</option>' + drivers.map((d) => `
    <option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}${d.base ? ` ÔÇó ${escapeHtml(d.base)}` : ''}</option>
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
      <span>${escapeHtml(d.phone || 'No phone')} ${d.email ? `ÔÇó ${escapeHtml(d.email)}` : ''} ${d.base ? `ÔÇó ${escapeHtml(d.base)}` : ''}</span>
      <div class="card-actions">
        <button class="secondary" data-action="assign-driver" data-id="${escapeHtml(d.id)}">Assign</button>
        <button class="secondary danger" data-action="delete-driver" data-id="${escapeHtml(d.id)}">Delete</button>
      </div>
    </div>
  `).join('');
}

async function loadApprovedRoutes() {
  try {
    const payload = await api('/api/routes');
    approvedRoutes = apiList(
      payload,
      ['routes', 'approvedRoutes', 'records', 'data']
    ).map(normaliseOperationalRecord);
  } catch (error) {
    approvedRoutes = [];
    operationalLoadError(approvedRoutesEl, 'Saved routes', error);
    throw error;
  }

  await refreshJourneyTracking();
  renderDashboardStats();

  if (!approvedRoutes.length) {
    approvedRoutesEl.className = 'saved-routes empty';
    approvedRoutesEl.innerHTML = missionEmptyState(
      'No routes visible for this company',
      'The database is connected, but the routes API returned no company-scoped records. Run System Health if routes are expected.',
      'Run diagnostics',
      'settings'
    );
    return;
  }
  approvedRoutesEl.className = 'saved-routes';
  approvedRoutesEl.innerHTML = approvedRoutes.map((r) => {
    const shareUrl = driverRouteUrl(r.id);
    const tracking = routeTrackingMap[r.id] || routeTrackingFromEvent(r, null);
    return `
    <div class="saved-item" data-route-id="${escapeHtml(r.id)}">
      <strong>${escapeHtml(r.origin)} ÔåÆ ${escapeHtml(r.destination)}</strong>
      <span>${escapeHtml(r.route?.vehicle?.name || 'Coach')} ÔÇó ${escapeHtml(r.driver?.name || 'No driver')} ÔÇó ${new Date(r.createdAt).toLocaleString()}</span>
      <span class="badge">Risk ${escapeHtml(r.route?.risk?.score ?? '-')}/100 ÔÇó ${escapeHtml(r.route?.risk?.level || 'Not scored')}</span>
      <span class="status-pill">${escapeHtml(r.status || 'approved')}</span>
      ${routeLifecycle(r.status || 'approved', tracking)}
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
        <div class="journey-events-list muted">Click ÔÇ£View journey eventsÔÇØ to load driver activity.</div>
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
  try {
    const payload = await api('/api/reports');
    reports = apiList(
      payload,
      ['reports', 'roadReports', 'records', 'data']
    );
  } catch (error) {
    reports = [];
    operationalLoadError(reportList, 'Road reports', error);
    throw error;
  }

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
      <span>${escapeHtml(r.roadName || 'Unnamed location')} ÔÇó ${new Date(r.createdAt).toLocaleString()}</span>
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
      <div class="eyebrow">Point 2 Point ÔÇó Coach Safe Route Export</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${escapeHtml(miles)} miles ÔÇó ${escapeHtml(time)} ÔÇó ${escapeHtml(route.provider === 'tomtom' ? 'Live TomTom road route' : 'Mock/demo route - not road accurate')}</div>
    </div>
    <div class="buttons">
      <button type="button" onclick="fitRouteForPrint()">Fit route</button>
      <button type="button" onclick="window.print()">Print / Save PDF</button>
    </div>
  </header>
  <main class="route-layout">
    <section class="map-wrap">
      <div id="exportMap"></div>
      <div class="map-note"><span>Use + / ÔêÆ to zoom. Drag the map to inspect roads and junctions.</span><span>Exported ${new Date().toLocaleString()}</span></div>
    </section>
    <aside class="panel">
      <h2>Route summary</h2>
      <div class="stats">
        <div class="stat"><strong>Distance</strong>${escapeHtml(miles)} miles</div>
        <div class="stat"><strong>Time</strong>${escapeHtml(time)}</div>
        <div class="stat"><strong>Vehicle</strong>${escapeHtml(route.vehicle?.name || 'Coach')}<br>${escapeHtml(route.vehicle?.registration || '')}</div>
        <div class="stat"><strong>Dimensions</strong>${escapeHtml(route.vehicle?.heightM)}m H ÔÇó ${escapeHtml(route.vehicle?.widthM)}m W ÔÇó ${escapeHtml(route.vehicle?.lengthM)}m L</div>
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
  button.textContent = 'Calculating routeÔÇª';
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
  saveButton.textContent = 'SavingÔÇª';
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
  list.textContent = 'Loading journey eventsÔÇª';
  try {
    const events = await api(`/api/routes/${encodeURIComponent(id)}/events`);
    if (!events.length) {
      list.innerHTML = '<p>No driver journey events recorded yet.</p>';
      return;
    }
    list.innerHTML = events.map((ev) => {
      const meta = ev.metadata || {};
      const extra = meta.distanceM ? ` ÔÇó ${escapeHtml(String(meta.distanceM))}m from route` : '';
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
    button.textContent = 'RefreshingÔÇª';
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
    button.textContent = 'Loading eventsÔÇª';
    try {
      await loadJourneyEventsForRoute(id, card);
      button.textContent = 'Refresh events';
    } finally {
      button.disabled = false;
      if (button.textContent === 'Loading eventsÔÇª') button.textContent = oldText;
    }
  }
  if (action === 'save-route-management') {
    const card = button.closest('.saved-item');
    const status = card?.querySelector('[data-field="status"]')?.value || 'approved';
    const driverId = card?.querySelector('[data-field="driverId"]')?.value || '';
    button.disabled = true;
    button.textContent = 'SavingÔÇª';
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




document.addEventListener('click', (event) => {
  const driverButton = event.target.closest('[data-open-driver-route]');
  if (driverButton) {
    window.open(driverUrl(driverButton.dataset.openDriverRoute), '_blank');
    return;
  }

  const messageButton = event.target.closest('[data-copy-assignment]');
  if (messageButton) {
    const route = approvedRoutes.find(
      (item) => item.id === messageButton.dataset.copyAssignment
    );
    if (route) copyText(routeAssignmentMessage(route));
    return;
  }
});

document.addEventListener('click', (event) => {
  const shortcut = event.target.closest('[data-view-shortcut]');
  if (!shortcut) return;

  switchView(shortcut.dataset.viewShortcut);
});

operatorPreferencesForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  saveOperatorPreferences();
  showToast('Operator preferences saved for this browser.', 'success');
});


document.addEventListener('click',(e)=>{
  const tab=e.target.closest('[data-company-tab]'); if(tab)showCompanyTab(tab.dataset.companyTab);
  const step=e.target.closest('[data-onboard-step]'); if(step)setCommercialOnboardStep(step.dataset.onboardStep);
});
document.getElementById('openOnboardingBtn')?.addEventListener('click',()=>{setCommercialOnboardStep(1);document.getElementById('companyOnboardingDialog')?.showModal();});
document.getElementById('closeOnboardingBtn')?.addEventListener('click',()=>document.getElementById('companyOnboardingDialog')?.close());
document.getElementById('onboardBack')?.addEventListener('click',()=>setCommercialOnboardStep(commercialOnboardStep-1));
document.getElementById('onboardNext')?.addEventListener('click',async()=>{try{await saveCommercialCompany(false,true);setCommercialOnboardStep(commercialOnboardStep+1);}catch(e){showToast(e.message,'error');}});
document.getElementById('onboardFinish')?.addEventListener('click',async()=>{try{await saveCommercialCompany(true,true);document.getElementById('companyOnboardingDialog')?.close();showToast('Company workspace launched.','success');}catch(e){showToast(e.message,'error');}});
document.getElementById('companyProfileForm')?.addEventListener('submit',async(e)=>{e.preventDefault();try{const s=currentCompany?.settings||{};applyCommercialCompany(await api('/api/platform/company',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('commercialCompanyName').value.trim(),legalName:document.getElementById('commercialLegalName').value.trim(),countryCode:document.getElementById('commercialCountry').value,timezone:document.getElementById('commercialTimezone').value.trim(),settings:{...s,supportPhone:document.getElementById('commercialSupportPhone').value.trim(),supportEmail:document.getElementById('commercialSupportEmail').value.trim(),depotAddress:document.getElementById('commercialDepotAddress').value.trim()}})}));showToast('Company profile saved.','success');}catch(x){showToast(x.message,'error');}});
document.getElementById('commercialBrandingForm')?.addEventListener('submit',async(e)=>{e.preventDefault();try{const b=currentCompany?.branding||{};applyCommercialCompany(await api('/api/platform/company',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({brandingName:document.getElementById('commercialBrandName').value.trim(),logoUrl:document.getElementById('commercialLogoUrl').value.trim(),branding:{...b,primaryColor:document.getElementById('commercialPrimaryColor').value,secondaryColor:document.getElementById('commercialSecondaryColor').value,driverAppTitle:document.getElementById('commercialDriverTitle').value.trim(),pdfFooter:document.getElementById('commercialPdfFooter').value.trim(),showPoweredBy:document.getElementById('commercialPoweredBy').checked}})}));showToast('Branding applied.','success');}catch(x){showToast(x.message,'error');}});
document.getElementById('toggleNewUser')?.addEventListener('click',()=>{const f=document.getElementById('newCompanyUserForm');f.hidden=!f.hidden;});
document.getElementById('newCompanyUserForm')?.addEventListener('submit',async(e)=>{e.preventDefault();try{await api('/api/platform/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('newCompanyUserName').value.trim(),email:document.getElementById('newCompanyUserEmail').value.trim(),password:document.getElementById('newCompanyUserPassword').value,role:document.getElementById('newCompanyUserRole').value})});e.target.reset();e.target.hidden=true;await loadCommercialUsers();showToast('User created.','success');}catch(x){showToast(x.message,'error');}});

dispatchStatusFilter?.addEventListener('change',renderMissionDispatch);
refreshMissionControlBtn?.addEventListener('click',async()=>{refreshMissionControlBtn.disabled=true;refreshMissionControlBtn.textContent='Refreshing…';try{await loadPrivateData();showToast('Mission Control refreshed.','success')}catch(e){showToast(e.message||'Could not refresh Mission Control.','error')}finally{refreshMissionControlBtn.disabled=false;refreshMissionControlBtn.textContent='Refresh'}});
document.addEventListener('click',event=>{const b=event.target.closest('[data-map-layer]');if(b){const l=b.dataset.mapLayer;missionMapLayers[l]=!missionMapLayers[l];b.classList.toggle('active',missionMapLayers[l]);renderOperationsMap();return}const f=event.target.closest('[data-map-fit]');if(f&&operationsMap){if(missionMapBounds.length)operationsMap.fitBounds(missionMapBounds,{padding:[35,35],maxZoom:13});else operationsMap.setView([54.4,-3.2],6)}});
runDiagnosticsBtn?.addEventListener('click', runSystemDiagnostics);
downloadDiagnosticsBtn?.addEventListener('click', downloadDiagnosticReport);


document.addEventListener('click', async (event) => {
  const retry = event.target.closest('[data-retry-operational-load]');
  if (!retry) return;

  retry.disabled = true;
  retry.textContent = 'Retrying…';

  try {
    await loadPrivateData();
    showToast('Operational data reloaded.', 'success');
  } catch (error) {
    showToast(error.message || 'Data reload failed.', 'error');
  }
});

async function boot() {
  enableRouteActions(false);
  loadOperatorPreferences();
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
