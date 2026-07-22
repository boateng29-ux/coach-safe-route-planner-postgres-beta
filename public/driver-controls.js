/* Point2Point Clean Driver Controls v6 - one dock only */
(function () {
  'use strict';

  if (window.__P2P_CLEAN_DRIVER_CONTROLS_V6__) return;
  window.__P2P_CLEAN_DRIVER_CONTROLS_V6__ = true;

  const path = window.location.pathname || '';
  if (!/^\/driver(?:-route|\/route)\//i.test(path) || /\/route-pack\/?$/i.test(path)) return;

  const ids = {
    shell: 'driverMapShell',
    map: 'driverMap',
    startGps: 'startGpsBtn',
    stopGps: 'stopGpsBtn',
    centerGps: 'centerGpsBtn',
    mapCenter: 'mapCenterBtn',
    recalc: 'mapRecalcBtn',
    fullscreen: 'mapFullscreenBtn',
    wake: 'mapWakeLockBtn',
    voice: 'mapVoiceBtn',
    reportForm: 'driverReportForm',
    useGpsReport: 'useGpsReportBtn'
  };

  const state = {
    keepScreenOn: false,
    wakeLock: null,
    voiceEnabled: false,
    lastInstruction: '',
    observer: null,
    refreshInterval: null
  };

  function el(id) { return document.getElementById(id); }
  function cleanText(node) { return String((node && (node.textContent || node.getAttribute('aria-label') || node.title)) || '').replace(/\s+/g, ' ').trim(); }
  function lower(node) { return cleanText(node).toLowerCase(); }

  function shell() { return el(ids.shell) || (el(ids.map) && el(ids.map).parentElement) || document.querySelector('.driver-map-shell') || document.querySelector('.leaflet-container')?.parentElement; }

  function mapObj() {
    if (window.map && typeof window.map.invalidateSize === 'function') return window.map;
    if (window.driverMap && typeof window.driverMap.invalidateSize === 'function') return window.driverMap;
    return null;
  }

  function invalidateMap() {
    [80, 200, 500].forEach(function (delay) {
      setTimeout(function () {
        try { const m = mapObj(); if (m) m.invalidateSize(true); } catch (_) {}
      }, delay);
    });
  }

  function showToast(message, type) {
    const s = shell();
    if (!s) return;
    let toast = s.querySelector('.p2p-driver-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'p2p-driver-toast';
      s.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('is-error', type === 'error');
    toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
  }

  function clickHiddenButton(button) {
    if (!button || !document.contains(button) || button.disabled) return false;
    try { button.click(); return true; } catch (_) { return false; }
  }

  function sectionWithHeading(words) {
    const cards = Array.from(document.querySelectorAll('section, article, aside, div.card'));
    return cards.find(function (card) {
      if (card.closest('.p2p-driver-clean-dock')) return false;
      const heading = card.querySelector('h1,h2,h3,h4,strong,b') || card;
      const t = lower(heading).slice(0, 300);
      return words.some(function (word) { return t.includes(word); });
    }) || null;
  }

  function markReportSection() {
    const form = el(ids.reportForm);
    if (!form) return null;
    const card = form.closest('section, article, aside, .card') || form.parentElement;
    if (card && !card.classList.contains('p2p-driver-report-open')) card.classList.add('p2p-driver-report-collapsed');
    return card;
  }

  function hideOldInterface() {
    // Hide old cards completely.
    const summary = sectionWithHeading(['driver summary']);
    if (summary) summary.classList.add('p2p-driver-legacy-hidden');

    const gps = sectionWithHeading(['live gps driver mode']);
    if (gps) gps.classList.add('p2p-driver-legacy-hidden');

    // Hide the original map-control row, but keep its buttons alive for programmatic clicks.
    const row = document.querySelector('.driver-map-controls');
    if (row) row.classList.add('p2p-driver-legacy-hidden');

    [
      ids.startGps, ids.stopGps, ids.centerGps, ids.mapCenter, ids.recalc, ids.fullscreen, ids.wake, ids.voice,
      'completeBtn', 'journeyStartBtn', 'journeyCompleteBtn', 'voiceGuidanceBtn', 'nextInstructionBtn', 'recalcBtn'
    ].forEach(function (id) {
      const button = el(id);
      if (button) {
        button.classList.add('p2p-driver-legacy-hidden');
        button.setAttribute('aria-hidden', 'true');
        button.tabIndex = -1;
      }
    });

    document.querySelectorAll('button, a').forEach(function (button) {
      if (button.closest('.p2p-driver-clean-dock')) return;
      const t = lower(button);
      if (t === 'print' || t.includes('mark completed') || t.includes('completed route') || t.includes('complete route')) {
        button.classList.add('p2p-driver-legacy-hidden');
        button.setAttribute('aria-hidden', 'true');
        button.tabIndex = -1;
      }
    });

    markReportSection();
  }

  function gpsActive() {
    const stop = el(ids.stopGps);
    const tracking = lower(el('gpsTracking'));
    const status = lower(el('gpsStatus'));
    if (stop && stop.disabled === false) return true;
    if (tracking.includes('on') || tracking.includes('active')) return true;
    if (status.includes('active') || status.includes('requesting')) return true;
    return false;
  }

  function fullscreenActive() {
    const s = shell();
    return !!document.fullscreenElement || document.body.classList.contains('p2p-driver-fullscreen') || !!(s && s.classList.contains('large-map-mode'));
  }

  function voiceActive() {
    const button = el(ids.voice);
    const t = lower(button);
    if (t.includes('voice on')) return true;
    if (button && button.classList.contains('active')) return true;
    return state.voiceEnabled;
  }

  function currentInstruction() {
    const selectors = ['#mapNextTurn', '#navCurrentInstruction', '.map-nav-overlay .turn', '[data-next-instruction]'];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const t = cleanText(node);
      if (t && !/start journey to load/i.test(t)) return t;
    }
    return 'Voice guidance is on.';
  }

  function speak(text) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      showToast('Voice is not supported in this browser.', 'error');
      return false;
    }
    try {
      window.speechSynthesis.cancel();
      if (typeof window.speechSynthesis.resume === 'function') window.speechSynthesis.resume();
      const utterance = new SpeechSynthesisUtterance(String(text || 'Continue on the approved route.'));
      utterance.lang = 'en-GB';
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (_) {
      showToast('Voice could not start. Check volume and browser settings.', 'error');
      return false;
    }
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        state.wakeLock = await navigator.wakeLock.request('screen');
        state.wakeLock.addEventListener('release', function () { state.wakeLock = null; refreshDockState(); });
        return true;
      }
    } catch (err) {
      console.warn('Wake lock failed:', err);
    }
    return false;
  }

  async function toggleWakeLock() {
    state.keepScreenOn = !state.keepScreenOn;
    if (state.keepScreenOn) {
      const ok = await requestWakeLock();
      clickHiddenButton(el(ids.wake));
      showToast(ok ? 'Screen will stay on.' : 'Wake lock is limited here. Keep this tab active.');
    } else {
      try { if (state.wakeLock) await state.wakeLock.release(); } catch (_) {}
      state.wakeLock = null;
      clickHiddenButton(el(ids.wake));
      showToast('Keep screen on disabled.');
    }
    refreshDockState();
  }

  function makeButton(key, icon, label, handler, extra) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'p2p-driver-control ' + key + (extra ? ' ' + extra : '');
    button.dataset.key = key;
    button.textContent = icon;
    button.setAttribute('aria-label', label);
    button.title = label;
    let locked = false;
    function fire(event) {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      if (locked) return;
      locked = true;
      setTimeout(function () { locked = false; }, 380);
      handler();
    }
    button.addEventListener('click', fire, { passive: false });
    button.addEventListener('touchend', fire, { passive: false });
    return button;
  }

  function toggleGps() {
    if (gpsActive()) {
      if (clickHiddenButton(el(ids.stopGps))) showToast('Live GPS stopping.');
      else showToast('Stop GPS control not found.', 'error');
    } else {
      if (clickHiddenButton(el(ids.startGps))) showToast('Live GPS starting. Operator tracking will update.');
      else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          function () { showToast('GPS permission accepted.'); },
          function () { showToast('GPS permission was not granted.', 'error'); },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      } else showToast('GPS is not supported in this browser.', 'error');
    }
    setTimeout(refreshDockState, 300);
    setTimeout(refreshDockState, 1100);
  }

  function centrePosition() {
    if (clickHiddenButton(el(ids.mapCenter)) || clickHiddenButton(el(ids.centerGps))) showToast('Centred on driver position.');
    else showToast('Start live GPS first, then centre position.', 'error');
  }

  function recalculate() {
    if (clickHiddenButton(el(ids.recalc))) showToast('Recalculating coach-safe route.');
    else showToast('Recalculate control not found.', 'error');
  }

  function toggleFullscreen() {
    if (clickHiddenButton(el(ids.fullscreen))) {
      setTimeout(refreshDockState, 250);
      invalidateMap();
      return;
    }
    const s = shell();
    if (fullscreenActive()) {
      document.body.classList.remove('p2p-driver-fullscreen');
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      showToast('Exited full screen.');
    } else if (s && s.requestFullscreen) {
      s.requestFullscreen().catch(function () { document.body.classList.add('p2p-driver-fullscreen'); });
      showToast('Full screen enabled.');
    } else {
      document.body.classList.add('p2p-driver-fullscreen');
      showToast('App-style full screen enabled.');
    }
    setTimeout(refreshDockState, 250);
    invalidateMap();
  }

  function toggleVoice() {
    const wasOn = voiceActive();
    clickHiddenButton(el(ids.voice));
    setTimeout(function () {
      state.voiceEnabled = !wasOn;
      if (state.voiceEnabled) {
        const msg = 'Voice guidance is on. ' + currentInstruction();
        speak(msg);
        showToast('Voice guidance on.');
      } else {
        try { window.speechSynthesis.cancel(); } catch (_) {}
        showToast('Voice guidance off.');
      }
      refreshDockState();
    }, 200);
  }

  function openReport() {
    const card = markReportSection();
    if (!card) { showToast('Report form not found.', 'error'); return; }
    if (fullscreenActive()) toggleFullscreen();
    card.classList.remove('p2p-driver-report-collapsed', 'p2p-driver-legacy-hidden');
    card.classList.add('p2p-driver-report-open');
    card.removeAttribute('aria-hidden');
    const useGps = el(ids.useGpsReport);
    if (useGps && gpsActive()) setTimeout(function () { clickHiddenButton(useGps); }, 250);
    setTimeout(function () {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const input = card.querySelector('input, textarea, select');
      if (input && typeof input.focus === 'function') input.focus({ preventScroll: true });
    }, 200);
    showToast('Road issue report opened.');
  }

  function refreshDockState() {
    const dock = document.querySelector('.p2p-driver-clean-dock');
    if (!dock) return;
    const gps = dock.querySelector('[data-key="gps"]');
    const full = dock.querySelector('[data-key="fullscreen"]');
    const wake = dock.querySelector('[data-key="screen"]');
    const voice = dock.querySelector('[data-key="voice"]');

    if (gps) {
      const on = gpsActive();
      gps.textContent = on ? '📡' : '📍';
      gps.setAttribute('aria-label', on ? 'Stop live GPS' : 'Start live GPS');
      gps.title = on ? 'Stop live GPS' : 'Start live GPS';
      gps.classList.toggle('is-active', on);
      gps.classList.toggle('is-primary', !on);
    }
    if (full) {
      const on = fullscreenActive();
      full.textContent = on ? '↙' : '⛶';
      full.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      full.title = on ? 'Exit full screen' : 'Full screen';
      full.classList.toggle('is-active', on);
    }
    if (wake) wake.classList.toggle('is-active', state.keepScreenOn || !!state.wakeLock);
    if (voice) {
      const on = voiceActive();
      state.voiceEnabled = on;
      voice.textContent = on ? '🔊' : '🔇';
      voice.setAttribute('aria-label', on ? 'Voice on' : 'Voice off');
      voice.title = on ? 'Voice on' : 'Voice off';
      voice.classList.toggle('is-active', on);
    }
  }

  function install() {
    const s = shell();
    if (!s) return false;
    s.classList.add('p2p-driver-map-shell');
    if (getComputedStyle(s).position === 'static') s.style.position = 'relative';

    hideOldInterface();

    if (!s.querySelector('.p2p-driver-clean-dock')) {
      const dock = document.createElement('div');
      dock.className = 'p2p-driver-clean-dock';
      dock.setAttribute('role', 'toolbar');
      dock.setAttribute('aria-label', 'Driver controls');
      dock.appendChild(makeButton('gps', '📍', 'Start live GPS', toggleGps, 'is-primary'));
      dock.appendChild(makeButton('centre', '⌖', 'Centre position', centrePosition));
      dock.appendChild(makeButton('recalculate', '↻', 'Recalculate route', recalculate));
      dock.appendChild(makeButton('fullscreen', '⛶', 'Full screen', toggleFullscreen));
      dock.appendChild(makeButton('screen', '☀', 'Keep screen on', toggleWakeLock));
      dock.appendChild(makeButton('voice', '🔇', 'Voice off', toggleVoice));
      dock.appendChild(makeButton('report', '⚠️', 'Report road issue', openReport, 'is-danger'));
      s.appendChild(dock);
    }

    refreshDockState();
    invalidateMap();

    if (!state.observer) {
      state.observer = new MutationObserver(function () {
        hideOldInterface();
        refreshDockState();
      });
      state.observer.observe(document.body, { childList: true, subtree: true });
    }

    if (!state.refreshInterval) {
      state.refreshInterval = setInterval(function () {
        hideOldInterface();
        refreshDockState();
        if (state.voiceEnabled) {
          const instruction = currentInstruction();
          if (instruction && instruction !== state.lastInstruction) {
            state.lastInstruction = instruction;
            speak(instruction);
          }
        }
      }, 1800);
    }

    if (window.location.search.includes('debugControls=1')) showToast('Clean driver controls v6 active.', 3500);
    return true;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.keepScreenOn && !state.wakeLock) requestWakeLock();
  });

  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && !shell()?.classList.contains('large-map-mode')) document.body.classList.remove('p2p-driver-fullscreen');
    if (state.keepScreenOn && !state.wakeLock) requestWakeLock();
    refreshDockState();
    invalidateMap();
  });

  function boot() {
    let tries = 0;
    const timer = setInterval(function () {
      tries += 1;
      if (install() || tries > 40) clearInterval(timer);
    }, 250);
    install();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
