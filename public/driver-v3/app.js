import { HereMapController } from './here-map-controller.js?v=68';

const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rad = (d) => d * Math.PI / 180;

const state = {
  id: '',
  route: null,
  points: [],
  instructions: [],
  measures: [],
  totalM: 0,
  gps: null,
  snappedGps: null,
  gpsReliable: false,
  lastHeading: null,
  currentInstruction: 0,
  mode: 'overview',
  wakeLock: null,
  viewMode: localStorage.getItem('coachSafeDriverView') || '3d',
  previousNavigationView: '3d',
  lifecycle: 'preview',
  firstReliableNavigationFix: false,
  lastGpsTimestamp: 0,
  provisionalNavigation: false,

  /* COACH_SAFE_STAGE17A_LIVE_INTELLIGENCE */
  journeyStartedAt: 0,
  lastMovingAt: 0,
  lastLiveEventAt: 0,
  lastJourneyStatus: '',
  liveStatus: 'Waiting',
  remainingM: 0,
  remainingSeconds: 0,

  /* COACH_SAFE_STAGE17B_TRAFFIC */
  lastTrafficCheckAt: 0,
  trafficCheckBusy: false,
  trafficOffer: null,
  lastTrafficOfferKey: '',
  lastRawGpsHeartbeatAt: 0,

  /* COACH_SAFE_STAGE191D_DRIVER_REFINEMENT */
  offRouteSince: 0,
  lastAutoRerouteAt: 0,
  autoRerouteBusy: false,
  lastCameraUpdateAt: 0,

  /* COACH_SAFE_STAGE191D1_VERIFIED_START_LOCK */
  verifiedStartLock: true,
  verifiedStartReleased: false,
  verifiedStartReleaseAt: 0,
  verifiedStartLastDistanceM: Infinity
};

const mapCtl = new HereMapController('map');
const voice = new window.CoachVoiceController();
let gps = null;

let driverMenuTimer = null;

/* COACH_SAFE_DAY_MAP_STAGE14 */
window.localStorage.removeItem('coachSafeNightMode');
window.localStorage.removeItem('coachSafeNightMode');
let nightModeEnabled = false;

function applyNightMode(enabled) {
  nightModeEnabled = !!enabled;

  $('app').classList.toggle(
    'night-mode',
    nightModeEnabled
  );

  /*
   * Switch the actual HERE base layer. This avoids the black-screen
   * effect caused by filtering the complete map canvas.
   */
  const layerApplied =
    mapCtl?.setNightMode?.(nightModeEnabled);

  if (nightModeEnabled && layerApplied === false) {
    nightModeEnabled = false;
    $('app').classList.remove('night-mode');
  }

  $('nightBtn')?.classList.toggle(
    'active',
    nightModeEnabled
  );

  const label = $('nightBtn')?.querySelector('span');
  if (label) {
    label.textContent = nightModeEnabled
      ? 'Day mode'
      : 'Night mode';
  }

  window.localStorage.setItem(
    'coachSafeNightMode',
    String(nightModeEnabled)
  );
}



function setDriverMenu(open, { autoHide = true } = {}) {
  const menu = $('driverMenu');
  const toggle = $('driverMenuToggle');
  const app = $('app');

  if (!menu || !toggle || !app) return;

  menu.hidden = !open;
  app.classList.toggle('driver-menu-open', open);

  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute(
    'aria-label',
    open ? 'Hide driver options' : 'Show driver options'
  );

  const glyph = toggle.querySelector('span');
  if (glyph) glyph.textContent = open ? 'â–¼' : 'â–²';

  clearTimeout(driverMenuTimer);

  if (
    open &&
    autoHide &&
    state.lifecycle === 'navigation'
  ) {
    driverMenuTimer = window.setTimeout(() => {
      setDriverMenu(false);
    }, 5000);
  }
}

function syncMinimalDrivingMode() {
  const minimal =
    state.lifecycle === 'navigation' &&
    !!document.fullscreenElement &&
    !!state.wakeLock;

  $('app').classList.toggle('minimal-driving', minimal);

  if (minimal) {
    setDriverMenu(false);
  }
}


function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2400);
}

