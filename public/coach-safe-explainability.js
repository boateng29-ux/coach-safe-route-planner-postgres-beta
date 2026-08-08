/* Coach Safe Stage 1.6 — Explainable AI */
(() => {
  const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[c]));

  function optionsFrom(route = {}) {
    return Array.isArray(route.routeOptions) ? route.routeOptions : [];
  }

  function recommendedFrom(options = []) {
    return options.find((option) => option.recommended) || options[0] || null;
  }

  function selectedFrom(route = {}, options = []) {
    const id = route?.operatorSelection?.candidateId ||
      route?.aiDecision?.operatorSelectedCandidate ||
      recommendedFrom(options)?.id || '';
    return options.find((option) => option.id === id) || recommendedFrom(options);
  }

  function confidenceFor(options = []) {
    if (!options.length) return 0;
    const ranked = [...options]
      .filter((o) => Number.isFinite(Number(o.score)))
      .sort((a, b) => Number(a.score) - Number(b.score));
    const best = ranked[0] || options[0];
    const second = ranked[1];
    let score = 72;
    if (second) score += Math.min(16, Math.max(0, (Number(second.score) - Number(best.score)) * 1.35));
    else score += 6;
    score -= Number(best.severeWarnings || 0) * 18;
    score -= Math.min(10, Number(best.warningCount || 0) * 1.5);
    const detour = Number(best.detourPercent || 0);
    if (detour <= 4) score += 5;
    else if (detour <= 10) score += 2;
    else if (detour > 20) score -= 8;
    if (best.travelMode === 'bus') score += 3;
    return Math.round(Math.max(35, Math.min(98, score)));
  }

  function explainOption(option, recommended) {
    const reasons = [];
    const comparisons = [];
    const detour = Number(option.detourPercent || 0);
    const warnings = Number(option.warningCount || 0);
    const severe = Number(option.severeWarnings || 0);

    reasons.push(option.travelMode === 'bus'
      ? 'Uses coach/bus road-access routing.'
      : 'Uses conservative HGV restriction-check routing.');
    reasons.push(option.routeType === 'shortest'
      ? 'Prioritises route directness.'
      : 'Prioritises journey time.');

    if (detour <= 4) reasons.push('Distance is close to the most direct live candidate.');
    else comparisons.push(`${detour.toFixed(1)}% longer than the most direct live candidate.`);

    const memory = option.memoryEvidence || option.route?.coachSafeIntelligence?.memoryEvidence;
    if (memory?.matched && memory?.applied !== false) {
      reasons.push(
        `Matches a previously approved coach corridor (${Number(memory.similarityPercent || 0)}% similarity).`
      );

      comparisons.push(
        `Approved-route memory improved this candidate by ${Number(memory.bonus || 0).toFixed(1)} score points.`
      );
    } else if (memory?.matched && memory?.applied === false) {
      comparisons.push(
        memory.reason ||
        'Approved-route memory was ignored because a more efficient live route is available.'
      );
    }

    const dominatedBy =
      option.dominatedBy ||
      option.route?.coachSafeIntelligence?.dominatedBy;

    if (dominatedBy) {
      const distanceText =
        Number(dominatedBy.distanceSavingM || 0) >= 500
          ? `${(Number(dominatedBy.distanceSavingM) / 1609.344).toFixed(1)} miles shorter`
          : `${Math.round(Number(dominatedBy.distanceSavingM || 0))}m shorter`;

      const timeText =
        Number(dominatedBy.timeSavingS || 0) >= 60
          ? `${Math.round(Number(dominatedBy.timeSavingS) / 60)} min faster`
          : 'at least as fast';

      comparisons.push(
        `${dominatedBy.label || 'Another live route'} is ${distanceText} and ${timeText}; this candidate cannot be the AI recommendation.`
      );
    }

    const directnessPenalty = Number(option.directnessPenalty || option.route?.coachSafeIntelligence?.directnessPenalty || 0);
    if (directnessPenalty > 0) {
      comparisons.push(`Coach Safe applied a ${directnessPenalty.toFixed(1)}-point unnecessary-deviation penalty.`);
    }

    if (severe > 0) comparisons.push(`${severe} severe warning${severe === 1 ? '' : 's'} require review.`);
    else if (warnings === 0) reasons.push('No route-specific warnings returned.');
    else reasons.push(`${warnings} route warning${warnings === 1 ? '' : 's'} require review.`);

    if (recommended && recommended.id !== option.id) {
      const timeDiff = Number(option.timeS || 0) - Number(recommended.timeS || 0);
      const distanceDiff = Number(option.distanceM || 0) - Number(recommended.distanceM || 0);
      if (Math.abs(timeDiff) >= 90) comparisons.push(
        `${Math.abs(Math.round(timeDiff / 60))} min ${timeDiff > 0 ? 'slower' : 'faster'} than AI recommendation.`
      );
      if (Math.abs(distanceDiff) >= 500) comparisons.push(
        `${Math.abs(distanceDiff / 1609.344).toFixed(1)} mi ${distanceDiff > 0 ? 'longer' : 'shorter'} than AI recommendation.`
      );
    }

    return { reasons, comparisons };
  }

  function buildExplanation(route = {}) {
    const options = optionsFrom(route);
    if (!options.length) return null;
    const recommended = recommendedFrom(options);
    const selected = selectedFrom(route, options);
    const override = selected && recommended && selected.id !== recommended.id;
    const confidence = confidenceFor(options);
    const checks = [];

    checks.push({
      status: recommended.travelMode === 'bus' ? 'pass' : 'review',
      label: recommended.travelMode === 'bus' ? 'Coach/bus access model' : 'Restriction model review',
      detail: recommended.travelMode === 'bus'
        ? 'Recommendation uses coach/bus road access rather than HGV-only routing.'
        : 'Recommendation uses conservative HGV restriction logic and should be operator-reviewed.'
    });

    const severe = Number(recommended.severeWarnings || 0);
    checks.push({
      status: severe === 0 ? 'pass' : 'fail',
      label: severe === 0 ? 'No severe warnings' : 'Severe warning present',
      detail: severe === 0
        ? 'No severe route warning was returned for the recommendation.'
        : `${severe} severe warning${severe === 1 ? '' : 's'} require review.`
    });

    const detour = Number(recommended.detourPercent || 0);
    checks.push({
      status: detour <= 10 ? 'pass' : 'review',
      label: 'Directness check',
      detail: `Recommended route is ${detour.toFixed(1)}% above the shortest live distance.`
    });

    const memory = recommended.memoryEvidence || recommended.route?.coachSafeIntelligence?.memoryEvidence;
    checks.push({
      status: memory?.matched ? 'pass' : 'review',
      label: 'Approved route memory',
      detail:
        memory?.matched && memory?.applied !== false
          ? `Matches a previously approved corridor at ${Number(memory.similarityPercent || 0)}% similarity. Memory is being used only as a tie-breaker.`
          : memory?.matched
            ? 'A similar approved corridor exists, but Coach Safe ignored its memory bonus because a more efficient live route is available.'
            : 'No sufficiently similar approved corridor was used.'
    });

    return {
      confidence,
      headline: override ? 'Operator selected an alternative route' : 'Coach Safe AI recommendation',
      summary: override
        ? `${selected.label} is selected. Coach Safe originally recommended ${recommended.label}.`
        : `${recommended.label} currently has the strongest balance of directness, time and coach suitability.`,
      selectedLabel: selected?.label || recommended?.label || 'Selected route',
      selectionSource: override ? 'operator-override' : 'coach-safe-ai',
      checks,
      alternatives: options.map((option) => ({
        id: option.id,
        label: option.label,
        recommended: Boolean(option.recommended),
        ...explainOption(option, recommended)
      }))
    };
  }

  function ensurePanel() {
    let panel = document.getElementById('coachSafeExplainability');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'coachSafeExplainability';
    panel.className = 'coach-safe-explainability';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="ai-explain-head">
        <div><span class="ai-explain-eyebrow">Coach Safe AI decision</span><h3 data-ai-headline>Why this route?</h3></div>
        <button type="button" class="ai-why-button" data-ai-toggle aria-expanded="false">Why?</button>
      </div>
      <div class="ai-confidence-row">
        <div class="ai-confidence-ring"><strong data-ai-confidence>—</strong><span>confidence</span></div>
        <div class="ai-confidence-copy"><strong data-ai-selected>Waiting for route</strong><p data-ai-summary></p></div>
      </div>
      <div class="ai-explain-details" data-ai-details hidden>
        <div class="ai-check-grid" data-ai-checks></div>
        <div class="ai-alternative-analysis"><h4>Route comparison</h4><div data-ai-alternatives></div></div>
      </div>`;

    const routeChoice = document.getElementById('coachSafeRouteChoicePanel');
    const warnings = document.getElementById('warnings');
    if (routeChoice?.parentElement) routeChoice.insertAdjacentElement('beforebegin', panel);
    else if (warnings) warnings.insertAdjacentElement('afterend', panel);
    else document.body.appendChild(panel);

    panel.querySelector('[data-ai-toggle]').addEventListener('click', () => {
      const details = panel.querySelector('[data-ai-details]');
      const button = panel.querySelector('[data-ai-toggle]');
      const open = details.hidden;
      details.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      button.textContent = open ? 'Hide why' : 'Why?';
    });
    return panel;
  }

  function checkHtml(check) {
    const status = ['pass', 'review', 'fail'].includes(check.status) ? check.status : 'review';
    const icon = status === 'pass' ? '✓' : status === 'fail' ? '!' : '•';
    return `<article class="ai-check-card ${status}"><span class="ai-check-icon">${icon}</span><div><strong>${esc(check.label)}</strong><p>${esc(check.detail)}</p></div></article>`;
  }

  function alternativeHtml(item) {
    const points = [...(item.reasons || []), ...(item.comparisons || [])];
    return `<article class="ai-alternative-card ${item.recommended ? 'recommended' : ''}"><div><strong>${esc(item.label)}</strong>${item.recommended ? '<span>AI recommendation</span>' : ''}</div><ul>${points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></article>`;
  }

  function render(route) {
    const panel = ensurePanel();
    const explanation = buildExplanation(route);
    if (!explanation) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.dataset.confidence = explanation.confidence >= 85 ? 'high' : explanation.confidence >= 65 ? 'medium' : 'low';
    panel.classList.toggle('operator-override', explanation.selectionSource === 'operator-override');
    panel.querySelector('[data-ai-confidence]').textContent = `${explanation.confidence}%`;
    panel.querySelector('[data-ai-headline]').textContent = explanation.headline;
    panel.querySelector('[data-ai-selected]').textContent = explanation.selectedLabel;
    panel.querySelector('[data-ai-summary]').textContent = explanation.summary;
    panel.querySelector('[data-ai-checks]').innerHTML = explanation.checks.map(checkHtml).join('');
    panel.querySelector('[data-ai-alternatives]').innerHTML = explanation.alternatives.map(alternativeHtml).join('');
  }

  window.CoachSafeExplainability = { render, buildExplanation };
  window.addEventListener('coach-safe-route-selected', (event) => render(event.detail?.route));
})();

/* COACH_SAFE_STAGE190_EXPLAINABLE_MEMORY */

/* COACH_SAFE_STAGE191_EFFICIENCY_EXPLANATION */
