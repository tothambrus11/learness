/** Being installed, and being updated, as a phone app.
 *
 *  A new build waits until every tab of the old one is closed, so a session
 *  never has its code swapped out from under it. The page is told so it can
 *  offer a reload, and when you take it the waiting worker is told to step in.
 */

/** Calls back with the waiting worker when a new version is ready. */
export function onUpdateReady(handler) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  let cancelled = false;

  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg || cancelled) return;
    if (reg.waiting && navigator.serviceWorker.controller) handler(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const fresh = reg.installing;
      if (!fresh) return;
      fresh.addEventListener('statechange', () => {
        /* Installed with a controller already in place means an upgrade, not
           the very first install, which needs nothing said. */
        if (fresh.state === 'installed' && navigator.serviceWorker.controller
            && !cancelled) handler(fresh);
      });
    });
  }).catch(() => {});

  return () => { cancelled = true; };
}

export function applyUpdate(worker) {
  if (!worker) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(),
    { once: true });
  worker.postMessage('skipWaiting');
}

let deferredInstall = null;
const listeners = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event;
    for (const fn of listeners) fn(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    for (const fn of listeners) fn(false);
  });
}

/** Reports whether the browser is offering to install the app. Nothing is
 *  offered when it is already installed, or on browsers that never ask. */
export function onInstallable(handler) {
  listeners.add(handler);
  handler(!!deferredInstall);
  return () => listeners.delete(handler);
}

export async function promptInstall() {
  const event = deferredInstall;
  if (!event) return false;
  deferredInstall = null;
  event.prompt();
  const { outcome } = await event.userChoice;
  for (const fn of listeners) fn(false);
  return outcome === 'accepted';
}
