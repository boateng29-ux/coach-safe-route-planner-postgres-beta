/* Point2Point Clean Driver Controls v4 - one dock, one source of truth */
(function () {
  'use strict';

  if (window.__P2P_CLEAN_DRIVER_CONTROLS_V4__) return;
  window.__P2P_CLEAN_DRIVER_CONTROLS_V4__ = true;

  if (!/^\/driver(?:-route|\/route)\//i.test(window.location.pathname)) return;

  const state = {
    keepScreenOn: false,
    wakeLock: null,
    voiceEnabled: false,
    lastSpokenInstruction: '',
    observer: null,
    refreshTimer: null
  };

  const ids = {
    startGps: 'startGpsBtn',
    stopGps: 'stopGpsBtn',
    centerGps: 'centerGpsBtn',
    mapCenter: 'mapCenterBtn',
    recalc: 'mapRecalcBtn',
    fullscreen: 'mapFullscreenBtn',
    wake: 'mapWakeLockBtn',
    voice: 'mapVoiceBtn',
    useGpsReport: 'useGpsReportBtn',
    reportForm: 'driverReportForm',
    mapShell: 'driverMapShell',
    map: 'driverMap'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function text(el) {
    return String((el && (el.textContent || el.getAttribute('aria-label') || el.title)) || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lower(el) {
    return text(el).toLowerCase();
  }

  function mapShell() {
    return $(ids.mapShell) || ($(ids.map) && $(ids.map).parentElement) || document.querySelector('.driver-map-shell') || document.querySelector('.leaflet-container')?.parentElement;
  }

  function leafletMap() {
    if (window.map && typeof window.map.invalidateSize === 'function') return window.map;
    if (window.driverMap && typeof window.driverMap.invalidateSize === 'function') return window.driverMap;
    return null;
  }

  function invalidateMapSoon() {
    [60, 180, 420].forEach(function (delay) {
      window.setTimeout(function () {
        try {
          const m = leafletMap();
          if (m) m.invalidateSize(true);
        } catch (err) {}
      }, delay);
    });
  }

  function click(el) {
    if (!el || !document.contains(el)) return false;
    try {
      el.click();
      return true;
    } catch (err) {
      return false;
    }
  }

  function showToast(message, type) {
    let toast = document.querySelector('.p2p-driver-toast');
    const shell = mapShell();
    if (!toast && shell) {
      toast = document.createElement('div');
      toast.className = 'p2p-driver-toast';
      shell.appendChild(toast);
    }
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('is-error', type === 'error');
    toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      toast.classList.remove('is-visible');
    }, 2600);
  }

  function findSectionByHeading(phrases) {
    const nodes = Array.from(document.querySelectorAll('section, article, aside, div.card'));
    return nodes.find(function (node) {
      if (node.closest('.p2p-driver-clean-dock')) return false;
      const heading = node.querySelector('h1,h2,h3,h4,strong,b');
      const value = lower(heading || node).slice(0, 260);
      return phrases.some(function (phrase) { return value.includes(phrase); });
    }) || null;
  }

  function markReportSection() {
    const form = $(ids.reportForm);
    if (!form) return null;
    const section = form.closest('section, article, aside, .card') || form.parentElement;
    if (section) section.classList.add('p2p-driver-report-section', 'p2p-driver-report-collapsed');
    return section;
  }

  function hideLegacyUi() {
    const hiddenIds = [
      ids.startGps,
      ids.stopGps,
      ids.centerGps,
      ids.mapCenter,
      ids.recalc,
      ids.fullscreen,
      ids.wake,
      ids.voice,
      'completeBtn',
      'journeyStartBtn',
      'journeyCompleteBtn',
      'voiceGuidanceBtn',
      'nextInstructionBtn',
      'recalcBtn'
    ];

    hiddenIds.forEach(function (id) {
      const el = $(id);
      if (el) {
        el.classList.add('p2p-driver-legacy-hidden');
        el.setAttribute('aria-hidden', 'true');
        el.tabIndex = -1;
      }
    });

    document.querySelectorAll('.driver-map-controls').forEach(function (el) {
      el.classList.add('p2p-driver-legacy-hidden');
      el.setAttribute('aria-hidden', 'true');
    });

    const summary = findSectionByHeading(['driver summary']);
    if (summary) {
      summary.classList.add('p2p-driver-legacy-hidden');
      summary.setAttribute('aria-hidden', 'true');
    }

    const gpsCard = findSectionByHeading(['live gps driver mode']);
    if (gpsCard) {
      gpsCard.classList.add('p2p-driver-legacy-hidden');
      gpsCard.setAttribute('aria-hidden', 'true');
    }

    document.querySelectorAll('button, a').forEach(function (el) {
      if (el.closest('.p2p-driver-clean-dock')) return;
      const t = lower(el);
      if (t === 'print' || t.includes('mark completed') || t.includes('completed route') || t.includes('complete route')) {
        el.classList.add('p2p-driver-legacy-hidden');
        el.setAttribute('aria-hidden', 'true');
        el.tabIndex = -1;
      }
    });

    markReportSection();
  }

  function isGpsActive() {
    const stopBtn = $(ids.stopGps);
    const tracking = lower($('gpsTracking'));
    const status = lower($('gpsStatus'));
    if (stopBtn && stopBtn.disabled === false) return true;
    if (tracking.includes('on') || tracking.includes('active')) return true;
    if (status.includes('active') || status.includes('requesting')) return true;
    return false;
  }

  function isVoiceOn() {
    const original = $(ids.voice);
    const t = lower(original);
    if (t.includes('voice on')) return true;
    if (original && original.classList.contains('active')) return true;
    return state.voiceEnabled;
  }

  function isFullscreenOn() {
    const shell = mapShell();
    return !!document.fullscreenElement || document.body.classList.contains('driver-clean-fullscreen') || !!(shell && shell.classList.contains('large-map-mode'));
  }

  function currentInstructionText() {
    const candidates = [
      '#mapNextTurn',
      '#navCurrentInstruction',
      '#nextTurnText',
      '#currentInstructionText',
      '[data-next-instruction]',
      '.map-nav-overlay .turn',
      '.next-turn-instruction'
    ];

    for (const sel of candidates) {
      const el = document.querySelector(sel);
      const value = text(el);
      if (value && !/start journey to load/i.test(value)) return value;
    }

    return 'Voice guidance is on.';
  }

  function speak(message) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      showToast('Voice is not supported in this browser.', 'error');
      return false;
    }

    try {
      window.speechSynthesis.cancel();
      if (typeof window.speechSynthesis.resume === 'function') window.speechSynthesis.resume();
      const utterance = new SpeechSynthesisUtterance(String(message || 'Continue on the approved route.'));
      utterance.lang = 'en-GB';
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      showToast('Voice could not start. Check volume and browser settings.', 'error');
      return false;
    }
  }

  function speakNextTurn(force) {
    if (!state.voiceEnabled && !force) return;
    const instruction = currentInstructionText();
    if (!instruction) return;
    if (force || instruction !== state.lastSpokenInstruction) {
      state.lastSpokenInstruction = instruction;
      speak(instruction);
    }
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        state.wakeLock = await navigator.wakeLock.request('screen');
        state.wakeLock.addEventListener('release', function () {
          state.wakeLock = null;
        });
        return true;
      }
    } catch (err) {
      console.warn('Wake lock failed:', err);
    }
    return false;
  }

  async function setKeepScreenOn(enabled) {
    state.keepScreenOn = enabled;

    if (enabled) {
      await requestWakeLock();
      click($(ids.wake));
      showToast(state.wakeLock ? 'Screen will stay on.' : 'Keep this tab active; wake lock is limited here.');
    } else {
      try {
        if (state.wakeLock) await state.wakeLock.release();
      } catch (err) {}
      state.wakeLock = null;
      click($(ids.wake));
      showToast('Keep screen on disabled.');
    }

    refreshDockState();
  }

  function openReportForm() {
    const section = markReportSection();
    if (!section) {
      showToast('Report form not found.', 'error');
      return;
    }

    if (isFullscreenOn()) {
      toggleFullscreen();
    }

    section.classList.remove('p2p-driver-report-collapsed');
    section.classList.add('p2p-driver-report-open');
    section.removeAttribute('aria-hidden');

    const useGps = $(ids.useGpsReport);
    if (useGps && isGpsActive()) {
      window.setTimeout(function () { click(useGps); }, 250);
    }

    window.setTimeout(function () {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const input = section.querySelector('input, textarea, select, button');
      if (input && typeof input.focus === 'function') input.focus({ preventScroll: true });
    }, 180);

    showToast('Road issue report opened.');
  }

  function toggleGps() {
    if (isGpsActive()) {
      if (!click($(ids.stopGps))) showToast('Stop GPS control not found.', 'error');
      else showToast('Live GPS stopping.');
    } else {
      if (!click($(ids.startGps))) {
        if (!navigator.geolocation) {
          showToast('GPS is not supported in this browser.', 'error');
        } else {
          navigator.geolocation.getCurrentPosition(
            function () { showToast('GPS permission accepted.'); },
            function () { showToast('GPS permission was not granted.', 'error'); },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
          );
        }
      } else {
        showToast('Live GPS starting. Operator tracking will update.');
      }
    }
    setTimeout(refreshDockState, 300);
    setTimeout(refreshDockState, 1000);
  }

  function centrePosition() {
    if (!click($(ids.centerGps)) && !click($(ids.mapCenter))) {
      showToast('Start live GPS first, then centre position.', 'error');
      return;
    }
    showToast('Centred on driver position.');
  }

  function recalculateRoute() {
    if (!click($(ids.recalc))) {
      showToast('Recalculate control not found.', 'error');
      return;
    }
    showToast('Recalculating coach-safe route.');
  }

  function toggleFullscreen() {
    const shell = mapShell();
    const original = $(ids.fullscreen);

    if (original && click(original)) {
      setTimeout(refreshDockState, 250);
      setTimeout(invalidateMapSoon, 300);
      return;
    }

    if (isFullscreenOn()) {
      document.body.classList.remove('driver-clean-fullscreen');
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
      }
      showToast('Exited full screen.');
    } else {
      if (shell && shell.requestFullscreen) {
        shell.requestFullscreen().catch(function () {
          document.body.classList.add('driver-clean-fullscreen');
        });
      } else {
        document.body.classList.add('driver-clean-fullscreen');
      }
      showToast('Full screen enabled.');
    }

    setTimeout(refreshDockState, 250);
    invalidateMapSoon();
  }

  function toggleVoice() {
    const wasOn = isVoiceOn();
    click($(ids.voice));

    window.setTimeout(function () {
      state.voiceEnabled = !wasOn;
      refreshDockState();
      if (state.voiceEnabled) {
        showToast('Voice guidance on.');
        window.setTimeout(function () {
          if (!window.speechSynthesis || (!window.speechSynthesis.speaking && !window.speechSynthesis.pending)) {
            speak('Voice guidance is on. ' + currentInstructionText());
          }
        }, 450);
      } else {
        try { window.speechSynthesis.cancel(); } catch (err) {}
        showToast('Voice guidance off.');
      }
    }, 180);
  }

  function makeButton(key, icon, label, handler, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'p2p-driver-control ' + key + (extraClass ? ' ' + extraClass : '');
    btn.textContent = icon;
    btn.setAttribute('aria-label', label);
    btn.title = label;

    let locked = false;
    function fire(ev) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      if (locked) return;
      locked = true;
      setTimeout(function () { locked = false; }, 350);
      handler();
    }

    btn.addEventListener('click', fire, { passive: false });
    btn.addEventListener('touchend', fire, { passive: false });
    return btn;
  }

  function refreshDockState() {
    const dock = document.querySelector('.p2p-driver-clean-dock');
    if (!dock) return;

    const gpsBtn = dock.querySelector('[data-key="gps"]');
    const fullBtn = dock.querySelector('[data-key="fullscreen"]');
    const wakeBtn = dock.querySelector('[data-key="screen"]');
    const voiceBtn = dock.querySelector('[data-key="voice"]');

    const gpsActive = isGpsActive();
    if (gpsBtn) {
      gpsBtn.textContent = gpsActive ? '📡' : '📍';
      gpsBtn.setAttribute('aria-label', gpsActive ? 'Stop live GPS' : 'Start live GPS');
      gpsBtn.title = gpsActive ? 'Stop live GPS' : 'Start live GPS';
      gpsBtn.classList.toggle('is-active', gpsActive);
      gpsBtn.classList.toggle('is-primary', !gpsActive);
    }

    const fullActive = isFullscreenOn();
    if (fullBtn) {
      fullBtn.textContent = fullActive ? '↙' : '⛶';
      fullBtn.setAttribute('aria-label', fullActive ? 'Exit full screen' : 'Full screen');
      fullBtn.title = fullActive ? 'Exit full screen' : 'Full screen';
      fullBtn.classList.toggle('is-active', fullActive);
    }

    if (wakeBtn) {
      wakeBtn.classList.toggle('is-active', state.keepScreenOn || !!state.wakeLock);
    }

    state.voiceEnabled = isVoiceOn();
    if (voiceBtn) {
      voiceBtn.textContent = state.voiceEnabled ? '🔊' : '🔇';
      voiceBtn.setAttribute('aria-label', state.voiceEnabled ? 'Voice on' : 'Voice off');
      voiceBtn.title = state.voiceEnabled ? 'Voice on' : 'Voice off';
      voiceBtn.classList.toggle('is-active', state.voiceEnabled);
    }
  }

  function installDock() {
    const shell = mapShell();
    if (!shell) return false;

    shell.classList.add('p2p-driver-map-shell');
    if (getComputedStyle(shell).position === 'static') shell.style.position = 'relative';

    hideLegacyUi();

    let dock = shell.querySelector('.p2p-driver-clean-dock');
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'p2p-driver-clean-dock';
      dock.setAttribute('role', 'toolbar');
      dock.setAttribute('aria-label', 'Driver controls');

      const buttons = [
        ['gps', '📍', 'Start live GPS', toggleGps, 'is-primary'],
        ['centre', '⌖', 'Centre position', centrePosition, ''],
        ['recalculate', '↻', 'Recalculate route', recalculateRoute, ''],
        ['fullscreen', '⛶', 'Full screen', toggleFullscreen, ''],
        ['screen', '☀', 'Keep screen on', function () { setKeepScreenOn(!state.keepScreenOn); }, ''],
        ['voice', '🔇', 'Voice off', toggleVoice, ''],
        ['report', '⚠️', 'Report road issue', openReportForm, 'is-danger']
      ];

      buttons.forEach(function (item) {
        const btn = makeButton(item[0], item[1], item[2], item[3], item[4]);
        btn.dataset.key = item[0];
        dock.appendChild(btn);
      });

      shell.appendChild(dock);
    }

    refreshDockState();
    invalidateMapSoon();

    if (!state.observer) {
      state.observer = new MutationObserver(function () {
        hideLegacyUi();
        refreshDockState();
      });
      state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    if (!state.refreshTimer) {
      state.refreshTimer = setInterval(function () {
        hideLegacyUi();
        refreshDockState();
        speakNextTurn(false);
      }, 1800);
    }

    if (window.location.search.includes('debugControls=1')) {
      showToast('Clean driver controls active.', 3500);
    }

    return true;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.keepScreenOn && !state.wakeLock) {
      requestWakeLock();
    }
  });

  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && !mapShell()?.classList.contains('large-map-mode')) {
      document.body.classList.remove('driver-clean-fullscreen');
    }
    if (state.keepScreenOn && !state.wakeLock) requestWakeLock();
    refreshDockState();
    invalidateMapSoon();
  });

  function boot() {
    let attempts = 0;
    const timer = setInterval(function () {
      attempts += 1;
      if (installDock() || attempts > 40) clearInterval(timer);
    }, 250);
    installDock();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();