function routeId() {
  const pathMatch = location.pathname.match(
    /\/(?:driver-v3\/route|drive-v3)\/([^/?#]+)/i
  );
  if (pathMatch) return decodeURIComponent(pathMatch[1]);

  return new URLSearchParams(location.search).get('route') || '';
}

function haversine(a, b) {
  const R = 6371000;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const p1 = rad(a[0]);
  const p2 = rad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(a, b) {
  const p1 = rad(a[0]);
  const p2 = rad(b[0]);
  const dl = rad(b[1] - a[1]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) -
    Math.sin(p1) * Math.cos(p2) * Math.cos(dl);

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function smoothAngle(previous, next, weight = 0.28) {
  if (!Number.isFinite(previous)) return next;
  const delta = ((next - previous + 540) % 360) - 180;
  return (previous + delta * weight + 360) % 360;
}

function buildMeasures(points) {
  const measures = [0];
  for (let i = 1; i < points.length; i += 1) {
    measures[i] = measures[i - 1] + haversine(points[i - 1], points[i]);
  }
  return measures;
}

function project(point, origin) {
  const R = 6371000;
  return {
    x: rad(point[1] - origin[1]) * Math.cos(rad(origin[0])) * R,
    y: rad(point[0] - origin[0]) * R
  };
}

function nearestProgress(point) {
  let best = {
    progress: 0,
    distance: Infinity,
    index: 0,
    snapped: [point[0], point[1]]
  };

  for (let i = 0; i < state.points.length - 1; i += 1) {
    const A = project(state.points[i], point);
    const B = project(state.points[i + 1], point);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = dx * dx + dy * dy;
    const t = len
      ? clamp(((-A.x) * dx + (-A.y) * dy) / len, 0, 1)
      : 0;

    const x = A.x + t * dx;
    const y = A.y + t * dy;
    const distance = Math.hypot(x, y);

    if (distance < best.distance) {
      const start = state.points[i];
      const end = state.points[i + 1];

      best = {
        distance,
        index: i,
        progress:
          (state.measures[i] || 0) +
          t * haversine(start, end),
        snapped: [
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t
        ]
      };
    }
  }

  return best;
}

function routeSegmentBearing(index) {
  if (state.points.length < 2) return 0;

  const startIndex = clamp(
    Number(index || 0),
    0,
    state.points.length - 2
  );

  let endIndex = startIndex + 1;
  let accumulated = 0;

  while (
    endIndex < state.points.length - 1 &&
    accumulated < 90
  ) {
    accumulated += haversine(
      state.points[endIndex - 1],
      state.points[endIndex]
    );
    endIndex += 1;
  }

  endIndex = clamp(
    endIndex,
    startIndex + 1,
    state.points.length - 1
  );

  return bearing(
    state.points[startIndex],
    state.points[endIndex]
  );
}

function navigationBearing(nearest, gpsHeading, speedMps) {
  const routeHeading =
    routeSegmentBearing(nearest.index);

  const movingReliably =
    Number.isFinite(speedMps) &&
    speedMps >= 3.5 &&
    Number.isFinite(gpsHeading) &&
    state.gpsReliable;

  if (!movingReliably) {
    return routeHeading;
  }

  const delta =
    ((gpsHeading - routeHeading + 540) % 360) - 180;

  /*
   * GPS course can briefly flip on phones, especially at low speed or near a
   * junction. Never let an implausible GPS course rotate the map backwards.
   */
  if (Math.abs(delta) > 65) {
    return routeHeading;
  }

  /*
   * Route geometry remains dominant. GPS heading only adds enough movement
   * information to make bends feel natural.
   */
  return (
    routeHeading +
    delta * 0.30 +
    360
  ) % 360;
}

function metresText(metres) {
  if (!Number.isFinite(metres)) return 'â€”';
  if (metres < 950) return `${Math.max(0, Math.round(metres / 10) * 10)}m`;
  return `${(metres / 1609.344).toFixed(1)} miles`;
}

function durationText(seconds) {
  const mins = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(mins / 60);
  const remaining = mins % 60;
  return hours ? `${hours}h ${remaining}m` : `${remaining}m`;
}

function etaText(seconds) {
  return new Date(Date.now() + Math.max(0, seconds) * 1000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function iconFor(instruction) {
  const text = `${instruction?.maneuver || ''} ${instruction?.instruction || ''}`
    .toLowerCase();
  if (text.includes('roundabout')) return 'â†»';
  if (text.includes('left')) return 'â†';
  if (text.includes('right')) return 'â†’';
  if (text.includes('exit')) return 'â†—';
  return 'â†‘';
}

function normaliseVehicle(route) {
  const vehicle = route?.vehicle || {};
  return {
    heightM: Number(vehicle.heightM || vehicle.height || 0),
    widthM: Number(vehicle.widthM || vehicle.width || 0),
    lengthM: Number(vehicle.lengthM || vehicle.length || 0),
    weightKg: Number(vehicle.weightKg || vehicle.weight || 0),
    maxSpeedKmh: Number(vehicle.maxSpeedKmh || vehicle.maxSpeed || 0)
  };
}

function formatMetres(value) {
  return Number.isFinite(value) && value > 0
    ? `${value.toFixed(2).replace(/\.00$/, '')} m`
    : 'Not set';
}

function formatTonnes(valueKg) {
  return Number.isFinite(valueKg) && valueKg > 0
    ? `${(valueKg / 1000).toFixed(1).replace(/\.0$/, '')} t`
    : 'Not set';
}

function updateCoachProfile(route) {
  // Coach restrictions remain active in routing; no permanent card is shown.
}

function applyViewMode(mode, { immediate = false } = {}) {
  const supported = new Set(['3d', '2d', 'north', 'overview']);
  const selected = supported.has(mode) ? mode : '3d';

  if (selected !== 'overview') {
    state.previousNavigationView = selected;
    localStorage.setItem('coachSafeDriverView', selected);
  }

  state.viewMode = selected;
  mapCtl.setViewMode(selected);

  document.querySelectorAll('#viewMenu [data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === selected);
  });

  if (selected === 'overview') {
    setMode('overview');
    mapCtl.overview();
    toast(
      state.lifecycle === 'navigation'
        ? 'Route overview â€” select a navigation view to resume follow'
        : 'Route overview'
    );
    return;
  }

  if (!state.snappedGps && !state.gps) {
    toast(`${selected === '3d' ? '3D' : selected === '2d' ? '2D' : 'North-up'} view selected`);
    return;
  }

  if (gps?.active) {
    state.lifecycle = 'navigation';
    $('app').dataset.lifecycle = 'navigation';
  }

  const position = state.snappedGps || state.gps;
  const nearest = nearestProgress([position.lat, position.lng]);

  setMode('live');
  mapCtl.focus(
    position,
    {
      heading: navigationBearing(
        nearest,
        state.lastHeading,
        state.gps?.speed
      ),
      speedMps: state.gps?.speed,
      immediate,
      viewMode: selected
    }
  );
}

function closeViewMenu() {
  $('viewMenu').hidden = true;
}


/* COACH_SAFE_STAGE191D1_VERIFIED_START_LOCK */

function routeVerifiedStart() {
  const route = state.route || {};

  const candidates = [
    route.verifiedStart,
    route.origin,
    route.start,
    route.route?.verifiedStart,
    route.route?.origin
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const lat = Number(
      candidate.lat ??
      candidate.latitude
    );

    const lng = Number(
      candidate.lng ??
      candidate.lon ??
      candidate.longitude
    );

    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    ) {
      return {
        lat,
        lng,
        accuracy: 0,
        speed: 0,
        heading: routeSegmentBearing(0)
      };
    }
  }

  const first = state.points?.[0];

  if (
    Array.isArray(first) &&
    Number.isFinite(Number(first[0])) &&
    Number.isFinite(Number(first[1]))
  ) {
    return {
      lat: Number(first[0]),
      lng: Number(first[1]),
      accuracy: 0,
      speed: 0,
      heading: routeSegmentBearing(0)
    };
  }

  return null;
}

function shouldReleaseVerifiedStartLock({
  lat,
  lng,
  accuracyM,
  speedMps
}) {
  if (
    !state.verifiedStartLock ||
    state.verifiedStartReleased
  ) {
    return true;
  }

  const start = routeVerifiedStart();

  if (!start) {
    state.verifiedStartReleased = true;
    return true;
  }

  const distanceFromStartM =
    haversine(
      [start.lat, start.lng],
      [lat, lng]
    );

  state.verifiedStartLastDistanceM =
    distanceFromStartM;

  const accurateAtStart =
    accuracyM <= 35 &&
    distanceFromStartM <= 150;

  const strongMovingFix =
    accuracyM <= 20 &&
    speedMps >= 2.5 &&
    distanceFromStartM <= 350;

  if (
    accurateAtStart ||
    strongMovingFix
  ) {
    state.verifiedStartReleased = true;
    state.verifiedStartReleaseAt =
      Date.now();

    postLiveJourneyEvent(
      'verified_start_released',
      'Reliable GPS acquired. Verified start lock released.',
      {
        distanceFromStartM:
          Math.round(distanceFromStartM),
        accuracyM:
          Math.round(accuracyM)
      }
    );

    toast(
      'GPS locked. Live navigation started.'
    );

    return true;
  }

  return false;
}

function applyVerifiedStartLockUi({
  accuracyM,
  distanceFromStartM
}) {
  const start = routeVerifiedStart();
  if (!start) return;

  state.snappedGps = {
    ...start,
    accuracy: Number(accuracyM || 0),
    speed: 0
  };

  state.provisionalNavigation = true;
  state.gpsReliable = false;

  $('gpsStatus').textContent =
    `GPS acquiring ${Math.round(accuracyM)}m`;

  $('gpsStatus').className =
    'status';

  $('gpsSignal').textContent =
    `${Math.round(accuracyM)}m`;

  $('routeStatus').textContent =
    'Holding at verified start';

  $('routeStatus').className =
    'status';

  setLiveJourneyStatus(
    'GPS acquiring',
    Number.isFinite(distanceFromStartM)
      ? `Navigation held at verified start · raw GPS ${Math.round(distanceFromStartM)}m away · accuracy ${Math.round(accuracyM)}m.`
      : `Navigation held at verified start · accuracy ${Math.round(accuracyM)}m.`,
    'warn'
  );

  /*
   * Do not call updateGuidance while locked. It is a normal-navigation
   * function and may replace "Holding at verified start" with "On route".
   */
  mapCtl.focus(
    start,
    {
      heading:
        routeSegmentBearing(0),
      speedMps: 0,
      nextTurnM:
        nextTurnFromProgress(0),
      immediate: true,
      viewMode:
        state.viewMode === 'overview'
          ? state.previousNavigationView
          : state.viewMode
    }
  );

  /*
   * Final write wins while Start Lock is active.
   */
  $('gpsStatus').textContent =
    `GPS acquiring ${Math.round(accuracyM)}m`;
  $('gpsSignal').textContent =
    `${Math.round(accuracyM)}m`;
  $('routeStatus').textContent =
    'Holding at verified start';
  $('routeStatus').className =
    'status';
}

function routeStartPosition() {
  const point = state.points[0];
  if (!point) return null;

  return {
    lat: point[0],
    lng: point[1],
    accuracy: Infinity,
    speed: 0,
    heading: routeSegmentBearing(0)
  };
}

function nextTurnFromProgress(progress) {
  const instruction = state.instructions.find(
    (item) => Number(item.distanceM || 0) >= progress + 5
  );

  return instruction
    ? Math.max(0, Number(instruction.distanceM || 0) - progress)
    : Infinity;
}

function enterPreview() {
  state.lifecycle = 'preview';
  state.firstReliableNavigationFix = false;
  state.provisionalNavigation = false;
  $('app').dataset.lifecycle = 'preview';
  setMode('overview');
  mapCtl.setViewMode('overview');
  mapCtl.overview();

  $('gpsBtn').classList.remove('active');
  const label = $('gpsBtn').querySelector('span');
  if (label) label.textContent = 'Start';
}

function enterNavigation({ immediate = false } = {}) {
  state.lifecycle = 'navigation';
  state.provisionalNavigation = !state.gps;
  $('app').dataset.lifecycle = 'navigation';

  if (state.viewMode === 'overview') {
    state.viewMode = state.previousNavigationView || '3d';
  }

  mapCtl.setViewMode(state.viewMode);
  setMode('live');

  const position =
    !state.verifiedStartReleased
      ? routeVerifiedStart()
      : (
          state.snappedGps ||
          state.gps ||
          routeStartPosition()
        );

  if (!position) return;

  const point = [position.lat, position.lng];
  const nearest = nearestProgress(point);
  const heading = state.gps
    ? navigationBearing(
        nearest,
        state.lastHeading,
        state.gps.speed
      )
    : routeSegmentBearing(nearest.index);

  mapCtl.focus(
    position,
    {
      heading,
      speedMps: state.gps?.speed || 0,
      nextTurnM: nextTurnFromProgress(nearest.progress),
      immediate: true,
      viewMode: state.viewMode
    }
  );

  $('routeStatus').textContent = state.gps
    ? 'Navigation active'
    : 'Waiting for GPS';
  $('routeStatus').className = 'status good';
}

function setMode(mode) {
  state.mode = mode;
  $('app').dataset.mode = mode;

  if (mode === 'live') mapCtl.enterLive();
  else mapCtl.leaveLive();
}

function updateCameraAlert(instruction) {
  const alert = $('cameraAlert');
  const distance = $('cameraDistance');
  if (!alert || !distance) return;

  const metres = Number(
    instruction?.speedCameraDistanceM ??
    instruction?.cameraDistanceM ??
    NaN
  );

  const visible =
    Number.isFinite(metres) &&
    metres >= 0 &&
    metres <= 1500;

  alert.hidden = !visible;
  distance.textContent = visible ? metresText(metres) : 'â€”';
}


/* COACH_SAFE_STAGE17A_LIVE_INTELLIGENCE */

async function postLiveJourneyEvent(eventType, message, metadata = {}) {
  if (!state.id) return;

  try {
    await fetch(
      `/driver/route/${encodeURIComponent(state.id)}/event`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({
          eventType,
          message,
          metadata
        })
      }
    );
  } catch (error) {
    console.warn('Coach Safe live journey event failed.', error);
  }
}

function setLiveJourneyStatus(label, detail = '', className = '') {
  state.liveStatus = label;

  const status = $('journeyLiveStatus');
  const detailNode = $('journeyLiveDetail');

  if (status) {
    status.textContent = label;
    status.className = `journey-live-value ${className}`.trim();
  }

  if (detailNode) {
    detailNode.textContent = detail;
  }
}

function journeyStatusFromFix({
  nearest,
  speedMps,
  remainingM,
  remainingSeconds,
  now
}) {
  const offRouteM = Number(nearest.distance || 0);

  if (remainingM <= 60 && offRouteM <= 90) {
    return {
      key: 'arrived',
      label: 'Arrived',
      className: 'good',
      detail: 'Destination reached.'
    };
  }

  if (offRouteM > 120) {
    return {
      key: 'off_route',
      label: 'Off Route',
      className: 'bad',
      detail: `${Math.round(offRouteM)}m from approved route.`
    };
  }

  const moving = speedMps >= 1.2;

  if (moving) {
    state.lastMovingAt = now;
  }

  const stoppedForMs =
    state.lastMovingAt
      ? now - state.lastMovingAt
      : 0;

  if (
    !moving &&
    stoppedForMs >= 90000 &&
    remainingM > 120
  ) {
    return {
      key: 'stopped',
      label: 'Stopped',
      className: 'warn',
      detail: `Stationary for ${Math.max(1, Math.round(stoppedForMs / 60000))} min.`
    };
  }

  const totalSeconds =
    Number(state.route?.summary?.travelTimeInSeconds || 0);

  if (
    state.journeyStartedAt &&
    totalSeconds > 0 &&
    now - state.journeyStartedAt > 5 * 60 * 1000
  ) {
    const elapsedS =
      (now - state.journeyStartedAt) / 1000;

    const expectedProgress =
      Math.min(1, elapsedS / totalSeconds);

    const actualProgress =
      state.totalM > 0
        ? 1 - remainingM / state.totalM
        : 0;

    if (
      expectedProgress - actualProgress > 0.18 &&
      remainingSeconds > 5 * 60
    ) {
      return {
        key: 'delayed',
        label: 'Delayed',
        className: 'warn',
        detail: 'Journey progress is behind the original route pace.'
      };
    }
  }

  return {
    key: 'on_route',
    label: 'On Route',
    className: 'good',
    detail: `${metresText(remainingM)} remaining · ETA ${etaText(remainingSeconds)}`
  };
}

function updateLiveJourneyIntelligence(nearest, speedMps) {
  if (
    state.lifecycle !== 'navigation' ||
    !state.gpsReliable
  ) {
    return;
  }

  const now = Date.now();

  if (!state.journeyStartedAt) {
    state.journeyStartedAt = now;
    state.lastMovingAt = now;

    postLiveJourneyEvent(
      'journey_started',
      'Driver navigation journey started.',
      {
        lat: state.gps?.lat,
        lng: state.gps?.lng,
        accuracyM: state.gps?.accuracy
      }
    );
  }

  const remainingM =
    Math.max(0, state.totalM - nearest.progress);

  const totalSeconds =
    Number(state.route?.summary?.travelTimeInSeconds || 0);

  const remainingSeconds =
    state.totalM > 0
      ? totalSeconds * (remainingM / state.totalM)
      : 0;

  state.remainingM = remainingM;
  state.remainingSeconds = remainingSeconds;

  const status = journeyStatusFromFix({
    nearest,
    speedMps,
    remainingM,
    remainingSeconds,
    now
  });

  setLiveJourneyStatus(
    status.label,
    status.detail,
    status.className
  );

  if (
    status.key === 'arrived' &&
    state.lastJourneyStatus !== 'arrived'
  ) {
    toast('Destination reached. Confirm Complete route when passengers and coach are ready.');

    if (voice?.enabled) {
      voice.speak?.(
        'Destination reached. Confirm complete route when ready.'
      );
    }

    window.setTimeout(() => {
      openCompleteRouteDialog();
    }, 700);
  }

  const statusChanged =
    status.key !== state.lastJourneyStatus;

  const heartbeatDue =
    now - state.lastLiveEventAt >= 15000;

  if (statusChanged || heartbeatDue) {
    const eventType =
      statusChanged
        ? `journey_status_${status.key}`
        : 'live_position';

    postLiveJourneyEvent(
      eventType,
      status.detail || status.label,
      {
        lat: state.gps?.lat,
        lng: state.gps?.lng,
        accuracyM: state.gps?.accuracy,
        speedMps,
        speedMph: Math.round(speedMps * 2.23694),
        offRouteM: Math.round(nearest.distance || 0),
        progressM: Math.round(nearest.progress || 0),
        remainingM: Math.round(remainingM),
        remainingSeconds: Math.round(remainingSeconds),
        eta: new Date(
          now + remainingSeconds * 1000
        ).toISOString(),
        journeyStatus: status.key
      }
    );

    state.lastLiveEventAt = now;
    state.lastJourneyStatus = status.key;
  }
}


/* COACH_SAFE_STAGE17B_LIVE_TRAFFIC */

function trafficOfferKey(payload = {}) {
  const route = payload.route || {};
  const summary = route.summary || {};

  return [
    Math.round(Number(summary.lengthInMeters || 0) / 100),
    Math.round(Number(summary.travelTimeInSeconds || 0) / 60),
    Math.round(Number(payload.savingSeconds || 0) / 60)
  ].join(':');
}

function hideTrafficOffer() {
  const panel = $('trafficAlternativePanel');
  if (panel) panel.hidden = true;
}

function renderTrafficOffer(payload) {
  if (!payload?.offer || !payload.route) {
    return;
  }

  const panel = $('trafficAlternativePanel');
  if (!panel) return;

  state.trafficOffer = payload;

  const savingMinutes =
    Math.max(
      1,
      Math.round(
        Number(payload.savingSeconds || 0) / 60
      )
    );

  const currentMinutes =
    Math.max(
      1,
      Math.round(
        Number(payload.currentRemainingSeconds || 0) / 60
      )
    );

  const alternativeMinutes =
    Math.max(
      1,
      Math.round(
        Number(payload.alternativeSeconds || 0) / 60
      )
    );

  $('trafficSaving').textContent =
    `${savingMinutes} min`;

  $('trafficCurrentTime').textContent =
    `${currentMinutes} min`;

  $('trafficAlternativeTime').textContent =
    `${alternativeMinutes} min`;

  $('trafficAlternativeDistance').textContent =
    metresText(
      Number(payload.alternativeDistanceM || 0)
    );

  panel.hidden = false;

  toast(
    `Traffic alternative available — saves about ${savingMinutes} min.`
  );
}

async function checkLiveTraffic({
  force = false
} = {}) {
  if (
    !state.gpsReliable ||
    !state.gps ||
    state.lifecycle !== 'navigation'
  ) {
    return;
  }

  if (state.trafficCheckBusy) return;

  const now = Date.now();

  /*
   * Automatic checks every 3 minutes. This is deliberately slower than
   * GPS telemetry to avoid unnecessary routing API traffic.
   */
  if (
    !force &&
    now - state.lastTrafficCheckAt < 180000
  ) {
    return;
  }

  state.trafficCheckBusy = true;
  state.lastTrafficCheckAt = now;

  try {
    const response = await fetch(
      `/driver/route/${encodeURIComponent(state.id)}/traffic-check`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          lat: state.gps.lat,
          lng: state.gps.lng,
          accuracyM: state.gps.accuracy,
          currentRemainingSeconds:
            state.remainingSeconds
        })
      }
    );

    const payload =
      await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload.error ||
        'Live traffic check failed.'
      );
    }

    if (payload.offer) {
      const key = trafficOfferKey(payload);

      if (key !== state.lastTrafficOfferKey) {
        state.lastTrafficOfferKey = key;
        renderTrafficOffer(payload);
      }
    }
  } catch (error) {
    console.warn(
      'Coach Safe live traffic check failed.',
      error
    );
  } finally {
    state.trafficCheckBusy = false;
  }
}

