/* Clean Driver Controls v1 - one dock only. Safe runtime module. */
(function () {
  'use strict';

  if (window.__cleanDriverControlsMounted) return;
  window.__cleanDriverControlsMounted = true;

  const DRIVER_PATH_RE = /\/driver(?:-route|\/route)\//i;
  if (!DRIVER_PATH_RE.test(window.location.pathname)) return;

  const STATE = {
    gpsActive: false,
    voiceEnabled: false,
    keepScreenOn: false,
    wakeLock: null,
    fullscreen: false,
    lastSpoken: '',
    originalButtons: {}
  };

  const LABELS = [
    { key: 'gps', labels: ['start live gps', 'stop gps', 'use my gps location', 'gps active'] },
    { key: 'centre', labels: ['centre position', 'center position'] },
    { key: 'recalculate', labels: ['recalculate'] },
    { key: 'fullscreen', labels: ['full screen', 'fullscreen', 'exit full screen', 'exit fullscreen', 'large map'] },
    { key: 'screen', labels: ['keep screen on', 'screen on'] },
    { key: 'voice', labels: ['voice on', 'voice off', 'mute voice', 'unmute voice'] },
    { key: 'report', labels: ['submit road report', 'report road issue', 'report unsuitable road'] },
    { key: 'print', labels: ['print'] },
    { key: 'complete', labels: ['mark completed', 'completed route', 'complete route'] }
  ];

  function textOf(el) {
    return ((el && (el.textContent || el.getAttribute('aria-label') || el.title)) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function matchesAny(text, labels) {
    return labels.some(function (label) { return text.includes(label); });
  }

  function findMap() {
    return document.querySelector('#map') || document.querySelector('.leaflet-container');
  }

  function findMapShell() {
    const map = findMap();
    if (!map) return null;
    let node = map;
    for (let i = 0; i < 5 && node && node !== document.body; i += 1) {
      const rect = node.getBoundingClientRect();
      if (rect.width >= 260 && rect.height >= 220) return node;
      node = node.parentElement;
    }
    return map.parentElement || map;
  }

  function callOriginalButton(key) {
    const btn = STATE.originalButtons[key];
    if (!btn || !document.contains(btn)) return false;
    try {
      btn.click();
      return true;
    } catch (err) {
      console.warn('Original button failed:', key, err);
      return false;
    }
  }

  function hideLegacyControls() {
    const candidates = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
    candidates.forEach(function (el) {
      if (el.closest('.driver-clean-dock')) return;
      const t = textOf(el);
      if (!t) return;

      LABELS.forEach(function (group) {
        if (matchesAny(t, group.labels)) {
          if (!STATE.originalButtons[group.key] && group.key !== 'print' && group.key !== 'complete') {
            STATE.originalButtons[group.key] = el;
          }
          el.classList.add('driver-legacy-hidden');
          el.setAttribute('aria-hidden', 'true');
          el.tabIndex = -1;
        }
      });
    });

    // Hide driver cards that should no longer clutter the page.
    Array.from(document.querySelectorAll('section, article, div, aside')).forEach(function (el) {
      if (el.closest('.driver-clean-dock')) return;
      const t = textOf(el);
      if (!t || t.length > 1200) return;
      if (
        t.includes('live gps driver mode') ||
        t.includes('driver summary') ||
        (t.includes('status') && t.includes('accuracy') && t.includes('distance') && t.includes('tracking'))
      ) {
        el.classList.add('driver-legacy-hidden');
        el.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function mapInvalidateSoon() {
    setTimeout(function () {
      try {
        if (window.driverMap && typeof window.driverMap.invalidateSize === 'function') window.driverMap.invalidateSize();
        if (window.map && typeof window.map.invalidateSize === 'function') window.map.invalidateSize();
        const leafletMap = findMap();
        if (leafletMap && leafletMap._leaflet_map && typeof leafletMap._leaflet_map.invalidateSize === 'function') leafletMap._leaflet_map.invalidateSize();
      } catch (err) {}
    }, 150);
  }

  function showToast(message, ms) {
    const toast = document.querySelector('.driver-clean-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      toast.classList.remove('is-visible');
    }, ms || 2500);
  }

  function updateGpsButton(btn) {
    btn.textContent = STATE.gpsActive ? '📡' : '📍';
    btn.setAttribute('aria-label', STATE.gpsActive ? 'Stop live GPS' : 'Start live GPS');
    btn.title = STATE.gpsActive ? 'Stop live GPS' : 'Start live GPS';
    btn.classList.toggle('is-active', STATE.gpsActive);
    btn.classList.toggle('is-primary', !STATE.gpsActive);
  }

  function updateVoiceButton(btn) {
    btn.textContent = STATE.voiceEnabled ? '🔊' : '🔇';
    btn.setAttribute('aria-label', STATE.voiceEnabled ? 'Voice on' : 'Voice off');
    btn.title = STATE.voiceEnabled ? 'Voice on' : 'Voice off';
    btn.classList.toggle('is-active', STATE.voiceEnabled);
  }

  function updateFullscreenButton(btn) {
    const active = !!document.fullscreenElement || document.body.classList.contains('driver-clean-fullscreen');
    STATE.fullscreen = active;
    btn.textContent = active ? '↙' : '⛶';
    btn.setAttribute('aria-label', active ? 'Exit full screen' : 'Full screen');
    btn.title = active ? 'Exit full screen' : 'Full screen';
    btn.classList.toggle('is-active', active);
  }

  function updateWakeButton(btn) {
    btn.textContent = '☀';
    btn.setAttribute('aria-label', STATE.keepScreenOn ? 'Screen will stay on' : 'Keep screen on');
    btn.title = STATE.keepScreenOn ? 'Screen will stay on' : 'Keep screen on';
    btn.classList.toggle('is-active', STATE.keepScreenOn);
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      showToast('Voice not supported in this browser.');
      return false;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      showToast('Voice could not start. Check volume and browser settings.');
      return false;
    }
  }

  function currentInstructionText() {
    const selectors = [
      '#mapNextInstruction',
      '#currentInstructionText',
      '#nextTurnText',
      '.next-turn-title',
      '.next-turn-instruction',
      '[data-next-instruction]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = el && (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && !/next turn/i.test(t)) return t;
    }
    const overlay = document.querySelector('.driver-instruction-overlay, .waze-instruction-overlay, .driver-nav-overlay');
    if (overlay) {
      const text = (overlay.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text.replace(/^next turn\s*/i, '').replace(/next action in.*$/i, '').trim();
    }
    return 'Voice guidance is on.';
  }

  function maybeSpeakCurrentInstruction(force) {
    if (!STATE.voiceEnabled) return;
    const text = currentInstructionText();
    if (!text) return;
    if (force || text !== STATE.lastSpoken) {
      STATE.lastSpoken = text;
      speak(text);
    }
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        STATE.wakeLock = await navigator.wakeLock.request('screen');
        STATE.wakeLock.addEventListener('release', function () {
          STATE.wakeLock = null;
        });
        return true;
      }
    } catch (err) {
      console.warn('Wake lock failed', err);
    }
    return false;
  }

  async function setKeepScreenOn(enabled, btn) {
    STATE.keepScreenOn = enabled;
    if (enabled) {
      const ok = await requestWakeLock();
      showToast(ok ? 'Screen will stay on.' : 'Wake lock not supported here. Keep this tab active.');
    } else {
      try {
        if (STATE.wakeLock) await STATE.wakeLock.release();
      } catch (err) {}
      STATE.wakeLock = null;
      showToast('Keep screen on disabled.');
    }
    updateWakeButton(btn);
  }

  function triggerTouchSafe(fn) {
    let locked = false;
    return function (event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (locked) return;
      locked = true;
      setTimeout(function () { locked = false; }, 320);
      fn(event);
    };
  }

  function makeButton(className, label, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'driver-clean-btn ' + (className || '');
    btn.textContent = label.icon;
    btn.setAttribute('aria-label', label.aria);
    btn.title = label.aria;
    const safeHandler = triggerTouchSafe(handler);
    btn.addEventListener('click', safeHandler, { passive: false });
    btn.addEventListener('touchend', safeHandler, { passive: false });
    return btn;
  }

  function toggleFullscreen(btn) {
    const shell = findMapShell();
    const usingNative = !!document.fullscreenElement;
    if (usingNative) {
      document.exitFullscreen().catch(function () {});
      document.body.classList.remove('driver-clean-fullscreen');
      showToast('Exited full screen.');
    } else if (shell && shell.requestFullscreen) {
      shell.requestFullscreen().then(function () {
        document.body.classList.add('driver-clean-fullscreen');
        showToast('Full screen enabled.');
        mapInvalidateSoon();
      }).catch(function () {
        document.body.classList.toggle('driver-clean-fullscreen');
        showToast(document.body.classList.contains('driver-clean-fullscreen') ? 'App-style full screen enabled.' : 'Exited full screen.');
        mapInvalidateSoon();
      });
    } else {
      document.body.classList.toggle('driver-clean-fullscreen');
      showToast(document.body.classList.contains('driver-clean-fullscreen') ? 'App-style full screen enabled.' : 'Exited full screen.');
      mapInvalidateSoon();
    }
    setTimeout(function () { updateFullscreenButton(btn); }, 200);
  }

  function installDock() {
    const shell = findMapShell();
    if (!shell || shell.querySelector('.driver-clean-dock')) return;
    shell.classList.add('driver-clean-map-shell');

    hideLegacyControls();

    const toast = document.createElement('div');
    toast.className = 'driver-clean-toast';
    shell.appendChild(toast);

    const dock = document.createElement('div');
    dock.className = 'driver-clean-dock';
    dock.setAttribute('role', 'toolbar');
    dock.setAttribute('aria-label', 'Driver map controls');

    const gpsBtn = makeButton('gps is-primary', { icon: '📍', aria: 'Start live GPS' }, function () {
      const called = callOriginalButton('gps');
      STATE.gpsActive = !STATE.gpsActive;
      updateGpsButton(gpsBtn);
      showToast(STATE.gpsActive ? 'Live GPS started. Operator tracking active.' : 'Live GPS stopped.');
      if (!called && STATE.gpsActive && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function () {
          showToast('GPS permission accepted.');
        }, function () {
          showToast('GPS permission was not granted.');
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
      }
    });

    const centreBtn = makeButton('centre', { icon: '⌖', aria: 'Centre position' }, function () {
      if (!callOriginalButton('centre')) {
        try {
          if (window.driverMap && window.currentDriverLatLng) window.driverMap.setView(window.currentDriverLatLng, Math.max(window.driverMap.getZoom(), 16));
        } catch (err) {}
      }
      showToast('Centred on driver position.');
    });

    const recalcBtn = makeButton('recalculate', { icon: '↻', aria: 'Recalculate route' }, function () {
      callOriginalButton('recalculate');
      showToast('Recalculating route.');
    });

    const fullBtn = makeButton('fullscreen', { icon: '⛶', aria: 'Full screen' }, function () {
      toggleFullscreen(fullBtn);
    });

    const wakeBtn = makeButton('screen', { icon: '☀', aria: 'Keep screen on' }, function () {
      setKeepScreenOn(!STATE.keepScreenOn, wakeBtn);
    });

    const voiceBtn = makeButton('voice', { icon: '🔇', aria: 'Voice off' }, function () {
      const called = callOriginalButton('voice');
      STATE.voiceEnabled = !STATE.voiceEnabled;
      updateVoiceButton(voiceBtn);
      if (STATE.voiceEnabled) {
        maybeSpeakCurrentInstruction(true);
        showToast('Voice guidance on.');
      } else {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        showToast('Voice guidance off.');
      }
      if (!called && STATE.voiceEnabled) speak('Voice guidance is on.');
    });

    const reportBtn = makeButton('report is-danger', { icon: '⚠️', aria: 'Report road issue' }, function () {
      callOriginalButton('report');
      showToast('Road issue report opened.');
    });

    [gpsBtn, centreBtn, recalcBtn, fullBtn, wakeBtn, voiceBtn, reportBtn].forEach(function (btn) {
      dock.appendChild(btn);
    });

    shell.appendChild(dock);
    updateGpsButton(gpsBtn);
    updateVoiceButton(voiceBtn);
    updateFullscreenButton(fullBtn);
    updateWakeButton(wakeBtn);

    // Re-hide legacy buttons if the app re-renders them.
    const observer = new MutationObserver(function () {
      hideLegacyControls();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Speak changed next-turn text while voice is enabled.
    setInterval(function () { maybeSpeakCurrentInstruction(false); }, 1800);

    showToast('Clean driver controls ready.', 1800);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && STATE.keepScreenOn && !STATE.wakeLock) {
      requestWakeLock();
    }
  });

  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement) {
      document.body.classList.remove('driver-clean-fullscreen');
    }
    if (STATE.keepScreenOn && !STATE.wakeLock) requestWakeLock();
    mapInvalidateSoon();
    const btn = document.querySelector('.driver-clean-btn.fullscreen');
    if (btn) updateFullscreenButton(btn);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installDock);
  } else {
    installDock();
  }

  // Some Leaflet pages render after DOMContentLoaded.
  setTimeout(installDock, 800);
  setTimeout(installDock, 2000);
})();
