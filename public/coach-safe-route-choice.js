/* Coach Safe Stage 1.5 — Operator Route Choice */
(() => {
  const state = {
    panel: null,
    alternativeLayers: [],
    lastResponse: null,
    selectedId: ''
  };

  const metresToMilesLocal = (metres) =>
    (Number(metres || 0) / 1609.344).toFixed(1);

  const secondsToTextLocal = (seconds) => {
    const minutes = Math.round(Number(seconds || 0) / 60);
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;

    return hours
      ? `${hours}h ${remaining}m`
      : `${remaining}m`;
  };

  const escapeHtmlLocal = (value = '') =>
    String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[character]));

  function plannerMap() {
    return window.coachSafePlannerMap || null;
  }

  function ensurePanel() {
    if (state.panel?.isConnected) {
      return state.panel;
    }

    const panel = document.createElement('section');
    panel.id = 'coachSafeRouteChoicePanel';
    panel.className = 'coach-safe-route-choice-panel';
    panel.hidden = true;

    panel.innerHTML = `
      <div class="route-choice-heading">
        <div>
          <span class="route-choice-eyebrow">Coach Safe AI</span>
          <h3>Choose the route to approve</h3>
          <p>
            Coach Safe recommends one route, but the operator has final
            control. Preview any viable option before approving it.
          </p>
        </div>
        <span class="route-choice-count" data-route-choice-count></span>
      </div>

      <div
        class="route-choice-grid"
        data-route-choice-grid
      ></div>

      <div class="route-choice-footer">
        <strong data-selected-route-label>
          AI recommendation selected
        </strong>
        <span>
          The route highlighted in blue is the route that will be saved
          and sent to the driver.
        </span>
      </div>
    `;

    const warnings =
      document.getElementById('warnings') ||
      document.querySelector('.warnings');

    if (warnings?.parentElement) {
      warnings.insertAdjacentElement('afterend', panel);
    } else {
      const form =
        document.getElementById('routeForm');

      form?.parentElement?.appendChild(panel);
    }

    state.panel = panel;
    return panel;
  }

  function clearAlternativeLayers() {
    const map = plannerMap();

    if (map) {
      state.alternativeLayers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch {}
      });
    }

    state.alternativeLayers = [];
  }

  function drawAlternatives(options, selectedId) {
    clearAlternativeLayers();

    const map = plannerMap();

    if (
      !map ||
      !window.L ||
      !Array.isArray(options)
    ) {
      return;
    }

    options
      .filter((option) => option.id !== selectedId)
      .forEach((option) => {
        const points =
          Array.isArray(option.route?.points)
            ? option.route.points
            : [];

        if (points.length < 2) return;

        const line = L.polyline(
          points,
          {
            weight: option.recommended ? 5 : 4,
            opacity: option.recommended ? 0.72 : 0.48,
            dashArray: option.recommended
              ? '10 7'
              : '7 9',
            className:
              option.recommended
                ? 'coach-route-alternative recommended'
                : 'coach-route-alternative'
          }
        ).addTo(map);

        line.bindTooltip(
          `${option.label} · ${metresToMilesLocal(option.distanceM)} mi · ${secondsToTextLocal(option.timeS)}`,
          {
            sticky: true,
            direction: 'top'
          }
        );

        state.alternativeLayers.push(line);
      });
  }

  function optionDescription(option) {
    const pieces = [];

    if (option.recommended) {
      pieces.push('Coach Safe recommended');
    }

    if (option.routeType === 'shortest') {
      pieces.push('more direct');
    } else {
      pieces.push('time optimised');
    }

    if (option.travelMode === 'truck') {
      pieces.push('conservative restriction check');
    } else {
      pieces.push('coach/bus road model');
    }

    return pieces.join(' · ');
  }

  function cardHtml(option, selectedId) {
    const selected = option.id === selectedId;

    const timeDelta =
      Number(option.timeDifferenceS || 0);

    const timeDeltaText =
      Math.abs(timeDelta) >= 60
        ? `${Math.abs(Math.round(timeDelta / 60))} min ${
            timeDelta > 0 ? 'slower' : 'faster'
          }`
        : 'fastest-time range';

    return `
      <article
        class="
          route-choice-card
          ${selected ? 'selected' : ''}
          ${option.recommended ? 'recommended' : ''}
        "
        data-route-option="${escapeHtmlLocal(option.id)}"
      >
        <div class="route-choice-card-top">
          <div>
            <span class="route-choice-badges">
              ${
                option.recommended
                  ? '<b class="ai-badge">AI recommended</b>'
                  : '<b class="alternative-badge">Alternative</b>'
              }
              ${
                selected
                  ? '<b class="selected-badge">Selected</b>'
                  : ''
              }
            </span>

            <h4>${escapeHtmlLocal(option.label)}</h4>

            <p>
              ${escapeHtmlLocal(optionDescription(option))}
            </p>
          </div>

          <span class="route-choice-rank">
            #${Number(option.recommendationRank || 0)}
          </span>
        </div>

        <div class="route-choice-metrics">
          <div>
            <small>Distance</small>
            <strong>
              ${metresToMilesLocal(option.distanceM)} mi
            </strong>
          </div>

          <div>
            <small>Time</small>
            <strong>
              ${secondsToTextLocal(option.timeS)}
            </strong>
          </div>

          <div>
            <small>Detour</small>
            <strong>
              ${Number(option.detourPercent || 0).toFixed(1)}%
            </strong>
          </div>

          <div>
            <small>Comparison</small>
            <strong>${escapeHtmlLocal(timeDeltaText)}</strong>
          </div>
        </div>

        ${
          option.caution
            ? `<div class="route-choice-caution">
                ${escapeHtmlLocal(option.caution)}
              </div>`
            : ''
        }

        <div class="route-choice-actions">
          <button
            type="button"
            data-preview-route="${escapeHtmlLocal(option.id)}"
          >
            Preview
          </button>

          <button
            type="button"
            class="${selected ? 'selected-action' : 'primary-action'}"
            data-use-route="${escapeHtmlLocal(option.id)}"
            ${selected ? 'disabled' : ''}
          >
            ${selected ? 'Using this route' : 'Use this route'}
          </button>
        </div>
      </article>
    `;
  }

  function render(route) {
    const options =
      Array.isArray(route?.routeOptions)
        ? route.routeOptions
        : [];

    const panel = ensurePanel();

    if (!options.length) {
      panel.hidden = true;
      clearAlternativeLayers();
      return;
    }

    state.lastResponse = route;

    const selectedId =
      route?.operatorSelection?.candidateId ||
      route?.aiDecision?.operatorSelectedCandidate ||
      route?.aiDecision?.recommendedCandidate ||
      options.find((option) => option.recommended)?.id ||
      options[0]?.id ||
      '';

    state.selectedId = selectedId;

    panel.hidden = false;

    panel.querySelector(
      '[data-route-choice-count]'
    ).textContent =
      `${options.length} live route option${
        options.length === 1 ? '' : 's'
      }`;

    panel.querySelector(
      '[data-route-choice-grid]'
    ).innerHTML =
      options
        .map((option) => cardHtml(option, selectedId))
        .join('');

    const selectedOption =
      options.find((option) => option.id === selectedId);

    const selectedLabel =
      panel.querySelector('[data-selected-route-label]');

    if (selectedLabel && selectedOption) {
      selectedLabel.textContent =
        `${selectedOption.label} selected${
          selectedOption.recommended
            ? ' · Coach Safe recommendation'
            : ' · Operator override'
        }`;
    }

    drawAlternatives(options, selectedId);
  }

  function routeOption(id) {
    return state.lastResponse?.routeOptions?.find(
      (option) => option.id === id
    );
  }

  function preview(id) {
    const option = routeOption(id);
    const map = plannerMap();

    if (!option || !map || !window.L) return;

    const points =
      Array.isArray(option.route?.points)
        ? option.route.points
        : [];

    if (points.length < 2) return;

    const previewLayer = L.polyline(
      points,
      {
        weight: 9,
        opacity: 0.88,
        dashArray: '2 0',
        className: 'coach-route-preview'
      }
    ).addTo(map);

    try {
      map.fitBounds(
        previewLayer.getBounds(),
        {
          padding: [45, 45],
          maxZoom: 15
        }
      );
    } catch {}

    window.setTimeout(() => {
      try {
        map.removeLayer(previewLayer);
      } catch {}
    }, 2600);
  }

  function choose(id) {
    const option = routeOption(id);

    if (!option?.route) return;

    /*
     * The main app exposes this hook in Stage 1.5. Calling it switches the
     * actual currentRoute used by save/approve/export and refreshes the map.
     */
    if (
      typeof window.coachSafeSelectOperatorRoute ===
      'function'
    ) {
      window.coachSafeSelectOperatorRoute(
        option.route,
        option,
        state.lastResponse.routeOptions
      );

      state.selectedId = id;

      state.lastResponse = {
        ...option.route,
        routeOptions:
          state.lastResponse.routeOptions
      };

      render(state.lastResponse);
    }
  }

  ensurePanel().addEventListener(
    'click',
    (event) => {
      const previewButton =
        event.target.closest('[data-preview-route]');

      if (previewButton) {
        preview(previewButton.dataset.previewRoute);
        return;
      }

      const useButton =
        event.target.closest('[data-use-route]');

      if (useButton) {
        choose(useButton.dataset.useRoute);
      }
    }
  );

  window.CoachSafeRouteChoice = {
    render,
    clear: clearAlternativeLayers
  };
})();
