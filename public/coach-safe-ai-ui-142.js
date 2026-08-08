/* COACH_SAFE_AI_UI_STAGE142 */
(() => {
  const nativeFetch = window.fetch.bind(window);

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[character]));
  }

  function miles(meters) {
    const value = Number(meters || 0) / 1609.344;
    return Number.isFinite(value)
      ? value.toFixed(1)
      : '—';
  }

  function minutes(seconds) {
    const value = Math.round(Number(seconds || 0) / 60);
    return Number.isFinite(value)
      ? `${value} min`
      : '—';
  }

  function ensurePanel() {
    let panel = document.getElementById(
      'coachSafeAiAlternatives'
    );

    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = 'coachSafeAiAlternatives';
    panel.className = 'coach-safe-ai-alternatives';
    panel.innerHTML = `
      <div class="coach-safe-ai-alternatives-head">
        <div>
          <span>Coach Safe AI</span>
          <strong>Route alternatives</strong>
        </div>
        <b data-ai-state>Waiting for route calculation</b>
      </div>
      <div data-ai-content>
        <p>
          Calculate a route to compare coach/bus and
          restriction-check alternatives.
        </p>
      </div>
    `;

    const target =
      document.querySelector('.results-panel') ||
      document.querySelector('[data-panel="planner"]');

    target?.appendChild(panel);
    return panel;
  }

  function renderNoAi(payload) {
    const panel = ensurePanel();
    if (!panel) return;

    panel.querySelector('[data-ai-state]').textContent =
      'No AI comparison returned';

    panel.querySelector('[data-ai-content]').innerHTML = `
      <div class="coach-safe-ai-warning">
        <strong>Live alternatives were not returned</strong>
        <p>
          The route response did not contain
          <code>aiDecision</code>. Coach Safe should not
          describe this as an AI-selected route.
        </p>
      </div>
    `;
  }

  function renderDecision(decision) {
    const panel = ensurePanel();
    if (!panel) return;

    const alternatives =
      Array.isArray(decision.alternatives)
        ? decision.alternatives
        : [];

    panel.querySelector('[data-ai-state]').textContent =
      alternatives.length
        ? `${alternatives.length} live candidates compared`
        : 'AI decision returned';

    const rows = alternatives.map((route) => `
      <article class="
        coach-safe-ai-alternative
        ${route.selected ? 'selected' : ''}
        ${route.rejectedReason ? 'rejected' : ''}
      ">
        <div class="coach-safe-ai-route-title">
          <strong>
            ${escapeHtml(route.name || 'Route candidate')}
          </strong>
          ${
            route.selected
              ? '<span>Selected</span>'
              : route.rejectedReason
                ? '<span class="rejected-label">Rejected</span>'
                : ''
          }
        </div>

        <div class="coach-safe-ai-route-metrics">
          <div>
            <small>Mode</small>
            <strong>${escapeHtml(route.travelMode || '—')}</strong>
          </div>
          <div>
            <small>Type</small>
            <strong>${escapeHtml(route.routeType || '—')}</strong>
          </div>
          <div>
            <small>Distance</small>
            <strong>${miles(route.distanceM)} mi</strong>
          </div>
          <div>
            <small>Time</small>
            <strong>${minutes(route.timeS)}</strong>
          </div>
          <div>
            <small>Detour</small>
            <strong>
              ${Number(route.detourPercent || 0).toFixed(1)}%
            </strong>
          </div>
        </div>

        ${
          route.rejectedReason
            ? `<p class="coach-safe-ai-rejected-reason">
                ${escapeHtml(route.rejectedReason)}
              </p>`
            : ''
        }
      </article>
    `).join('');

    const reasons =
      Array.isArray(decision.reasons)
        ? decision.reasons
        : [];

    panel.querySelector('[data-ai-content]').innerHTML = `
      <div class="coach-safe-ai-selected-summary">
        <strong>
          Selected:
          ${escapeHtml(
            decision.selectedCandidate ||
            'best live candidate'
          )}
        </strong>
        <span>
          ${escapeHtml(
            decision.selectedTravelMode || ''
          )}
          ${escapeHtml(
            decision.selectedRouteType || ''
          )}
        </span>
      </div>

      <div class="coach-safe-ai-route-list">
        ${rows || '<p>No alternative details returned.</p>'}
      </div>

      ${
        reasons.length
          ? `<ul class="coach-safe-ai-reasons">
              ${reasons.map(
                (reason) =>
                  `<li>${escapeHtml(reason)}</li>`
              ).join('')}
            </ul>`
          : ''
      }
    `;
  }

  function inspectPayload(payload) {
    const route =
      payload?.route ||
      payload?.result?.route ||
      payload;

    const decision =
      route?.aiDecision ||
      payload?.aiDecision ||
      null;

    if (decision) {
      renderDecision(decision);
    } else if (
      route &&
      (
        route.provider ||
        route.points ||
        route.summary
      )
    ) {
      renderNoAi(payload);
    }
  }

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);

    try {
      const requestUrl =
        typeof args[0] === 'string'
          ? args[0]
          : args[0]?.url || '';

      const method =
        String(
          args[1]?.method ||
          args[0]?.method ||
          'GET'
        ).toUpperCase();

      if (
        method === 'POST' &&
        (
          requestUrl === '/api/route' ||
          requestUrl.includes('/api/route?')
        )
      ) {
        const clone = response.clone();
        const payload = await clone.json();
        inspectPayload(payload);
      }
    } catch (error) {
      console.warn(
        'Coach Safe AI alternatives UI could not inspect route response.',
        error
      );
    }

    return response;
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      ensurePanel
    );
  } else {
    ensurePanel();
  }
})();
