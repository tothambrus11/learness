/** Being installed, and being updated, as a phone app.
 *
 *  A new build waits until every tab of the old one is closed, so a session
 *  never has its code swapped out from under it. The page is told so it can
 *  offer a reload, and when you take it the waiting worker is told to step in.
 */

/** The event a Chromium browser fires when it is willing to offer the install.
 *
 *  It is not in the DOM library, and deliberately so: no other engine
 *  implements it, and it is not on a standards track. Only what this module
 *  touches is named. */
export interface BeforeInstallPromptEvent extends Event {
  /** Shows the browser's own install prompt. Usable once, and only while the
   *  deferred event is still the current one. */
  prompt(): Promise<void>;
  /** What was chosen, once the prompt has been shown. */
  readonly userChoice: Promise<{
    /** `accepted` when the app is being installed. */
    outcome: 'accepted' | 'dismissed';
    /** Where it would be installed, as the browser names it. */
    platform: string;
  }>;
}

declare global {
  interface WindowEventMap {
    /** Chromium offering the install, which is deferred and re-offered by
     *  this module rather than shown at once. */
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

/** Calls back with the waiting worker when a new version is ready. */
export function onUpdateReady(handler: (worker: ServiceWorker) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  let cancelled = false;

  navigator.serviceWorker
    .getRegistration()
    .then((reg) => {
      if (!reg || cancelled) return;
      if (reg.waiting && navigator.serviceWorker.controller) handler(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const fresh = reg.installing;
        if (!fresh) return;
        fresh.addEventListener('statechange', () => {
          /* Installed with a controller already in place means an upgrade, not
           the very first install, which needs nothing said. */
          if (fresh.state === 'installed' && navigator.serviceWorker.controller && !cancelled)
            handler(fresh);
        });
      });
    })
    .catch(() => {});

  return () => {
    cancelled = true;
  };
}

/** Take the new version: the waiting worker is told to step in, and the page
 *  reloads onto it the moment it does. Nothing happens without a worker, so a
 *  banner that has already been acted on is safe to press again. */
export function applyUpdate(worker: ServiceWorker | null): void {
  if (!worker) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
    once: true,
  });
  worker.postMessage('skipWaiting');
}

/** The browser's offer, kept until it is taken. Null where none was made, or
 *  where the one that was made has been used. */
let deferredInstall: BeforeInstallPromptEvent | null = null;
/** Everyone watching whether the app can be installed right now. */
const listeners = new Set<(installable: boolean) => void>();

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
export function onInstallable(handler: (installable: boolean) => void): () => void {
  listeners.add(handler);
  handler(!!deferredInstall);
  return () => listeners.delete(handler);
}

/** Show the browser's install prompt and answer whether it was accepted. The
 *  offer is spent either way: a browser only allows one prompt per offer, and
 *  it makes a fresh one if the app is still not installed. */
export async function promptInstall(): Promise<boolean> {
  const event = deferredInstall;
  if (!event) return false;
  deferredInstall = null;
  void event.prompt();
  const { outcome } = await event.userChoice;
  for (const fn of listeners) fn(false);
  return outcome === 'accepted';
}
