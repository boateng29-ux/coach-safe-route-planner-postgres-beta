/* COACH_SAFE_VERIFIED_PINS_STAGE141 */
(() => {
  const form = document.getElementById('routeForm');
  const map = window.map || null;
  if (!form || !window.L) return;

  const STATE = new WeakMap();
  let activeMarker = null;
  let activeInput = null;
  let chooser = null;

  const coordPattern =
    /^\s*(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?:\s*\|\s*(.+))?\s*$/;

  const esc = (value = '') =>
    String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#039;'
    }[ch]));

  function inputIsVerified(input) {
    const match = String(input?.value || '').match(coordPattern);
    if (!match) return false;
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    return Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 &&
      lon >= -180 && lon <= 180;
  }

  function parsedVerified(input) {
    const match = String(input?.value || '').match(coordPattern);
    if (!match) return null;
    return {
      lat: Number(match[1]),
      lon: Number(match[2]),
      label: String(match[3] || input.dataset.verifiedLabel || '').trim()
    };
  }

  function allPinInputs() {
    return [
      form.elements.start,
      form.elements.destination,
      ...document.querySelectorAll('[data-waypoint-input]')
    ].filter(Boolean);
  }

  function ensurePanel() {
    let panel = document.getElementById('verifiedPinsPanel');
    if (panel) return panel;

    panel = document.createElement('aside');
    panel.id = 'verifiedPinsPanel';
    panel.className = 'verified-pins-panel';
    panel.innerHTML = `
      <div>
        <strong>Verified stop pins</strong>
        <span data-verified-pin-count>0 verified</span>
      </div>
      <p>Confirm the exact coach pickup/drop-off point. Route calculation uses the coordinates you approve.</p>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  function updateCount() {
    const inputs = allPinInputs();
    const count = inputs.filter(inputIsVerified).length;
    const panel = ensurePanel();

    panel.querySelector('[data-verified-pin-count]').textContent =
      `${count} verified`;

    inputs.forEach(syncControl);
  }

  function controlFor(input) {
    let control = input.parentElement?.querySelector(
      ':scope > .verified-pin-control'
    );
    if (control) return control;

    control = document.createElement('div');
    control.className = 'verified-pin-control';
    control.innerHTML = `
      <button type="button" class="verify-pin-btn">Verify pin</button>
      <span class="verify-pin-state">Not verified</span>
    `;

    const label = input.closest('label');
    if (label) label.appendChild(control);
    else input.insertAdjacentElement('afterend', control);

    control.querySelector('.verify-pin-btn')
      .addEventListener('click', () => beginVerification(input));

    input.addEventListener('input', () => {
      if (!inputIsVerified(input)) {
        input.dataset.pinVerified = 'false';
        delete input.dataset.verifiedLabel;
      }
      syncControl(input);
      updateCount();
    });

    STATE.set(input, control);
    return control;
  }

  function syncControl(input) {
    if (!input) return;
    const control = controlFor(input);
    const state = control.querySelector('.verify-pin-state');
    const button = control.querySelector('.verify-pin-btn');
    const verified = inputIsVerified(input);

    input.dataset.pinVerified = String(verified);
    state.textContent = verified ? 'Verified' : 'Not verified';
    state.classList.toggle('verified', verified);
    state.classList.toggle('unverified', !verified);
    button.textContent = verified ? 'Re-verify pin' : 'Verify pin';
  }

  function closeChooser() {
    chooser?.remove();
    chooser = null;
  }

  function showChooser(input, candidates) {
    closeChooser();

    chooser = document.createElement('div');
    chooser.className = 'verified-pin-chooser';
    chooser.innerHTML = `
      <div class="verified-pin-chooser-card">
        <div class="verified-pin-chooser-head">
          <div>
            <strong>Choose the exact location</strong>
            <span>Select a result, drag the pin if required, then confirm.</span>
          </div>
          <button type="button" data-close-pin>×</button>
        </div>
        <div class="verified-pin-candidates"></div>
      </div>
    `;

    const list = chooser.querySelector('.verified-pin-candidates');
    candidates.slice(0, 8).forEach((candidate, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'verified-pin-candidate';
      button.innerHTML = `
        <strong>${esc(candidate.label || 'Location')}</strong>
        <span>${Number(candidate.lat).toFixed(6)}, ${Number(candidate.lon).toFixed(6)}</span>
      `;
      button.addEventListener('click', () => {
        closeChooser();
        placeVerificationMarker(input, candidate);
      });
      list.appendChild(button);

      if (index === 0) button.classList.add('recommended');
    });

    chooser.querySelector('[data-close-pin]')
      .addEventListener('click', closeChooser);

    chooser.addEventListener('click', (event) => {
      if (event.target === chooser) closeChooser();
    });

    document.body.appendChild(chooser);
  }

  async function beginVerification(input) {
    const query = String(input.value || '').trim();
    if (!query) {
      alert('Enter a start, destination or stop first.');
      input.focus();
      return;
    }

    const control = controlFor(input);
    const button = control.querySelector('.verify-pin-btn');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Searching…';

    try {
      const response = await fetch(
        `/api/geocode-candidates?q=${encodeURIComponent(query)}`,
        { cache: 'no-store' }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || 'Location search failed.');
      }

      const candidates = Array.isArray(payload.candidates)
        ? payload.candidates.filter((candidate) =>
            Number.isFinite(Number(candidate.lat)) &&
            Number.isFinite(Number(candidate.lon))
          )
        : [];

      if (!candidates.length) {
        throw new Error('No usable map locations were returned.');
      }

      showChooser(input, candidates);
    } catch (error) {
      alert(error.message || 'Could not verify this pin.');
    } finally {
      button.disabled = false;
      button.textContent = original;
      syncControl(input);
    }
  }

  function plannerMap() {
    // Main app's Leaflet map is not exported, but Leaflet stamps the map
    // container. Locate the map instance via controls is unreliable.
    // We therefore use the already-rendered map through DOM click events only
    // when window.coachSafeMap is available; otherwise create a lightweight
    // verification map in the confirmation sheet.
    return window.coachSafeMap || null;
  }

  function placeVerificationMarker(input, candidate) {
    activeInput = input;

    let sheet = document.getElementById('verifiedPinConfirmSheet');
    if (sheet) sheet.remove();

    sheet = document.createElement('div');
    sheet.id = 'verifiedPinConfirmSheet';
    sheet.className = 'verified-pin-confirm-sheet';
    sheet.innerHTML = `
      <div class="verified-pin-confirm-card">
        <div>
          <strong>Confirm coach stop</strong>
          <span id="verifiedPinConfirmLabel">${esc(candidate.label)}</span>
        </div>
        <div id="verifiedPinMiniMap"></div>
        <p>Drag the marker to the exact kerb, entrance or coach pickup point.</p>
        <div class="verified-pin-confirm-actions">
          <button type="button" data-cancel-pin>Cancel</button>
          <button type="button" class="primary" data-confirm-pin>Confirm verified pin</button>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    const miniMap = L.map('verifiedPinMiniMap', {
      zoomControl: true,
      attributionControl: true
    }).setView(
      [Number(candidate.lat), Number(candidate.lon)],
      18
    );

    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 20,
        attribution: '&copy; OpenStreetMap contributors'
      }
    ).addTo(miniMap);

    activeMarker = L.marker(
      [Number(candidate.lat), Number(candidate.lon)],
      { draggable: true }
    ).addTo(miniMap);

    const close = () => {
      try { miniMap.remove(); } catch {}
      sheet.remove();
      activeMarker = null;
      activeInput = null;
    };

    sheet.querySelector('[data-cancel-pin]')
      .addEventListener('click', close);

    sheet.querySelector('[data-confirm-pin]')
      .addEventListener('click', () => {
        const point = activeMarker.getLatLng();
        const label = String(candidate.label || input.value || '').trim();

        input.value =
          `${point.lat.toFixed(6)},${point.lng.toFixed(6)} | ${label}`;

        input.dataset.pinVerified = 'true';
        input.dataset.verifiedLabel = label;
        input.dispatchEvent(
          new Event('change', { bubbles: true })
        );

        syncControl(input);
        updateCount();
        close();
      });

    window.setTimeout(() => miniMap.invalidateSize(true), 60);
  }

  function initialise() {
    ensurePanel();
    allPinInputs().forEach(syncControl);
    updateCount();

    const observer = new MutationObserver(() => {
      allPinInputs().forEach(syncControl);
      updateCount();
    });

    const waypointList =
      document.getElementById('waypointList') ||
      form;

    observer.observe(waypointList, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise);
  } else {
    initialise();
  }

  window.CoachSafeVerifiedPins = {
    count: () => allPinInputs().filter(inputIsVerified).length,
    allVerified: () => {
      const required = [
        form.elements.start,
        form.elements.destination
      ].filter(Boolean);
      return required.every(inputIsVerified) &&
        Array.from(
          document.querySelectorAll('[data-waypoint-input]')
        )
          .filter((input) => String(input.value || '').trim())
          .every(inputIsVerified);
    },
    update: updateCount
  };
})();
