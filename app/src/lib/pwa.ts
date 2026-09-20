/** Being installed, and being updated, as a phone app.
 *
 *  A new build waits until every tab of the old one is closed, so a session
 *  never has its code swapped out from under it. The page is told so it can
 *  offer a reload, and when you take it the waiting worker is told to step in.
 */

/** The install prompt Chrome fires, which is not in the DOM library. */
interface InstallPromptEvent extends Event {
  prompt: () => void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Calls back with the waiting worker when a new version is ready. */
export function onUpdateReady(handler: (worker: ServiceWorker) => void): () => void {
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

export function applyUpdate(worker: ServiceWorker | null): void {
  if (!worker) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(),
    { once: true });
  worker.postMessage('skipWaiting');
}

/** Ask for a new build now, and hand back the one waiting, if any.
 *
 *  The browser checks the worker script on its own only every so often; a
 *  sync is the moment the app is about to read what another device wrote,
 *  possibly on a newer build, so it asks first (GRAMMAR.md, "An older app
 *  in the loop"). The check fetches the script with the cache bypassed and
 *  is over in a round trip; a build found is given a moment to install.
 *  Null when there is nothing newer, when this is the first install (no
 *  controller: nothing to update from), when the browser has no service
 *  worker, or when the check itself fails — being offline is not a reason
 *  to stop, and the sync will say so in its own words. */
export async function updateNow({ waitMs = 3000 }: { waitMs?: number } = {}):
  Promise<ServiceWorker | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || !navigator.serviceWorker.controller) return null;
    await reg.update();
    if (reg.waiting) return reg.waiting;
    const fresh = reg.installing;
    if (!fresh) return null;
    /* Found, still installing: wait for it to be ready, but not for ever. */
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, waitMs);
      fresh.addEventListener('statechange', () => {
        if (fresh.state === 'installed' || fresh.state === 'redundant') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return reg.waiting;
  } catch {
    return null;
  }
}

let deferredInstall: InstallPromptEvent | null = null;
const listeners = new Set<(installable: boolean) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event as InstallPromptEvent;
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
  return () => { listeners.delete(handler); };
}

export async function promptInstall(): Promise<boolean> {
  const event = deferredInstall;
  if (!event) return false;
  deferredInstall = null;
  event.prompt();
  const { outcome } = await event.userChoice;
  for (const fn of listeners) fn(false);
  return outcome === 'accepted';
}