function previewTrafficAlternative() {
  const route = state.trafficOffer?.route;
  if (!route?.points?.length) return;

  mapCtl.previewAlternative?.(
    route.points,
    {
      durationMs: 6000
    }
  );

  postLiveJourneyEvent(
    'traffic_alternative_previewed',
    'Driver previewed the live traffic alternative.',
    {
      savingSeconds:
        state.trafficOffer?.savingSeconds || 0
    }
  );

  toast(
    'Alternative highlighted on the map for 6 seconds.'
  );
}

function keepCurrentTrafficRoute() {
  if (!state.trafficOffer) return;

  postLiveJourneyEvent(
    'traffic_alternative_kept_current',
    'Driver kept the current approved route.',
    {
      savingSeconds:
        state.trafficOffer.savingSeconds || 0
    }
  );

  state.trafficOffer = null;
  hideTrafficOffer();

  toast('Current approved route retained.');
}

function acceptTrafficAlternative() {
  const payload = state.trafficOffer;
  const route = payload?.route;

  if (!route?.points?.length) return;

  voice.reset();
  drawRoute(route, false);

  /*
   * Stay in live follow mode after the route geometry changes.
   */
  if (state.snappedGps || state.gps) {
    const position =
      state.snappedGps || state.gps;

    const nearest =
      nearestProgress([
        position.lat,
        position.lng
      ]);

    mapCtl.focus(
      position,
      {
        heading:
          navigationBearing(
            nearest,
            state.lastHeading,
            state.gps?.speed
          ),
        speedMps:
          state.gps?.speed || 0,
        immediate: true,
        viewMode:
          state.viewMode === 'overview'
            ? state.previousNavigationView
            : state.viewMode
      }
    );
  }

  postLiveJourneyEvent(
    'traffic_alternative_accepted',
    `Driver accepted live traffic alternative saving about ${Math.max(1, Math.round(Number(payload.savingSeconds || 0) / 60))} min.`,
    {
      savingSeconds:
        payload.savingSeconds || 0,
      savingPercent:
        payload.savingPercent || 0,
      alternativeSeconds:
        payload.alternativeSeconds || 0,
      alternativeDistanceM:
        payload.alternativeDistanceM || 0
    }
  );

  state.trafficOffer = null;
  hideTrafficOffer();

  toast('Traffic alternative accepted.');
}


