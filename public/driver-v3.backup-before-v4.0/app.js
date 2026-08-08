import { HereMapController } from './here-map-controller.js?v=40';

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
  provisionalNavigation: false
};

const mapCtl = new HereMapController('map');
const voice = new window.CoachVoiceController();
let gps = null;

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

  const endIndex = clamp(
    startIndex + Math.min(8, state.points.length - startIndex - 1),
    startIndex + 1,
    state.points.length - 1
  );

  return bearing(state.points[startIndex], state.points[endIndex]);
}

function navigationBearing(nearest, gpsHeading, speedMps) {
  const routeHeading = routeSegmentBearing(nearest.index);
  const moving =
    Number.isFinite(speedMps) &&
    speedMps >= 2.5 &&
    Number.isFinite(gpsHeading);

  if (!moving) return routeHeading;

  const delta = ((gpsHeading - routeHeading + 540) % 360) - 180;
  return (routeHeading + delta * 0.7 + 360) % 360;
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
  const vehicle = normaliseVehicle(route);
  const options = route?.options || {};

  $('coachHeight').textContent = formatMetres(vehicle.heightM);
  $('coachWidth').textContent = formatMetres(vehicle.widthM);
  $('coachLength').textContent = formatMetres(vehicle.lengthM);
  $('coachWeight').textContent = formatTonnes(vehicle.weightKg);

  const complete =
    vehicle.heightM > 0 &&
    vehicle.widthM > 0 &&
    vehicle.lengthM > 0 &&
    vehicle.weightKg > 0;

  $('coachProfileTitle').textContent = complete
    ? 'Coach profile active'
    : 'Coach dimensions incomplete';

  $('coachProfileSummary').textContent = complete
    ? `${formatMetres(vehicle.heightM)} â€¢ ${formatMetres(vehicle.widthM)} â€¢ ${formatMetres(vehicle.lengthM)} â€¢ ${formatTonnes(vehicle.weightKg)}`
    : 'Check height, width, length and weight before driving';

  $('coachProfile').classList.toggle('warning', !complete);

  const avoidances = [];
  if (options.avoidTolls) avoidances.push('tolls');
  if (options.avoidFerries) avoidances.push('ferries');
  if (options.avoidUnpaved) avoidances.push('unpaved roads');
  if (options.avoidTunnels) avoidances.push('tunnels');
  if (options.avoidLowEmissionZones) avoidances.push('low-emission zones');

  $('coachAvoidances').textContent =
    `Commercial-vehicle restrictions active${
      avoidances.length ? `. Avoiding ${avoidances.join(', ')}.` : '.'
    }`;
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
    state.snappedGps ||
    state.gps ||
    routeStartPosition();

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

  $('laneText').textContent =
    instruction.laneGuidance?.text ||
    'Follow road signs. Lane guidance not returned.';

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

  if (
    state.gps &&
    haversine([state.gps.lat, state.gps.lng], [lat, lng]) > 5
  ) {
    course = bearing(
      [state.gps.lat, state.gps.lng],
      [lat, lng]
    );
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

  course = smoothAngle(state.lastHeading, course, 0.22);
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

  state.gpsReliable =
    accuracyM <= 35 &&
    nearest.distance <= Math.max(45, accuracyM * 1.6);

  /*
   * With a wide but plausible GPS fix, softly snap the display/camera
   * to the approved route. Guidance and rerouting still remain locked
   * until the stricter reliable-GPS rule passes.
   */
  const softSnapAllowed =
    nearest.distance <= Math.max(110, accuracyM * 2);

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
  } else {
    $('routeStatus').textContent = softSnapAllowed
      ? 'GPS settling â€” route held'
      : 'GPS settling';
    $('routeStatus').className = 'status';
  }

  if (state.lifecycle !== 'navigation') {
    updateButtons();
    return;
  }

  setMode('live');

  const cameraHeading = smoothAngle(
    mapCtl.lastHeading,
    navigationBearing(nearest, course, speedMps),
    firstFix ? 1 : 0.14
  );

  const forceCamera =
    firstFix ||
    !state.firstReliableNavigationFix;

  if (state.gpsReliable) {
    state.firstReliableNavigationFix = true;
  }

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
    enterPreview();
    toast('Navigation stopped.');
  } else {
    enterNavigation({ immediate: true });

    try {
      gps.start();
      $('gpsStatus').textContent = 'Acquiring GPSâ€¦';
      $('gpsStatus').className = 'status';
      toast('Navigation started.');
    } catch (error) {
      enterPreview();
      toast(error.message || 'GPS could not start.');
    }
  }

  updateButtons();
}

async function reroute() {
  if (!state.gps) {
    toast('Start GPS first.');
    return;
  }
  if (!state.gpsReliable) {
    toast('Wait for a more accurate GPS fix before recalculating.');
    return;
  }

  const button = $('rerouteBtn');
  button.disabled = true;

  try {
    const response = await fetch(
      `/driver-v3/route/${encodeURIComponent(state.id)}/reroute`,
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
    toast('Route recalculated.');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
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
  updateButtons();
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
    `/driver-v3/route/${encodeURIComponent(state.id)}#driverReportForm`,
    '_blank'
  );
});

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

$('coachProfileToggle').addEventListener('click', () => {
  const details = $('coachProfileDetails');
  details.hidden = !details.hidden;
  $('coachProfileToggle').setAttribute(
    'aria-expanded',
    String(!details.hidden)
  );
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

document.addEventListener('fullscreenchange', () => {
  setTimeout(() => mapCtl.refresh(), 120);
  updateButtons();
});

window.addEventListener('beforeunload', () => mapCtl.dispose());

load().catch((error) => {
  $('loading').textContent = error.message;
  toast(error.message);
});

