/* COACH_SAFE_VERIFIED_PINS_STAGE142 */
(() => {
  const form = document.getElementById('routeForm');
  if (!form || !window.L) return;

  const coordinatePattern =
    /^\s*(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?:\s*\|\s*(.+))?\s*$/;

  let activeSheet = null;

  const escapeHtml = (value = '') =>
    String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[character]));

  function isVerified(input) {
    if (!input) return false;
    const match = String(input.value || '').match(coordinatePattern);
    if (!match) return false;

    const lat = Number(match[1]);
    const lon = Number(match[2]);

    return Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 &&
      lon >= -180 && lon <= 180;
  }

  function waypointInputs() {
    const selectors = [
      '[data-waypoint-input]',
      'input[name="waypoints[]"]',
      'input[name^="waypoint"]',
      '.waypoint-row input[type="text"]',
      '.stop-row input[type="text"]'
    ];

    return Array.from(
      new Set(
        selectors.flatMap((selector) =>
          Array.from(document.querySelectorAll(selector))
        )
      )
    );
  }

  function allInputs() {
    return [
      form.elements.start,
      form.elements.destination,
      ...waypointInputs()
    ].filter(Boolean);
  }

  function requiredInputs() {
    return [
      form.elements.start,
      form.elements.destination,
      ...waypointInputs().filter((input) =>
        String(input.value || '').trim()
      )
    ].filter(Boolean);
  }

  function ensureStatusPanel() {
    let panel = document.getElementById('verifiedPinsStage142Panel');

    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'verifiedPinsStage142Panel';
      panel.className = 'verified-pins-stage142-panel';
      panel.innerHTML = `
        <div class="verified-pins-stage142-head">
          <strong>Verified stop pins</strong>
          <span data-pin-count>0 verified</span>
        </div>
        <p>
          Coach Safe routes from the exact coordinates you confirm,
          not only the typed address.
        </p>
      `;

      const mapShell =
        document.querySelector('.map-shell') ||
        document.querySelector('[data-panel="planner"]') ||
        document.body;

      mapShell.appendChild(panel);
    }

    return panel;
  }

  function controlFor(input) {
    const existing =
      input.parentElement?.querySelector(
        ':scope > .verified-pin-stage142-control'
      );

    if (existing) return existing;

    const control = document.createElement('div');
    control.className = 'verified-pin-stage142-control';
    control.innerHTML = `
      <button
        type="button"
        class="verified-pin-stage142-button"
      >Verify pin</button>
      <span class="verified-pin-stage142-status">
        Not verified
      </span>
    `;

    const container =
      input.closest('label') ||
      input.parentElement;

    container?.appendChild(control);

    control
      .querySelector('.verified-pin-stage142-button')
      .addEventListener('click', () => verifyInput(input));

    input.addEventListener('input', () => {
      if (!isVerified(input)) {
        input.dataset.pinVerified = 'false';
      }

      syncInput(input);
      updateCount();
    });

    return control;
  }

  function syncInput(input) {
    if (!input) return;
    const control = controlFor(input);
    const verified = isVerified(input);
    const status = control.querySelector(
      '.verified-pin-stage142-status'
    );
    const button = control.querySelector(
      '.verified-pin-stage142-button'
    );

    input.dataset.pinVerified = String(verified);

    status.textContent =
      verified ? 'Verified' : 'Not verified';

    status.classList.toggle('verified', verified);
    status.classList.toggle('unverified', !verified);

    button.textContent =
      verified ? 'Re-verify pin' : 'Verify pin';
  }

  function updateCount() {
    const inputs = allInputs();
    inputs.forEach(syncInput);

    const count = inputs.filter(isVerified).length;
    const panel = ensureStatusPanel();

    panel.querySelector('[data-pin-count]').textContent =
      `${count} verified`;

    panel.classList.toggle(
      'all-verified',
      requiredInputs().length > 0 &&
      requiredInputs().every(isVerified)
    );
  }

  function closeSheet() {
    if (!activeSheet) return;

    try {
      activeSheet.map?.remove();
    } catch {}

    activeSheet.element?.remove();
    activeSheet = null;
  }

  function openConfirmSheet(input, candidate) {
    closeSheet();

    const element = document.createElement('div');
    element.className = 'verified-pin-stage142-sheet';

    element.innerHTML = `
      <div class="verified-pin-stage142-card">
        <div class="verified-pin-stage142-title">
          <div>
            <strong>Confirm exact coach location</strong>
            <span>${escapeHtml(candidate.label || input.value)}</span>
          </div>
          <button type="button" data-close-pin>×</button>
        </div>

        <div id="verifiedPinStage142Map"></div>

        <div class="verified-pin-stage142-coordinate">
          <span>Selected coordinate</span>
          <strong data-coordinate></strong>
        </div>

        <p>
          Drag the blue marker to the actual kerb, entrance,
          bay or coach pickup point, then press Confirm.
        </p>

        <div class="verified-pin-stage142-actions">
          <button type="button" data-cancel-pin>
            Cancel
          </button>
          <button
            type="button"
            class="primary"
            data-confirm-pin
          >
            Confirm verified pin
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(element);

    const map = L.map(
      'verifiedPinStage142Map',
      {
        zoomControl: true,
        attributionControl: true
      }
    ).setView(
      [Number(candidate.lat), Number(candidate.lon)],
      18
    );

    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 20,
        attribution: '&copy; OpenStreetMap contributors'
      }
    ).addTo(map);

    const marker = L.marker(
      [Number(candidate.lat), Number(candidate.lon)],
      {
        draggable: true
      }
    ).addTo(map);

    const coordinateNode =
      element.querySelector('[data-coordinate]');

    const updateCoordinate = () => {
      const point = marker.getLatLng();
      coordinateNode.textContent =
        `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
    };

    marker.on('move', updateCoordinate);
    marker.on('dragend', updateCoordinate);
    updateCoordinate();

    activeSheet = {
      element,
      map,
      marker,
      input,
      candidate
    };

    element
      .querySelector('[data-close-pin]')
      .addEventListener('click', closeSheet);

    element
      .querySelector('[data-cancel-pin]')
      .addEventListener('click', closeSheet);

    element
      .querySelector('[data-confirm-pin]')
      .addEventListener('click', () => {
        const point = marker.getLatLng();

        const label = String(
          candidate.label ||
          input.value ||
          'Verified coach stop'
        ).trim();

        input.value =
          `${point.lat.toFixed(6)},${point.lng.toFixed(6)} | ${label}`;

        input.dataset.pinVerified = 'true';
        input.dataset.verifiedLabel = label;

        input.dispatchEvent(
          new Event('input', { bubbles: true })
        );

        input.dispatchEvent(
          new Event('change', { bubbles: true })
        );

        syncInput(input);
        updateCount();

        const count =
          allInputs().filter(isVerified).length;

        closeSheet();

        const toast =
          document.getElementById('toast');

        if (toast) {
          toast.textContent =
            `Pin verified. ${count} verified location${count === 1 ? '' : 's'}.`;
          toast.classList.add('show');
          setTimeout(
            () => toast.classList.remove('show'),
            2200
          );
        }
      });

    setTimeout(() => map.invalidateSize(true), 80);
  }

  function showCandidates(input, candidates) {
    closeSheet();

    const element = document.createElement('div');
    element.className = 'verified-pin-stage142-sheet';

    element.innerHTML = `
      <div class="verified-pin-stage142-card candidate-card">
        <div class="verified-pin-stage142-title">
          <div>
            <strong>Select the correct search result</strong>
            <span>${escapeHtml(input.value)}</span>
          </div>
          <button type="button" data-close-pin>×</button>
        </div>

        <div class="verified-pin-stage142-candidates"></div>
      </div>
    `;

    const list =
      element.querySelector(
        '.verified-pin-stage142-candidates'
      );

    candidates.slice(0, 8).forEach((candidate, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className =
        'verified-pin-stage142-candidate';

      if (index === 0) {
        button.classList.add('recommended');
      }

      button.innerHTML = `
        <strong>${escapeHtml(candidate.label || 'Location')}</strong>
        <span>
          ${Number(candidate.lat).toFixed(6)},
          ${Number(candidate.lon).toFixed(6)}
        </span>
      `;

      button.addEventListener(
        'click',
        () => openConfirmSheet(input, candidate)
      );

      list.appendChild(button);
    });

    element
      .querySelector('[data-close-pin]')
      .addEventListener('click', closeSheet);

    document.body.appendChild(element);

    activeSheet = {
      element,
      map: null
    };
  }

  async function verifyInput(input) {
    const query = String(input.value || '').trim();

    if (!query) {
      input.focus();
      return;
    }

    const control = controlFor(input);
    const button =
      control.querySelector(
        '.verified-pin-stage142-button'
      );

    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Searching…';

    try {
      const response = await fetch(
        `/api/geocode-candidates?q=${encodeURIComponent(query)}`,
        {
          cache: 'no-store'
        }
      );

      const payload =
        await response.json().catch(() => ({}));

      if (!response.ok || payload.ok === false) {
        throw new Error(
          payload.error ||
          'Could not search this location.'
        );
      }

      const candidates =
        Array.isArray(payload.candidates)
          ? payload.candidates.filter((candidate) =>
              Number.isFinite(Number(candidate.lat)) &&
              Number.isFinite(Number(candidate.lon))
            )
          : [];

      if (!candidates.length) {
        throw new Error(
          'No usable map result was returned.'
        );
      }

      showCandidates(input, candidates);
    } catch (error) {
      window.alert(
        error.message ||
        'Could not verify this location.'
      );
    } finally {
      button.disabled = false;
      button.textContent = oldText;
      syncInput(input);
    }
  }

  function initialise() {
    allInputs().forEach(syncInput);
    updateCount();

    const observer =
      new MutationObserver(() => updateCount());

    observer.observe(form, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      initialise
    );
  } else {
    initialise();
  }

  window.CoachSafeVerifiedPins = {
    count() {
      return allInputs().filter(isVerified).length;
    },
    allVerified() {
      const inputs = requiredInputs();
      return inputs.length > 0 &&
        inputs.every(isVerified);
    },
    refresh: updateCount
  };
})();