async function maybeAutoReroute(offRouteM) {
  if (
    state.lifecycle !== 'navigation' ||
    !state.gpsReliable ||
    state.autoRerouteBusy
  ) {
    return;
  }

  const now = Date.now();

  if (offRouteM <= 120) {
    state.offRouteSince = 0;
    return;
  }

  if (!state.offRouteSince) {
    state.offRouteSince = now;
    return;
  }

  /*
   * Require a sustained deviation. This avoids rerouting merely because a
   * phone GPS fix briefly jumps onto a parallel road.
   */
  const sustainedForMs =
    now - state.offRouteSince;

  const rerouteCooldownMs =
    now - state.lastAutoRerouteAt;

  if (
    offRouteM < 150 ||
    sustainedForMs < 20000 ||
    rerouteCooldownMs < 60000
  ) {
    return;
  }

  state.autoRerouteBusy = true;
  state.lastAutoRerouteAt = now;

  try {
    toast('Off route confirmed. Recalculating…');

    if (voice.enabled) {
      voice.speak(
        'You appear to be off route. Recalculating.',
        { interrupt: true }
      );
    }

    await reroute({
      automatic: true
    });

    state.offRouteSince = 0;
  } finally {
    state.autoRerouteBusy = false;
  }
}

function updateGuidance(progress, offRoute) {
  if (!state.instructions.length) return;

  let index = state.instructions.findIndex(
    (instruction) => Number(instruction.distanceM || 0) >= progress + 5
  );
  if (index < 0) index = state.instructions.length - 1;

  state.currentInstruction = index;
  const instruction = state.instructions[index];
  const nextM = Math.max(
    0,
    Number(instruction.distanceM || 0) - progress
  );
  const remainingM = Math.max(0, state.totalM - progress);
  const totalSeconds = Number(state.route.summary?.travelTimeInSeconds || 0);
  const remainingSeconds = state.totalM
    ? totalSeconds * (remainingM / state.totalM)
    : 0;

  $('turnIcon').textContent = iconFor(instruction);
  $('instruction').textContent =
    instruction.instruction || 'Continue on route';
  $('turnDistance').textContent =
    state.gpsReliable && nextM <= 15
      ? 'Now'
      : `Next in ${metresText(nextM)}`;

  const laneText = instruction.laneGuidance?.text || '';
  $('laneText').textContent = laneText;
  $('laneText').hidden = !laneText;
  updateCameraAlert(instruction);

  $('eta').textContent = etaText(remainingSeconds);
  $('timeLeft').textContent = durationText(remainingSeconds);
  $('distanceLeft').textContent = metresText(remainingM);

  const road =
    instruction.street ||
    instruction.roadNumbers?.join(' Â· ') ||
    'Route';

  $('roadStatus').textContent = road;
  $('currentRoad').textContent = road;

  const speedLimit = instruction.speedLimit?.maxSpeedLimitMph;
  $('speedLimit').textContent = speedLimit ? `${speedLimit} mph` : 'Limit â€”';
  $('speedLimitLarge').textContent = speedLimit || 30;

  $('routeStatus').textContent = offRoute > 120 ? 'Off route' : 'On route';
  $('routeStatus').className = `status ${offRoute > 120 ? 'bad' : 'good'}`;

  voice.maybeSpeak(instruction, nextM, index);

  return nextM;
}

