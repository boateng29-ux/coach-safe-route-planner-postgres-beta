/* Clean Driver Controls - hard reset module
   Keeps one driver map dock only and delegates to existing driver-page handlers when present. */
(function () {
  'use strict';

  if (window.__cleanDriverControlsHardResetLoaded) return;
  window.__cleanDriverControlsHardResetLoaded = true;

  const DEBUG = new URLSearchParams(location.search).has('debugControls');
  const log = (...args) => { if (DEBUG) console.log('[clean-driver-controls]', ...args); };

  const state = {
    mapShell: null,
    mapEl: null,
    dock: null,
    toast: null,
    gpsActive: false,
    voiceOn: false,
    wakeOn: false,
    wakeLock: null,
    lastVoiceText: '',
    localWatchId: null,
    lastPosition: null,
    hideTimer: null
  };

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function labelOf(el) {
    if (!el) return '';
    return [
      el.textContent,
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.getAttribute && el.getAttribute('data-action'),
      el.id,
      el.className && String(el.className)
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function getClickableElements() {
    return Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'))
      .filter(el => !el.closest('#cleanDriverControlsDock'));
  }

  function findControl(type) {
    const items = getClickableElements();
    const matchers = {
      gpsStart: [/start\s+live\s+gps/, /use\s+my\s+gps\s+location/, /start\s+gps/, /gps\s+location/],
      gpsStop: [/stop\s+gps/, /stop\s+live\s+gps/, /gps\s+active/],
      centre: [/centre\s+position/, /center\s+position/, /centre\s+map/, /center\s+map/],
      recalc: [/recalculate/, /reroute/],
      full: [/full\s*screen/, /enter\s+full\s*screen/],
      exitFull: [/exit\s+full\s*screen/],
      wake: [/keep\s+screen\s+on/, /screen\s+on/, /wake\s*lock/],
      voice: [/voice\s+on/, /voice\s+off/, /mute/, /unmute/],
      report: [/report\s+road/, /road\s+report/, /unsuitable\s+road/, /submit\s+road\s+report/]
    };
    const patterns = matchers[type] || [];
    let best = null;
    let bestScore = -1;
    for (const el of items) {
      const label = labelOf(el);
      if (!label) continue;
      let score = 0;
      for (const re of patterns) if (re.test(label)) score += 10;
      if (type === 'gpsStart' && /stop\s+gps|stop\s+live/.test(label)) score -= 20;
      if (type === 'gpsStop' && /start\s+gps|use\s+my\s+gps/.test(label)) score -= 20;
      if (el.offsetParent !== null) score += 2;
      if (score > bestScore && score > 0) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  function clickControl(type) {
    const el = findControl(type);
    if (!el) return false;
    log('delegating click to', type, labelOf(el));
    try {
      el.click();
      return true;
    } catch (err) {
      console.warn('Clean driver control failed to click original control:', type, err);
      return false;
    }
  }

  function findMap() {
    const maps = Array.from(document.querySelectorAll('.leaflet-container'))
      .filter(el => el.offsetWidth > 150 && el.offsetHeight > 120)
      .sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
    return maps[0] || document.getElementById('driverMap') || document.getElementById('map') || null;
  }

  function ensureMapShell() {
    const mapEl = findMap();
    if (!mapEl) return null;
    state.mapEl = mapEl;
    const shell = mapEl.parentElement || mapEl;
    shell.style.position = shell.style.position || 'relative';
    shell.style.overflow = shell.style.overflow || 'hidden';
    state.mapShell = shell;
    return shell;
  }

  function hideLegacyControls() {
    if (state.hideTimer) return;
    state.hideTimer = setTimeout(() => {
      state.hideTimer = null;

      const hideWords = [
        'use my gps location', 'start live gps', 'stop live gps', 'stop gps', 'start gps',
        'centre position', 'center position', 'recalculate', 'full screen', 'exit full screen',
        'keep screen on', 'voice on', 'voice off', 'mark completed', 'completed route', 'print',
        'submit road report', 'report road issue', 'report unsuitable road'
      ];

      getClickableElements().forEach(el => {
        const label = labelOf(el);
        if (hideWords.some(w => label.includes(w))) {
          el.classList.add('clean-driver-controls-hidden');
          el.setAttribute('data-clean-driver-hidden', 'true');
        }
      });

      // Hide legacy cards/panels that scatter controls around the page.
      Array.from(document.querySelectorAll('section, article, div, aside')).forEach(el => {
        if (el.closest('#cleanDriverControlsDock') || el.closest('#cleanDriverControlsToast')) return;
        const txt = (el.innerText || '').toLowerCase();
        const cls = labelOf(el);
        const isSmall = (el.querySelectorAll('button, a, [role="button"]').length <= 6);
        const legacyCard =
          txt.includes('live gps driver mode') ||
          txt.includes('driver summary') ||
          (txt.includes('status') && txt.includes('accuracy') && txt.includes('tracking')) ||
          cls.includes('driver-summary') ||
          cls.includes('gps-driver-mode');
        if (legacyCard && isSmall) {
          el.classList.add('clean-driver-controls-hidden');
          el.setAttribute('data-clean-driver-hidden-card', 'true');
        }
      });

      // Hide old generated docks/duplicate icon clusters while keeping our own dock.
      Array.from(document.querySelectorAll('div, nav')).forEach(el => {
        if (el.id === 'cleanDriverControlsDock' || el.closest('#cleanDriverControlsDock')) return;
        const buttons = Array.from(el.querySelectorAll('button, [role="button"]'));
        if (buttons.length < 3) return;
        const label = labelOf(el);
        const txt = buttons.map(labelOf).join(' ');
        const iconish = /📍|📡|⌖|↻|⛶|☀|🔊|🔇|⚠|📌|🎙|↙/.test(el.textContent || '');
        const looksLikeDock = label.includes('driver') && (label.includes('control') || label.includes('dock') || label.includes('floating'));
        const hasKnownControls = /centre|center|recalculate|fullscreen|full screen|voice|gps|screen on/.test(txt);
        if (iconish || looksLikeDock || hasKnownControls) {
          el.classList.add('clean-driver-controls-hidden');
          el.setAttribute('data-clean-driver-hidden-dock', 'true');
        }
      });
    }, 60);
  }

  function makeButton(id, icon, label, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'cdc-btn ' + (extraClass || '');
    btn.textContent = icon;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
    }, { capture: true });
    return btn;
  }

  function showToast(message, ms = 2200) {
    ensureToast();
    if (!state.toast) return;
    state.toast.textContent = message;
    state.toast.classList.add('is-visible');
    clearTimeout(state.toast._hideTimer);
    state.toast._hideTimer = setTimeout(() => state.toast.classList.remove('is-visible'), ms);
  }

  function ensureToast() {
    const shell = ensureMapShell();
    if (!shell) return null;
    let toast = document.getElementById('cleanDriverControlsToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cleanDriverControlsToast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      shell.appendChild(toast);
    } else if (toast.parentElement !== shell) {
      shell.appendChild(toast);
    }
    state.toast = toast;
    return toast;
  }

  function updateGpsButton() {
    const btn = document.getElementById('cdcGps');
    if (!btn) return;
    btn.textContent = state.gpsActive ? '📡' : '📍';
    const label = state.gpsActive ? 'Stop live GPS' : 'Start live GPS';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.classList.toggle('is-active', state.gpsActive);
  }

  function startFallbackGps() {
    if (!navigator.geolocation) {
      showToast('GPS is not available in this browser.');
      return false;
    }
    state.localWatchId = navigator.geolocation.watchPosition(
      pos => {
        state.lastPosition = pos;
        state.gpsActive = true;
        updateGpsButton();
      },
      err => showToast('GPS failed: ' + (err && err.message ? err.message : 'permission or signal issue')),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    state.gpsActive = true;
    updateGpsButton();
    showToast('Live GPS started.');
    return true;
  }

  function stopFallbackGps() {
    if (state.localWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.localWatchId);
      state.localWatchId = null;
    }
    state.gpsActive = false;
    updateGpsButton();
    showToast('Live GPS stopped.');
  }

  function handleGps() {
    if (state.gpsActive) {
      const ok = clickControl('gpsStop');
      if (!ok) stopFallbackGps();
      state.gpsActive = false;
      updateGpsButton();
      showToast('Live GPS stopped.');
      return;
    }

    const ok = clickControl('gpsStart');
    if (!ok) startFallbackGps();
    state.gpsActive = true;
    updateGpsButton();
    showToast('Live GPS started.');
  }

  function centreMap() {
    if (clickControl('centre')) {
      showToast('Centred on vehicle.');
      return;
    }
    const pos = state.lastPosition;
    const lat = pos && pos.coords && pos.coords.latitude;
    const lng = pos && pos.coords && pos.coords.longitude;
    const map = window.driverMap || window.map || window.leafletMap;
    if (map && typeof map.setView === 'function' && lat && lng) {
      map.setView([lat, lng], Math.max(map.getZoom ? map.getZoom() : 16, 16));
      showToast('Centred on GPS.');
    } else {
      showToast('Start GPS first, then centre position.');
    }
  }

  function recalculateRoute() {
    if (clickControl('recalc')) {
      showToast('Recalculating route.');
      return;
    }
    if (typeof window.recalculateRoute === 'function') {
      window.recalculateRoute();
      showToast('Recalculating route.');
      return;
    }
    showToast('Recalculate control was not found.');
  }

  function invalidateMapSoon() {
    setTimeout(() => {
      const map = window.driverMap || window.map || window.leafletMap;
      if (map && typeof map.invalidateSize === 'function') map.invalidateSize();
    }, 180);
  }

  function isFullscreen() {
    return !!document.fullscreenElement || (state.mapShell && state.mapShell.classList.contains('clean-driver-map-fullscreen'));
  }

  function updateFullscreenButton() {
    const btn = document.getElementById('cdcFullscreen');
    if (!btn) return;
    const active = isFullscreen();
    btn.textContent = active ? '↙' : '⛶';
    btn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen');
    btn.setAttribute('title', active ? 'Exit fullscreen' : 'Fullscreen');
    btn.classList.toggle('is-active', active);
  }

  async function toggleFullscreen() {
    const shell = ensureMapShell();
    if (!shell) return;
    try {
      if (isFullscreen()) {
        shell.classList.remove('clean-driver-map-fullscreen');
        if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
        showToast('Exited fullscreen.');
      } else {
        shell.classList.add('clean-driver-map-fullscreen');
        if (shell.requestFullscreen) {
          try { await shell.requestFullscreen(); } catch (_) { /* iOS fallback remains via CSS class */ }
        }
        showToast('Fullscreen driving view.');
      }
    } finally {
      updateFullscreenButton();
      invalidateMapSoon();
      if (state.wakeOn) requestWakeLock();
    }
  }

  async function requestWakeLock() {
    if (!state.wakeOn) return;
    try {
      if ('wakeLock' in navigator && navigator.wakeLock && navigator.wakeLock.request) {
        state.wakeLock = await navigator.wakeLock.request('screen');
        state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
        showToast('Keep screen on enabled.');
      } else {
        showToast('Keep screen on is not supported by this browser.');
      }
    } catch (err) {
      showToast('Keep screen on failed. Tap again after GPS starts.');
      console.warn('Wake lock failed', err);
    }
    updateWakeButton();
  }

  function updateWakeButton() {
    const btn = document.getElementById('cdcWake');
    if (!btn) return;
    btn.classList.toggle('is-active', state.wakeOn);
  }

  async function toggleWake() {
    state.wakeOn = !state.wakeOn;
    if (state.wakeOn) {
      await requestWakeLock();
    } else {
      try { if (state.wakeLock) await state.wakeLock.release(); } catch (_) {}
      state.wakeLock = null;
      showToast('Keep screen on disabled.');
    }
    updateWakeButton();
    clickControl('wake');
  }

  function extractNextTurnText() {
    const candidates = Array.from(document.querySelectorAll('[id*="next" i], [class*="next" i], [id*="turn" i], [class*="turn" i], .leaflet-container + *'));
    for (const el of candidates) {
      if (el.closest('#cleanDriverControlsDock') || el.closest('#cleanDriverControlsToast')) continue;
      const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      if (/next turn|next action|turn left|turn right|roundabout|arrived|continue|bear left|bear right/i.test(txt)) {
        return txt
          .replace(/next turn/ig, '')
          .replace(/next action in\s*\d+\s*m/ig, '')
          .replace(/lane guidance.*$/ig, '')
          .trim()
          .slice(0, 220);
      }
    }
    return 'Voice guidance is on.';
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      showToast('Voice is not supported in this browser.');
      return false;
    }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text || 'Voice guidance is on.');
      u.lang = 'en-GB';
      u.rate = 0.95;
      u.pitch = 1;
      u.volume = 1;
      window.speechSynthesis.speak(u);
      return true;
    } catch (err) {
      showToast('Voice could not start. Check volume and browser permissions.');
      return false;
    }
  }

  function updateVoiceButton() {
    const btn = document.getElementById('cdcVoice');
    if (!btn) return;
    btn.textContent = state.voiceOn ? '🔊' : '🔇';
    btn.setAttribute('aria-label', state.voiceOn ? 'Voice on' : 'Voice off');
    btn.setAttribute('title', state.voiceOn ? 'Voice on' : 'Voice off');
    btn.classList.toggle('is-active', state.voiceOn);
  }

  function toggleVoice() {
    state.voiceOn = !state.voiceOn;
    clickControl('voice');
    updateVoiceButton();
    if (state.voiceOn) {
      const text = extractNextTurnText();
      state.lastVoiceText = text;
      speak(text);
      showToast('Voice guidance on.');
    } else {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      showToast('Voice guidance off.');
    }
  }

  function reportRoadIssue() {
    if (clickControl('report')) {
      showToast('Road report opened.');
      return;
    }
    const form = document.querySelector('form[id*="report" i], [id*="roadReport" i], [class*="road-report" i]');
    if (form && form.scrollIntoView) {
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showToast('Road report section opened.');
      return;
    }
    showToast('Road report control was not found.');
  }

  function createDock() {
    const shell = ensureMapShell();
    if (!shell) {
      log('No map shell found yet');
      return false;
    }

    // Remove any duplicate clean dock accidentally left elsewhere.
    Array.from(document.querySelectorAll('#cleanDriverControlsDock')).forEach((el, idx) => {
      if (idx > 0 || el.parentElement !== shell) el.remove();
    });

    let dock = document.getElementById('cleanDriverControlsDock');
    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'cleanDriverControlsDock';
      dock.setAttribute('role', 'toolbar');
      dock.setAttribute('aria-label', 'Driver map controls');

      const gps = makeButton('cdcGps', '📍', 'Start live GPS', 'cdc-primary');
      const centre = makeButton('cdcCentre', '⌖', 'Centre position');
      const recalc = makeButton('cdcRecalc', '↻', 'Recalculate route');
      const full = makeButton('cdcFullscreen', '⛶', 'Fullscreen');
      const wake = makeButton('cdcWake', '☀', 'Keep screen on');
      const voice = makeButton('cdcVoice', '🔇', 'Voice off');
      const report = makeButton('cdcReport', '⚠️', 'Report road issue', 'cdc-report');

      gps.addEventListener('click', handleGps);
      centre.addEventListener('click', centreMap);
      recalc.addEventListener('click', recalculateRoute);
      full.addEventListener('click', toggleFullscreen);
      wake.addEventListener('click', toggleWake);
      voice.addEventListener('click', toggleVoice);
      report.addEventListener('click', reportRoadIssue);

      dock.append(gps, centre, recalc, full, wake, voice, report);
    }

    if (dock.parentElement !== shell) shell.appendChild(dock);
    state.dock = dock;
    ensureToast();
    updateGpsButton();
    updateFullscreenButton();
    updateWakeButton();
    updateVoiceButton();
    hideLegacyControls();
    return true;
  }

  function setupObservers() {
    const observer = new MutationObserver(() => {
      createDock();
      hideLegacyControls();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener('fullscreenchange', () => {
      updateFullscreenButton();
      invalidateMapSoon();
      if (state.wakeOn && !state.wakeLock) requestWakeLock();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.wakeOn && !state.wakeLock) requestWakeLock();
    });

    setInterval(() => {
      if (state.voiceOn) {
        const text = extractNextTurnText();
        if (text && text !== state.lastVoiceText) {
          state.lastVoiceText = text;
          speak(text);
        }
      }
    }, 2500);
  }

  ready(() => {
    // Retry because Leaflet can initialise after the HTML has loaded.
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const ok = createDock();
      if (ok || attempts >= 30) clearInterval(timer);
    }, 300);
    setupObservers();
    if (DEBUG) showToast('Clean driver controls active');
  });
})();
