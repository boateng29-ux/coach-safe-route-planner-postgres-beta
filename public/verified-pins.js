/* Verified Pins v1 - operator route planning helper */
(function () {
  'use strict';

  if (window.__coachSafeVerifiedPinsV1) return;
  window.__coachSafeVerifiedPinsV1 = true;
  if (/\/driver(?:-route|\/route)\//i.test(location.pathname)) return;

  const STATE = {
    points: {},
    active: null,
    modalMap: null,
    modalMarker: null,
    candidateLayer: null,
    routeFetchWarned: false
  };

  const STORE_KEY = 'coachSafeVerifiedPinsV1';

  function normalise(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function loadStore() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  function saveStore() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(STATE.points)); } catch (_) {}
  }

  function pointKey(kind, index) {
    return kind + ':' + (index || 0);
  }

  function pointLabel(kind, index) {
    if (kind === 'start') return 'Start point';
    if (kind === 'destination') return 'Destination';
    return 'Stop ' + (Number(index || 0) + 1);
  }

  function getInputLabel(input) {
    let text = '';
    const id = input.id;
    if (id) {
      const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (label) text += ' ' + label.textContent;
    }
    const parentLabel = input.closest('label');
    if (parentLabel) text += ' ' + parentLabel.textContent;
    let node = input.parentElement;
    for (let i = 0; i < 4 && node; i += 1) {
      text += ' ' + Array.from(node.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
      node = node.parentElement;
    }
    text += ' ' + (input.name || '') + ' ' + (input.id || '') + ' ' + (input.placeholder || '') + ' ' + (input.getAttribute('aria-label') || '');
    return normalise(text);
  }

  function likelyRouteInput(input) {
    if (!input || input.disabled || input.type === 'hidden' || input.type === 'password' || input.type === 'email') return false;
    const text = getInputLabel(input);
    if (/height|width|weight|length|email|phone|password|registration|driver|vehicle|notes|search|filter|pin|lat|lng|lon/.test(text)) return false;
    return /start point|start|origin|destination|stop/.test(text);
  }

  function findPointInputs() {
    const all = Array.from(document.querySelectorAll('input, textarea'))
      .filter(likelyRouteInput);

    let start = null;
    let destination = null;
    const stops = [];

    all.forEach((input) => {
      const text = getInputLabel(input);
      if (!start && /start point|origin|\bstart\b/.test(text) && !/stop/.test(text)) start = input;
      else if (!destination && /destination|end point|\bend\b/.test(text) && !/stop/.test(text)) destination = input;
      else if (/stop/.test(text)) stops.push(input);
    });

    // Fallback to the visual order used in the current planner: start, destination, stops.
    if (!start && all[0]) start = all[0];
    if (!destination && all[1]) destination = all[1];
    if (!stops.length && all.length > 2) {
      all.forEach((input) => {
        if (input !== start && input !== destination) stops.push(input);
      });
    }

    const points = [];
    if (start) points.push({ kind: 'start', index: 0, input: start });
    stops.forEach((input, index) => points.push({ kind: 'stop', index, input }));
    if (destination) points.push({ kind: 'destination', index: 0, input: destination });
    return points;
  }

  function verifiedForInput(point) {
    const key = pointKey(point.kind, point.index);
    const direct = STATE.points[key];
    const value = normalise(point.input && point.input.value);
    if (direct && normalise(direct.text) === value) return direct;
    return Object.values(STATE.points).find((p) => normalise(p.text) === value) || null;
  }

  function formattedPoint(p) {
    const label = String(p.label || p.text || 'Verified stop').replace(/[|\n\r]/g, ' ').trim();
    return Number(p.lat).toFixed(7) + ',' + Number(p.lon).toFixed(7) + ' | ' + label;
  }

  function ensurePanel() {
    let panel = document.getElementById('verifiedPinsPanel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'verifiedPinsPanel';
    panel.className = 'verified-pins-panel';
    panel.innerHTML = '<div class="verified-pins-head"><strong>Verified stop pins</strong><span id="verifiedPinsCount">0 verified</span></div><div id="verifiedPinsList" class="verified-pins-list"></div><p>Use this when landmarks or addresses land in the wrong place. Route calculation will use the verified pin coordinates.</p>';
    document.body.appendChild(panel);
    return panel;
  }

  function markInput(point, verified) {
    const input = point.input;
    if (!input || input.dataset.verifiedPinAttached === '1') return;
    input.dataset.verifiedPinAttached = '1';
    const wrap = document.createElement('span');
    wrap.className = 'verified-pin-inline';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'verified-pin-btn';
    btn.textContent = 'Verify pin';
    btn.addEventListener('click', () => openVerifier(point));
    const badge = document.createElement('span');
    badge.className = 'verified-pin-badge';
    badge.textContent = 'Not verified';
    wrap.appendChild(btn);
    wrap.appendChild(badge);
    input.insertAdjacentElement('afterend', wrap);
  }

  function updateInlineBadges() {
    const points = findPointInputs();
    points.forEach((point) => {
      markInput(point);
      const verified = verifiedForInput(point);
      const wrap = point.input.nextElementSibling && point.input.nextElementSibling.classList && point.input.nextElementSibling.classList.contains('verified-pin-inline') ? point.input.nextElementSibling : null;
      if (!wrap) return;
      const badge = wrap.querySelector('.verified-pin-badge');
      if (!badge) return;
      badge.textContent = verified ? 'Verified' : 'Not verified';
      badge.classList.toggle('ok', !!verified);
      badge.title = verified ? (Number(verified.lat).toFixed(6) + ', ' + Number(verified.lon).toFixed(6)) : 'This point will use address search unless verified.';
    });
  }

  function updatePanel() {
    const panel = ensurePanel();
    const list = panel.querySelector('#verifiedPinsList');
    const points = findPointInputs();
    const rows = points.map((point) => {
      const verified = verifiedForInput(point);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'verified-pins-row' + (verified ? ' ok' : '');
      row.innerHTML = '<span>' + pointLabel(point.kind, point.index) + '</span><strong>' + (verified ? 'Verified' : 'Verify') + '</strong>';
      row.addEventListener('click', () => openVerifier(point));
      return row;
    });
    list.innerHTML = '';
    rows.forEach((row) => list.appendChild(row));
    const count = points.filter(verifiedForInput).length;
    const countEl = panel.querySelector('#verifiedPinsCount');
    if (countEl) countEl.textContent = count + ' verified';
    updateInlineBadges();
  }

  function ensureModal() {
    let modal = document.getElementById('verifiedPinsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'verifiedPinsModal';
    modal.className = 'verified-pins-modal';
    modal.innerHTML = '<div class="verified-pins-dialog"><div class="verified-pins-modal-head"><div><strong id="verifiedModalTitle">Verify pin</strong><p id="verifiedModalText"></p></div><button type="button" id="verifiedCloseBtn">×</button></div><div class="verified-pins-grid"><div><div id="verifiedCandidateList" class="verified-candidates"></div><div class="verified-manual"><label>Manual coordinates <input id="verifiedManualCoords" placeholder="51.470000,-0.450000"></label><button type="button" id="verifiedManualBtn">Set manual pin</button></div></div><div><div id="verifiedPinMap" class="verified-pin-map"></div><p class="verified-help">Drag the pin or tap the exact coach-safe pickup/drop-off point. Then press Use this location.</p></div></div><div class="verified-actions"><button type="button" id="verifiedUseBtn" class="primary">Use this location</button><button type="button" id="verifiedCancelBtn">Cancel</button></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('#verifiedCloseBtn').addEventListener('click', closeModal);
    modal.querySelector('#verifiedCancelBtn').addEventListener('click', closeModal);
    modal.querySelector('#verifiedManualBtn').addEventListener('click', setManualFromInput);
    modal.querySelector('#verifiedUseBtn').addEventListener('click', useCurrentPin);
    return modal;
  }

  function closeModal() {
    const modal = document.getElementById('verifiedPinsModal');
    if (modal) modal.classList.remove('show');
  }

  function loadLeaflet() {
    return new Promise((resolve, reject) => {
      if (window.L) return resolve();
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Leaflet map.'));
      document.head.appendChild(script);
    });
  }

  async function getCandidates(text) {
    const res = await fetch('/api/geocode-candidates?q=' + encodeURIComponent(text), { credentials: 'same-origin' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Could not search this location.');
    return Array.isArray(json.candidates) ? json.candidates : [];
  }

  async function openVerifier(point) {
    STATE.active = point;
    const text = String(point.input.value || '').trim();
    const modal = ensureModal();
    modal.classList.add('show');
    modal.querySelector('#verifiedModalTitle').textContent = 'Verify ' + pointLabel(point.kind, point.index);
    modal.querySelector('#verifiedModalText').textContent = text || 'Choose the exact coach-safe point on the map.';
    modal.querySelector('#verifiedCandidateList').innerHTML = '<div class="verified-loading">Searching location choices…</div>';
    modal.querySelector('#verifiedManualCoords').value = '';
    await loadLeaflet();
    initMap();
    try {
      const candidates = text ? await getCandidates(text) : [];
      renderCandidates(candidates, text);
      if (candidates[0]) setPin(candidates[0].lat, candidates[0].lon, candidates[0].label, true);
    } catch (err) {
      modal.querySelector('#verifiedCandidateList').innerHTML = '<div class="verified-error">' + escapeHtml(err.message) + '</div>';
    }
  }

  function initMap() {
    const el = document.getElementById('verifiedPinMap');
    if (!el || STATE.modalMap) {
      setTimeout(() => STATE.modalMap && STATE.modalMap.invalidateSize(), 80);
      return;
    }
    STATE.modalMap = L.map(el, { zoomControl: true }).setView([51.4700, -0.3760], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap contributors' }).addTo(STATE.modalMap);
    STATE.candidateLayer = L.layerGroup().addTo(STATE.modalMap);
    STATE.modalMap.on('click', (event) => setPin(event.latlng.lat, event.latlng.lng, 'Manual map pin', false));
    setTimeout(() => STATE.modalMap.invalidateSize(), 120);
  }

  function setPin(lat, lon, label, fit) {
    lat = Number(lat); lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const ll = [lat, lon];
    if (!STATE.modalMarker) {
      STATE.modalMarker = L.marker(ll, { draggable: true }).addTo(STATE.modalMap);
    } else {
      STATE.modalMarker.setLatLng(ll);
    }
    STATE.modalMarker.bindPopup(label || 'Verified pin');
    STATE.modalMarker.verifiedLabel = label || 'Verified pin';
    if (fit) STATE.modalMap.setView(ll, 17);
  }

  function renderCandidates(candidates, typedText) {
    const list = document.getElementById('verifiedCandidateList');
    list.innerHTML = '';
    if (STATE.candidateLayer) STATE.candidateLayer.clearLayers();
    if (!candidates.length) {
      list.innerHTML = '<div class="verified-error">No matches found. Tap the map or enter coordinates manually.</div>';
      return;
    }
    const bounds = [];
    candidates.forEach((candidate, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'verified-candidate';
      btn.innerHTML = '<strong>' + escapeHtml(candidate.label || typedText) + '</strong><span>' + escapeHtml(candidate.type || 'result') + ' · ' + Number(candidate.lat).toFixed(6) + ', ' + Number(candidate.lon).toFixed(6) + '</span>';
      btn.addEventListener('click', () => setPin(candidate.lat, candidate.lon, candidate.label || typedText, true));
      list.appendChild(btn);
      if (STATE.candidateLayer) {
        L.circleMarker([candidate.lat, candidate.lon], { radius: 7, weight: 2, fillOpacity: 0.65 }).bindPopup(candidate.label || typedText).addTo(STATE.candidateLayer);
      }
      bounds.push([candidate.lat, candidate.lon]);
    });
    if (bounds.length && STATE.modalMap) STATE.modalMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }

  function setManualFromInput() {
    const value = document.getElementById('verifiedManualCoords').value;
    const m = String(value || '').match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
    if (!m) return alert('Enter coordinates like 51.470000,-0.450000');
    setPin(Number(m[1]), Number(m[2]), 'Manual coordinate pin', true);
  }

  function useCurrentPin() {
    if (!STATE.active || !STATE.modalMarker) return;
    const ll = STATE.modalMarker.getLatLng();
    const text = String(STATE.active.input.value || '').trim();
    const label = text || STATE.modalMarker.verifiedLabel || pointLabel(STATE.active.kind, STATE.active.index);
    const p = { kind: STATE.active.kind, index: STATE.active.index, text, label, lat: ll.lat, lon: ll.lng, verifiedAt: new Date().toISOString() };
    STATE.points[pointKey(STATE.active.kind, STATE.active.index)] = p;
    STATE.active.input.dataset.verifiedLat = String(ll.lat);
    STATE.active.input.dataset.verifiedLon = String(ll.lng);
    STATE.active.input.dataset.verifiedLabel = label;
    saveStore();
    updatePanel();
    closeModal();
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function applyVerifiedToPayload(payload) {
    const points = findPointInputs();
    const byKind = { start: null, destination: null, stops: [] };
    points.forEach((point) => {
      const v = verifiedForInput(point);
      if (!v) return;
      if (point.kind === 'start') byKind.start = v;
      else if (point.kind === 'destination') byKind.destination = v;
      else byKind.stops[point.index] = v;
    });

    const byText = Object.values(STATE.points).reduce((acc, p) => {
      acc[normalise(p.text)] = p;
      return acc;
    }, {});

    let missing = [];
    if (payload.start) {
      const v = byKind.start || byText[normalise(payload.start)];
      if (v) payload.start = formattedPoint(v); else missing.push('start');
    }
    if (payload.destination) {
      const v = byKind.destination || byText[normalise(payload.destination)];
      if (v) payload.destination = formattedPoint(v); else missing.push('destination');
    }
    if (Array.isArray(payload.stops)) {
      payload.stops = payload.stops.map((stop, index) => {
        const v = byKind.stops[index] || byText[normalise(stop)];
        if (v) return formattedPoint(v);
        if (String(stop || '').trim()) missing.push('stop ' + (index + 1));
        return stop;
      });
    }

    payload.verifiedPins = Object.values(STATE.points).map((p) => ({ kind: p.kind, index: p.index, label: p.label, lat: p.lat, lon: p.lon }));
    return missing;
  }

  function installFetchHook() {
    if (window.__verifiedPinsFetchHook) return;
    window.__verifiedPinsFetchHook = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method === 'POST' && /\/api\/route\b/.test(url) && init && typeof init.body === 'string') {
          const payload = JSON.parse(init.body);
          const missing = applyVerifiedToPayload(payload);
          if (missing.length && !STATE.routeFetchWarned) {
            STATE.routeFetchWarned = true;
            setTimeout(() => { STATE.routeFetchWarned = false; }, 3000);
            const proceed = confirm('Some route points are not verified: ' + missing.join(', ') + '.\n\nProceed using address search for those points?');
            if (!proceed) return Promise.reject(new Error('Route calculation cancelled: unverified pins.'));
          }
          init = Object.assign({}, init, { body: JSON.stringify(payload) });
        }
      } catch (err) {
        console.warn('Verified pins could not adjust route payload:', err);
      }
      return originalFetch(input, init);
    };
  }

  function init() {
    STATE.points = loadStore();
    ensurePanel();
    updatePanel();
    installFetchHook();
    setInterval(updatePanel, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
