(function () {
  'use strict';

  if (window.__COACH_SAFE_PWA_V1__) return;
  window.__COACH_SAFE_PWA_V1__ = true;

  let deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.navigator.standalone === true;
  }

  function createInstallButton() {
    if (isStandalone() || document.getElementById('coachSafeInstallAppBtn')) return;

    const button = document.createElement('button');
    button.id = 'coachSafeInstallAppBtn';
    button.type = 'button';
    button.textContent = 'Install Coach Safe';
    button.setAttribute('aria-label', 'Install Coach Safe app');
    button.style.cssText = [
      'position:fixed',
      'right:.7rem',
      'bottom:calc(5.4rem + env(safe-area-inset-bottom))',
      'z-index:2147482000',
      'border:1px solid rgba(214,173,82,.85)',
      'border-radius:999px',
      'padding:.65rem .9rem',
      'background:#111',
      'color:#f1d58a',
      'font:700 .82rem system-ui,-apple-system,Segoe UI,sans-serif',
      'box-shadow:0 10px 28px rgba(0,0,0,.45)'
    ].join(';');

    button.addEventListener('click', async () => {
      if (!deferredPrompt) {
        alert('Open Chrome menu and choose “Install app” or “Add to Home screen”.');
        return;
      }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      button.remove();
    });

    document.body.appendChild(button);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/coach-safe-sw.js', { scope: '/' })
        .catch((error) => console.warn('Coach Safe service worker registration failed', error));
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    createInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.getElementById('coachSafeInstallAppBtn')?.remove();
  });

  window.addEventListener('DOMContentLoaded', () => {
    if (!isStandalone()) {
      setTimeout(createInstallButton, 1200);
    }
  });
})();