function drawRoute(route, overview = true) {
  state.route = route;

  state.verifiedStartReleased = false;
  state.verifiedStartReleaseAt = 0;
  state.verifiedStartLastDistanceM = Infinity;
  state.points = (route.points || [])
    .map((point) => [Number(point[0]), Number(point[1])])
    .filter((point) => point.every(Number.isFinite));

  state.instructions = (route.instructions || [])
    .slice()
    .sort((a, b) => Number(a.distanceM || 0) - Number(b.distanceM || 0));

  state.measures = buildMeasures(state.points);
  state.totalM = Number(
    route.summary?.lengthInMeters ||
    state.measures.at(-1) ||
    0
  );

  mapCtl.drawRoute(state.points, overview);
  updateCoachProfile(route);
  setMode(overview ? 'overview' : 'live');
  updateGuidance(0, Infinity);
}


function postRawGpsHeartbeat(nearest, speedMps) {
  if (
    state.lifecycle !== 'navigation' ||
    !state.gps
  ) {
    return;
  }

  const now = Date.now();

  if (
    now - state.lastRawGpsHeartbeatAt < 15000
  ) {
    return;
  }

  state.lastRawGpsHeartbeatAt = now;

  /*
   * This heartbeat deliberately does NOT wait for the strict road-snapping
   * GPS threshold. It tells Mission Control that the driver session is live
   * while the phone is still improving its accuracy.
   */
  postLiveJourneyEvent(
    'live_position',
    state.gpsReliable
      ? 'Live driver position received.'
      : `Driver GPS active — accuracy ${Math.round(state.gps.accuracy || 0)}m.`,
    {
      lat: state.gps.lat,
      lng: state.gps.lng,
      accuracyM:
        Math.round(state.gps.accuracy || 0),
      speedMps:
        Number(speedMps || 0),
      speedMph:
        Math.round(
          Number(speedMps || 0) * 2.23694
        ),
      offRouteM:
        Math.round(
          Number(nearest?.distance || 0)
        ),
      gpsReliable:
        Boolean(state.gpsReliable),
      telemetryState:
        state.gpsReliable
          ? 'navigation'
          : 'gps-settling'
    }
  );

  /*
   * Share the heartbeat timestamp with the stricter live-intelligence loop
   * so reliable GPS does not immediately emit a duplicate heartbeat.
   * Status changes still post immediately.
   */
  state.lastLiveEventAt = now;
}

