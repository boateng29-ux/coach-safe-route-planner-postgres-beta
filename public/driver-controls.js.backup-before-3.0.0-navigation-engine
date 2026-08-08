/* Clean Driver Controls v7 - single dock, no mutation loops */
(function () {
  'use strict';

  if (window.__P2P_CLEAN_DRIVER_CONTROLS_V7__) return;
  window.__P2P_CLEAN_DRIVER_CONTROLS_V7__ = true;

  if (!/^\/driver(?:\/route|-route)\//i.test(window.location.pathname)) return;

  const state = {
    wakeLock: null,
    keepScreenOn: false,
    lastVoiceText: '',
    toastTimer: null
  };

  function $(id) { return document.getElementById(id); }

  function text(el) {
    return String((el && (el.textContent || el.getAttribute('aria-label') || el.title)) || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isGpsActive() {
    const start = $('startGpsBtn');
    const stop = $('stopGpsBtn');
    const tracking = text($('gpsTracking')).toLowerCase();
    const status = text($('gpsStatus')).toLowerCase();
    return !!((start && start.disabled) || (stop && !stop.disabled) || tracking === 'on' || status.includes('active'));
  }

  function isVoiceActive() {
    const btn = $('mapVoiceBtn');
    const t = text(btn).toLowerCase();
    return !!(btn && (btn.classList.contains('active') || btn.getAttribute('aria-pressed') === 'true' || t.includes('voice on')));
  }

  function isFullscreenActive() {
    const shell = $('driverMapShell');
    return !!(document.fullscreenElement || (shell && shell.classList.contains('large-map-mode')));
  }

  function mapShell() {
    return $('driverMapShell') || $('driverMap')?.parentElement || document.querySelector('.leaflet-container')?.parentElement;
  }

  function showToast(message, ms) {
    const box = $('driverCleanToastV7');
    if (!box) return;
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { box.classList.remove('show'); }, ms || 2400);
  }

  function invalidateMap() {
    setTimeout(function () {
      try {
        if (window.map && typeof window.map.invalidateSize === 'function') window.map.invalidateSize(true);
      } catch (err) {}
    }, 170);
  }

  function safeClick(el) {
    if (!el) return false;
    try {
      el.click();
      return true;
    } catch (err) {
      console.warn('[driver-controls-v7] click failed', err);
      return false;
    }
  }

  function updateButtons() {
    const gps = $('driverCleanGpsBtnV7');
    if (gps) {
      const active = isGpsActive();
      gps.textContent = active ? '📡' : '📍';
      gps.classList.toggle('is-active', active);
      gps.classList.toggle('is-primary', !active);
      gps.setAttribute('aria-label', active ? 'Stop live GPS' : 'Start live GPS');
      gps.title = active ? 'Stop live GPS' : 'Start live GPS';
    }

    const voice = $('driverCleanVoiceBtnV7');
    if (voice) {
      const active = isVoiceActive();
      voice.textContent = active ? '🔊' : '🔇';
      voice.classList.toggle('is-active', active);
      voice.setAttribute('aria-label', active ? 'Voice on' : 'Voice off');
      voice.title = active ? 'Voice on' : 'Voice off';
    }

    const full = $('driverCleanFullscreenBtnV7');
    if (full) {
      const active = isFullscreenActive();
      full.textContent = active ? '↙' : '⛶';
      full.classList.toggle('is-active', active);
      full.setAttribute('aria-label', active ? 'Exit full screen' : 'Full screen');
      full.title = active ? 'Exit full screen' : 'Full screen';
    }

    const wake = $('driverCleanWakeBtnV7');
    if (wake) {
      wake.classList.toggle('is-active', state.keepScreenOn);
      wake.setAttribute('aria-label', state.keepScreenOn ? 'Screen will stay on' : 'Keep screen on');
      wake.title = state.keepScreenOn ? 'Screen will stay on' : 'Keep screen on';
    }
  }

  function currentInstructionText() {
    const turn = text($('mapNextTurn'));
    const dist = text($('mapNextDistance'));
    if (turn && !/start journey/i.test(turn)) return dist && dist !== '—' ? turn + '. ' + dist + '.' : turn;
    return 'Voice guidance is on.';
  }

  function speak(textToSay) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      showToast('Voice is not supported in this browser.');
      return false;
    }
    try {
      window.speechSynthesis.cancel();
      if (typeof window.speechSynthesis.resume === 'function') window.speechSynthesis.resume();
      const utter = new SpeechSynthesisUtterance(String(textToSay || 'Continue on route.'));
      utter.lang = 'en-GB';
      utter.rate = 0.94;
      utter.pitch = 1;
      utter.volume = 1;
      window.speechSynthesis.speak(utter);
      return true;
    } catch (err) {
      showToast('Voice could not start. Check device volume.');
      return false;
    }
  }

  async function requestWakeLock() {
    try {
      if (!('wakeLock' in navigator)) return false;
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', function () { state.wakeLock = null; });
      return true;
    } catch (err) {
      console.warn('[driver-controls-v7] wake lock failed', err);
      return false;
    }
  }

  function makeButton(id, icon, label, className, handler) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.className = 'driver-clean-btn-v7 ' + (className || '');
    btn.textContent = icon;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      handler();
      setTimeout(updateButtons, 150);
      setTimeout(updateButtons, 650);
    });
    return btn;
  }

  function startOrStopGps() {
    if (isGpsActive()) {
      safeClick($('stopGpsBtn'));
      showToast('Stopping live GPS.');
    } else {
      safeClick($('startGpsBtn'));
      showToast('Starting live GPS. Allow location permission.');
    }
  }

  function centrePosition() {
    if (!safeClick($('mapCenterBtn'))) safeClick($('centerGpsBtn'));
    showToast('Centre position.');
  }

  function recalculateRoute() {
    safeClick($('mapRecalcBtn'));
    showToast('Recalculate route.');
  }

  function toggleFullscreen() {
    safeClick($('mapFullscreenBtn'));
    invalidateMap();
  }

  async function toggleWake() {
    state.keepScreenOn = !state.keepScreenOn;
    if (state.keepScreenOn) {
      const ok = await requestWakeLock();
      showToast(ok ? 'Screen will stay on.' : 'Wake lock not supported. Keep this tab open.');
    } else {
      try { if (state.wakeLock) await state.wakeLock.release(); } catch (err) {}
      state.wakeLock = null;
      showToast('Keep screen on disabled.');
    }
    updateButtons();
  }

  function toggleVoice() {
    safeClick($('mapVoiceBtn'));
    setTimeout(function () {
      if (isVoiceActive()) speak(currentInstructionText());
      updateButtons();
    }, 250);
  }

  function reportRoadIssue() {
    if (isFullscreenActive()) safeClick($('mapFullscreenBtn'));
    safeClick($('useGpsReportBtn'));
    const form = $('driverReportForm');
    const input = $('roadNameInput');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (input) setTimeout(function () { input.focus({ preventScroll: true }); }, 550);
    showToast('Road issue report opened. Add details and submit.');
  }

  function install() {
    const shell = mapShell();
    if (!shell || $('driverCleanDockV7')) return;

    document.body.classList.add('driver-clean-v7');
    shell.classList.add('driver-clean-map-shell');

    const toast = document.createElement('div');
    toast.id = 'driverCleanToastV7';
    toast.className = 'driver-clean-toast-v7';
    shell.appendChild(toast);

    const dock = document.createElement('div');
    dock.id = 'driverCleanDockV7';
    dock.className = 'driver-clean-dock-v7';
    dock.setAttribute('role', 'toolbar');
    dock.setAttribute('aria-label', 'Driver map controls');

    dock.appendChild(makeButton('driverCleanGpsBtnV7', '📍', 'Start live GPS', 'is-primary', startOrStopGps));
    dock.appendChild(makeButton('driverCleanCentreBtnV7', '⌖', 'Centre position', '', centrePosition));
    dock.appendChild(makeButton('driverCleanRecalcBtnV7', '↻', 'Recalculate route', '', recalculateRoute));
    dock.appendChild(makeButton('driverCleanFullscreenBtnV7', '⛶', 'Full screen', '', toggleFullscreen));
    dock.appendChild(makeButton('driverCleanWakeBtnV7', '☀', 'Keep screen on', '', toggleWake));
    dock.appendChild(makeButton('driverCleanVoiceBtnV7', '🔇', 'Voice off', '', toggleVoice));
    dock.appendChild(makeButton('driverCleanReportBtnV7', '⚠️', 'Report road issue', 'is-danger', reportRoadIssue));

    shell.appendChild(dock);
    updateButtons();
    showToast('Driver controls ready.', 1400);

    if (window.location.search.includes('debugControls=1')) {
      console.log('[driver-controls-v7] active');
      showToast('Clean driver controls v7 active.', 2800);
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.keepScreenOn && !state.wakeLock) requestWakeLock();
  });

  document.addEventListener('fullscreenchange', function () {
    if (state.keepScreenOn && !state.wakeLock) requestWakeLock();
    invalidateMap();
    updateButtons();
  });

  // Speak changed next instruction only when voice is already active.
  setInterval(function () {
    if (!isVoiceActive()) return;
    const next = currentInstructionText();
    if (next && next !== state.lastVoiceText) {
      state.lastVoiceText = next;
      speak(next);
    }
  }, 2500);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  setTimeout(install, 800);
  setTimeout(updateButtons, 1200);
  setInterval(updateButtons, 2500);
})();