function onGps(position) {
  const timestamp = Number(position.timestamp || Date.now());

  /*
   * Some mobile browsers can return a cached fix after a newer one.
   * Ignore out-of-order readings so the camera cannot jump backwards.
   */
  if (timestamp < state.lastGpsTimestamp) return;
  state.lastGpsTimestamp = timestamp;

  const {
    latitude: lat,
    longitude: lng,
    accuracy,
    speed,
    heading
  } = position.coords;

  let course = Number(heading);

  if (state.gps) {
    const movementM =
      haversine(
        [state.gps.lat, state.gps.lng],
        [lat, lng]
      );

    /*
     * Do not derive a heading from tiny GPS position movements. A few metres
     * of location noise can otherwise make the coach appear to turn around.
     */
    const courseMovementThreshold =
      Math.max(
        8,
        Math.min(
          20,
          Number(accuracy || 0) * 0.30
        )
      );

    if (
      movementM >= courseMovementThreshold &&
      Number(speed || 0) >= 2.0
    ) {
      course = bearing(
        [state.gps.lat, state.gps.lng],
        [lat, lng]
      );
    }
  }

  const firstFix = !state.gps;
  const accuracyM = Number(accuracy || 999);
  const speedMps = Number.isFinite(Number(speed))
    ? Number(speed)
    : 0;

  const nearest = nearestProgress([lat, lng]);
  const routeHeading = routeSegmentBearing(nearest.index);

  if (!Number.isFinite(course)) {
    course = routeHeading;
  }

  course = smoothAngle(state.lastHeading, course, 0.16);
  if (Number.isFinite(course)) {
    state.lastHeading = course;
  }

  state.gps = {
    lat,
    lng,
    accuracy: accuracyM,
    speed: speedMps,
    heading: course
  };

  const startLockReleased =
    shouldReleaseVerifiedStartLock({
      lat,
      lng,
      accuracyM,
      speedMps
    });

  if (!startLockReleased) {
    const verifiedStart =
      routeVerifiedStart();

    const distanceFromStartM =
      verifiedStart
        ? haversine(
            [verifiedStart.lat, verifiedStart.lng],
            [lat, lng]
          )
        : Infinity;

    /*
     * D2 AUTHORITY RULE:
     * Start Lock owns the navigation UI until it explicitly releases.
     * Do not call downstream route-status/progress helpers here because they
     * can legitimately classify the raw fix as "on route" and overwrite the
     * acquisition state.
     */
    applyVerifiedStartLockUi({
      accuracyM,
      distanceFromStartM
    });

    $('speed').textContent = '0 mph';
    $('speedLarge').textContent = '0';

    updateButtons();

    /*
     * Telemetry is intentionally posted last and asynchronously; it must not
     * be allowed to determine the local navigation state.
     */
    Promise.resolve(
      postRawGpsHeartbeat(
        nearest,
        speedMps
      )
    ).catch(() => {});

    return;
  }

  state.gpsReliable =
    accuracyM <= 35 &&
    nearest.distance <= Math.max(45, accuracyM * 1.6);

  /*
   * With a wide but plausible GPS fix, softly snap the display/camera
   * to the approved route. Guidance and rerouting still remain locked
   * until the stricter reliable-GPS rule passes.
   */
  const softSnapAllowed =
    nearest.distance <= Math.max(160, accuracyM * 2.75);

  const displayPoint = softSnapAllowed
    ? nearest.snapped
    : [lat, lng];

  state.snappedGps = {
    lat: displayPoint[0],
    lng: displayPoint[1],
    accuracy: accuracyM,
    speed: speedMps,
    heading: course
  };

  state.provisionalNavigation = !state.gpsReliable;

  postRawGpsHeartbeat(
    nearest,
    speedMps
  );

  $('gpsStatus').textContent = state.gpsReliable
    ? `GPS ${Math.round(accuracyM)}m`
    : `GPS settling ${Math.round(accuracyM)}m`;

  $('gpsStatus').className =
    `status ${state.gpsReliable ? 'good' : ''}`;

  $('gpsSignal').textContent = `${Math.round(accuracyM)}m`;

  const mph = Math.max(0, Math.round(speedMps * 2.23694));
  $('speed').textContent = `${mph} mph`;
  $('speedLarge').textContent = mph;

  let nextTurnM = nextTurnFromProgress(nearest.progress);

  if (state.gpsReliable) {
    nextTurnM = updateGuidance(
      nearest.progress,
      nearest.distance
    );

    maybeAutoReroute(
      nearest.distance
    );
  } else {
    $('routeStatus').textContent = softSnapAllowed
      ? 'GPS settling - route held'
      : 'GPS accuracy low';
    $('routeStatus').className = 'status';

    setLiveJourneyStatus(
      'GPS active',
      `Waiting for a more accurate fix (${Math.round(accuracyM)}m).`,
      'warn'
    );
  }

  updateLiveJourneyIntelligence(
    nearest,
    speedMps
  );

  checkLiveTraffic();

  if (state.lifecycle !== 'navigation') {
    updateButtons();
    return;
  }

  setMode('live');

  const cameraHeading = smoothAngle(
    mapCtl.lastHeading,
    navigationBearing(nearest, course, speedMps),
    firstFix ? 1 : 0.10
  );

  const forceCamera =
    firstFix ||
    !state.firstReliableNavigationFix;

  if (state.gpsReliable) {
    state.firstReliableNavigationFix = true;
  }

  const nowForCamera = Date.now();
  const cameraDue =
    forceCamera ||
    nowForCamera - state.lastCameraUpdateAt >= 200;

  if (cameraDue) {
    state.lastCameraUpdateAt = nowForCamera;

    mapCtl.focus(
      state.snappedGps,
      {
        heading: cameraHeading,
      speedMps,
      nextTurnM,
      immediate: forceCamera,
        viewMode: state.viewMode === 'overview'
          ? state.previousNavigationView
          : state.viewMode
      }
    );
  }

  updateButtons();
}

function onGpsError(error) {
  toast(error.message || 'GPS permission failed.');
  $('gpsStatus').textContent = 'GPS error';
  $('gpsStatus').className = 'status bad';
  updateButtons();
}

function toggleGps() {
  if (gps.active) {
    gps.stop();
    $('gpsStatus').textContent = 'GPS off';
    $('gpsStatus').className = 'status';
    postLiveJourneyEvent(
      'gps_stopped',
      'Driver stopped live GPS tracking.',
      {
        lat: state.gps?.lat,
        lng: state.gps?.lng,
        remainingM: state.remainingM
      }
    );

    state.journeyStartedAt = 0;
    state.lastMovingAt = 0;
    state.lastJourneyStatus = '';
    state.lastRawGpsHeartbeatAt = 0;
    state.offRouteSince = 0;
    state.autoRerouteBusy = false;
    state.verifiedStartReleased = false;
    state.verifiedStartReleaseAt = 0;
    state.verifiedStartLastDistanceM = Infinity;
    setLiveJourneyStatus(
      'Navigation stopped',
      'Start navigation to resume live journey intelligence.'
    );

    enterPreview();
    toast('Navigation stopped.');
  } else {
    enterNavigation({ immediate: true });

    try {
      gps.start();

      postLiveJourneyEvent(
        'gps_started',
        'Driver started live GPS tracking.',
        {}
      );

      postLiveJourneyEvent(
        'journey_started',
        'Live Driver V3 navigation session started.',
        {
          source: 'driver-v3',
          device:
            /Mobi|Android|iPhone|iPad/i.test(
              navigator.userAgent
            )
              ? 'mobile'
              : 'desktop'
        }
      );

      setLiveJourneyStatus(
        'Acquiring GPS',
        'Coach Safe is waiting for a reliable location fix.'
      );

      $('gpsStatus').textContent = 'Acquiring GPSâ€¦';
      $('gpsStatus').className = 'status';
      toast('Navigation started.');
    } catch (error) {
      enterPreview();
      toast(error.message || 'GPS could not start.');
    }
  }

  syncMinimalDrivingMode();
  updateButtons();
}

async function reroute({ automatic = false } = {}) {
  if (
    state.verifiedStartLock &&
    !state.verifiedStartReleased
  ) {
    toast(
      'Wait for verified start GPS lock before recalculating.'
    );
    return;
  }

  if (!state.gps) {
    toast('Start GPS first.');
    return;
  }
  if (!state.gpsReliable) {
    toast('Wait for a more accurate GPS fix before recalculating.');
    return;
  }

  const button = $('rerouteBtn');
  if (button) button.disabled = true;

  try {
    const response = await fetch(
      `/driver/route/${encodeURIComponent(state.id)}/reroute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: state.gps.lat,
          lng: state.gps.lng,
          accuracyM: state.gps.accuracy
        })
      }
    );

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Reroute failed.');
    }

    voice.reset();
    drawRoute(payload.route, false);

    postLiveJourneyEvent(
      'route_recalculated',
      automatic
        ? 'Coach Safe automatically recalculated after a sustained route deviation.'
        : 'Driver recalculated the route.',
      {
        automatic,
        lat: state.gps?.lat,
        lng: state.gps?.lng,
        accuracyM: state.gps?.accuracy
      }
    );

    toast(
      automatic
        ? 'New route ready.'
        : 'Route recalculated.'
    );
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}


/* COACH_SAFE_STAGE17B4_JOURNEY_COMPLETION */

function openCompleteRouteDialog() {
  const dialog = $('completeRouteDialog');
  if (!dialog) return;

  const remainingM = Number(state.remainingM);
  const warning = $('completeRouteDistanceWarning');
  const confirmButton = $('completeRouteConfirmBtn');

  const farFromDestination =
    Number.isFinite(remainingM) &&
    remainingM > 500;

  if (warning) {
    warning.hidden = !farFromDestination;
    warning.textContent = farFromDestination
      ? `You are still approximately ${metresText(remainingM)} from the destination. Only complete the journey if operations have confirmed it should end here.`
      : '';
  }

  if (confirmButton) {
    confirmButton.textContent =
      farFromDestination
        ? 'Complete anyway'
        : 'Yes, complete route';
  }

  dialog.hidden = false;

  window.setTimeout(() => {
    $('completeRouteConfirmBtn')?.focus();
  }, 30);
}

function closeCompleteRouteDialog() {
  const dialog = $('completeRouteDialog');
  if (dialog) dialog.hidden = true;
}

async function completeCurrentJourney() {
  const confirmButton =
    $('completeRouteConfirmBtn');

  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = 'Completing…';
  }

  try {
    const response = await fetch(
      `/driver/route/${encodeURIComponent(state.id)}/complete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          actor: 'driver',
          lat: state.gps?.lat,
          lng: state.gps?.lng,
          accuracyM: state.gps?.accuracy,
          remainingM: Number.isFinite(state.remainingM)
            ? Math.round(state.remainingM)
            : null
        })
      }
    );

    const payload =
      await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload.error ||
        'Could not complete the route.'
      );
    }

    /*
     * End the local navigation session WITHOUT posting gps_stopped after
     * route_completed. This preserves route_completed as the latest event
     * Mission Control sees.
     */
    if (gps?.active) {
      gps.stop();
    }

    state.journeyStartedAt = 0;
    state.lastMovingAt = 0;
    state.lastJourneyStatus = '';
    state.lastRawGpsHeartbeatAt = 0;
    state.trafficOffer = null;

    hideTrafficOffer();

    setLiveJourneyStatus(
      'Completed',
      'Journey completed and reported to Mission Control.',
      'good'
    );

    $('gpsStatus').textContent = 'Journey complete';
    $('gpsStatus').className = 'status good';
    $('routeStatus').textContent = 'Completed';
    $('routeStatus').className = 'status good';

    const completeButton =
      $('completeRouteBtn');

    if (completeButton) {
      completeButton.disabled = true;
      completeButton.classList.add('completed');
      const label =
        completeButton.querySelector('span');
      if (label) label.textContent = 'Completed';
    }

    enterPreview();
    closeCompleteRouteDialog();

    toast('Journey completed.');

    if (voice?.enabled) {
      voice.speak?.(
        'Journey completed.'
      );
    }
  } catch (error) {
    toast(
      error.message ||
      'Could not complete the route.'
    );
  } finally {
    if (confirmButton) {
      confirmButton.disabled = false;
      confirmButton.textContent =
        'Yes, complete route';
    }
  }
}

async function toggleWake() {
  if (state.wakeLock) {
    await state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  } else if ('wakeLock' in navigator) {
    state.wakeLock = await navigator.wakeLock
      .request('screen')
      .catch(() => null);
  }

  toast(state.wakeLock ? 'Screen will stay on.' : 'Wake lock off.');
  syncMinimalDrivingMode();
  updateButtons();
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch {
    document.body.classList.toggle('fullscreen');
  }

  setTimeout(() => mapCtl.refresh(), 180);
  updateButtons();
}

function updateButtons() {
  const navigationActive =
    state.lifecycle === 'navigation' &&
    !!gps?.active;

  $('gpsBtn').classList.toggle('active', navigationActive);
  $('voiceBtn').classList.toggle('active', voice.enabled);
  $('wakeBtn').classList.toggle('active', !!state.wakeLock);
  $('fullscreenBtn').classList.toggle(
    'active',
    !!document.fullscreenElement
  );

  const gpsLabel = $('gpsBtn').querySelector('span');
  const voiceLabel = $('voiceBtn').querySelector('span');
  const fullLabel = $('fullscreenBtn').querySelector('span');

  if (gpsLabel) {
    gpsLabel.textContent = navigationActive
      ? 'Stop'
      : 'Start';
  }

  $('gpsBtn').setAttribute(
    'aria-label',
    navigationActive
      ? 'Stop navigation'
      : 'Start navigation'
  );

  if (voiceLabel) {
    voiceLabel.textContent = voice.enabled
      ? 'Voice on'
      : 'Voice';
  }

  if (fullLabel) {
    fullLabel.textContent = document.fullscreenElement
      ? 'Exit'
      : 'Fullscreen';
  }
}

async function load() {
  state.id = routeId();
  if (!state.id) throw new Error('Route ID is missing.');

  const [configResponse, routeResponse] = await Promise.all([
    fetch('/driver-v3/config', {
      cache: 'no-store',
      credentials: 'same-origin'
    }),
    fetch(`/driver-v2/data/${encodeURIComponent(state.id)}`, {
      cache: 'no-store',
      credentials: 'same-origin'
    })
  ]);

  const config = await configResponse.json();
  const routePayload = await routeResponse.json();

  if (!configResponse.ok) {
    throw new Error(config.error || 'HERE vector map configuration failed.');
  }
  if (!routeResponse.ok) {
    throw new Error(routePayload.error || 'Could not load route.');
  }

  mapCtl.init(config.apiKey);
  gps = new window.CoachGpsController(onGps, onGpsError);

  drawRoute(routePayload.route || {}, true);
  $('app').dataset.lifecycle = 'preview';
  enterPreview();
  mapCtl.setViewMode(state.viewMode);
  state.previousNavigationView =
    state.viewMode === 'overview' ? '3d' : state.viewMode;

  document.querySelectorAll('#viewMenu [data-view]').forEach((button) => {
    button.classList.toggle(
      'active',
      button.dataset.view === state.viewMode
    );
  });

  $('loading').classList.add('hidden');
  $('routeStatus').textContent = 'Route ready';
  applyNightMode(false);
  setDriverMenu(true);
  syncMinimalDrivingMode();
  updateButtons();

  window.setTimeout(() => {
    const details = $('coachProfileDetails');
    if (!details || details.hidden) return;

    details.hidden = true;
    $('coachProfileToggle')?.setAttribute(
      'aria-expanded',
      'false'
    );
    $('coachProfile')?.classList.add('collapsed');
  }, 7000);
}

$('gpsBtn').addEventListener('click', toggleGps);
$('centreBtn').addEventListener('click', (event) => {
  if (event.detail === 2 && (state.snappedGps || state.gps)) {
    applyViewMode(state.previousNavigationView, { immediate: false });
    return;
  }

  $('viewMenu').hidden = !$('viewMenu').hidden;
});

$('rerouteBtn').addEventListener('click', reroute);
$('fullscreenBtn').addEventListener('click', toggleFullscreen);
$('wakeBtn').addEventListener('click', toggleWake);
$('voiceBtn').addEventListener('click', () => {
  voice.toggle();
  updateButtons();
  toast(voice.enabled ? 'Voice guidance on.' : 'Voice guidance off.');
});
$('reportBtn').addEventListener('click', () => {
  window.open(
    `/driver/route/${encodeURIComponent(state.id)}#driverReportForm`,
    '_blank'
  );
});

$('completeRouteBtn')?.addEventListener(
  'click',
  openCompleteRouteDialog
);

$('completeRouteCancelBtn')?.addEventListener(
  'click',
  closeCompleteRouteDialog
);

$('completeRouteConfirmBtn')?.addEventListener(
  'click',
  completeCurrentJourney
);

$('completeRouteDialog')?.addEventListener(
  'click',
  (event) => {
    if (
      event.target ===
      $('completeRouteDialog')
    ) {
      closeCompleteRouteDialog();
    }
  }
);

$('zoomInBtn').addEventListener('click', () => mapCtl.zoomBy(1));
$('zoomOutBtn').addEventListener('click', () => mapCtl.zoomBy(-1));
$('compassBtn').addEventListener('click', () => {
  const nextMode = state.viewMode === 'north'
    ? state.previousNavigationView
    : 'north';

  applyViewMode(nextMode);
});

$('viewMenu').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;

  const selected = button.dataset.view;

  if (
    state.viewMode === 'overview' &&
    selected === 'overview'
  ) {
    applyViewMode(state.previousNavigationView);
  } else {
    applyViewMode(selected);
  }

  closeViewMenu();
});


document.addEventListener('click', (event) => {
  if (
    !$('viewMenu').hidden &&
    !event.target.closest('#viewMenu') &&
    !event.target.closest('#centreBtn')
  ) {
    closeViewMenu();
  }
});

$('nightBtn').addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();

  applyNightMode(!nightModeEnabled);
  toast(
    nightModeEnabled
      ? 'Night mode on.'
      : 'Day mode on.'
  );

  if (state.lifecycle === 'navigation') {
    clearTimeout(driverMenuTimer);
    driverMenuTimer = window.setTimeout(() => {
      setDriverMenu(false);
    }, 5000);
  }
});

$('driverMenuToggle').addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();

  const willOpen = !$('app').classList.contains('driver-menu-open');
  setDriverMenu(willOpen);
});

$('driverMenu').addEventListener('pointerdown', (event) => {
  event.stopPropagation();
});

$('driverMenu').addEventListener('click', (event) => {
  event.stopPropagation();

  if (state.lifecycle !== 'navigation') return;

  clearTimeout(driverMenuTimer);
  driverMenuTimer = window.setTimeout(() => {
    setDriverMenu(false);
  }, 5000);
});

document.addEventListener('fullscreenchange', () => {
  setDriverMenu(false, { autoHide: false });
  syncMinimalDrivingMode();

  window.setTimeout(() => {
    mapCtl.refresh();
  }, 180);

  updateButtons();
});


document.addEventListener('webkitfullscreenchange', () => {
  setDriverMenu(false, { autoHide: false });
  syncMinimalDrivingMode();

  window.setTimeout(() => {
    mapCtl.refresh();
  }, 180);

  updateButtons();
});


$('trafficPreviewBtn')?.addEventListener(
  'click',
  previewTrafficAlternative
);

$('trafficKeepBtn')?.addEventListener(
  'click',
  keepCurrentTrafficRoute
);

$('trafficAcceptBtn')?.addEventListener(
  'click',
  acceptTrafficAlternative
);

$('trafficCheckBtn')?.addEventListener(
  'click',
  () => {
    state.lastTrafficCheckAt = 0;
    checkLiveTraffic({ force: true });
    toast('Checking live traffic…');
  }
);

window.addEventListener('beforeunload', () => mapCtl.dispose());

load().catch((error) => {
  $('loading').textContent = error.message;
  toast(error.message);
});


/* COACH_SAFE_STAGE17B_DRIVER_TRAFFIC_INSTALLED */

/* COACH_SAFE_STAGE17B1_MOBILE_HEARTBEAT */

/* COACH_SAFE_STAGE17B4_DRIVER_COMPLETE_ROUTE */

/* COACH_SAFE_STAGE18_DRIVER_ARRIVAL_COMPLETION */

/* COACH_SAFE_STAGE191D_DRIVER_APP */

/* COACH_SAFE_STAGE191D1_VERIFIED_START_LOCK_INSTALLED */

/* COACH_SAFE_STAGE191D2_START_LOCK_AUTHORITY */
