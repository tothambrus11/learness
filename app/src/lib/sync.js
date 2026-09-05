/** Explicit sync.
 *
 *  Never automatic: you press the button. The local database stays the working
 *  copy, so a session in a basement gym behaves exactly as it does at home, and
 *  nothing is ever half-uploaded mid-review.
 *
 *  Push carries only what changed since the last sync; pull asks for everything
 *  past a server cursor, so neither side depends on the two clocks agreeing.
 */
import { db, getSettings, setSetting } from './db.js';
import { applyPull, collectPush } from './merge.js';
import { connectionState, isOnline, onConnectionChange } from './network.js';
import { shouldAutoSync } from './syncpolicy.js';

export const SYNC_KEYS = { api: 'syncApi', token: 'syncToken', cursor: 'syncCursor',
  syncedAt: 'syncedAt' };

let inFlight = null;

export async function syncConfig() {
  const s = await getSettings();
  /* The API lives on the same origin as the app, so there is nothing to
     configure unless you are pointing at a different deployment. */
  const sameOrigin = typeof location !== 'undefined' ? location.origin : '';
  return { api: s[SYNC_KEYS.api] || sameOrigin, token: s[SYNC_KEYS.token] || '',
    cursor: s[SYNC_KEYS.cursor] || 0, syncedAt: s[SYNC_KEYS.syncedAt] || 0 };
}

export async function configureSync({ api, token }) {
  await setSetting(SYNC_KEYS.api, (api || '').replace(/\/$/, ''));
  await setSetting(SYNC_KEYS.token, token || '');
}

export async function forgetSync() {
  await setSetting(SYNC_KEYS.token, '');
  await setSetting(SYNC_KEYS.cursor, 0);
  await setSetting(SYNC_KEYS.syncedAt, 0);
}

/** One round trip. Returns a summary the UI can show verbatim. */
/** Sync if the policy allows it right now. Returns the result, or the reason
 *  it did not run, so callers can say why nothing happened. */
export async function maybeAutoSync({ busy = false, fetchImpl = fetch } = {}) {
  const s = await getSettings();
  const cfg = await syncConfig();
  const verdict = shouldAutoSync({
    policy: s.autoSync,
    connection: connectionState(),
    online: isOnline(),
    configured: !!(cfg.api && cfg.token),
    lastSyncAt: cfg.syncedAt,
    minIntervalMs: (s.autoSyncMinutes ?? 15) * 60_000,
    busy,
  });
  if (!verdict.sync) return { ran: false, reason: verdict.reason };
  try {
    const result = await sync({ fetchImpl });
    return { ran: true, ...result };
  } catch (err) {
    /* An automatic sync failing is not an error the learner has to deal with;
       the next trigger will try again. */
    return { ran: false, reason: err.message, failed: true };
  }
}

/** Retake the decision whenever the situation changes: coming back to the app,
 *  regaining connectivity, or walking onto wifi. */
export function installAutoSync({ isBusy = () => false, onResult = () => {} } = {}) {
  const attempt = async () => {
    const res = await maybeAutoSync({ busy: isBusy() });
    if (res.ran) onResult(res);
  };
  const stopConnection = onConnectionChange(attempt);
  const onVisible = () => { if (!document.hidden) attempt(); };
  document.addEventListener('visibilitychange', onVisible);
  attempt();
  return () => {
    stopConnection();
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export async function sync({ fetchImpl = fetch } = {}) {
  /* One at a time: a visibility change and a connection change can fire
     together, and pushing the same batch twice is pointless even if harmless. */
  if (inFlight) return inFlight;
  inFlight = runSync({ fetchImpl }).finally(() => { inFlight = null; });
  return inFlight;
}

async function runSync({ fetchImpl = fetch } = {}) {
  const cfg = await syncConfig();
  if (!cfg.api || !cfg.token) throw new Error('Sync is not set up yet');

  const d = await db();
  const [cards, words, reviews, lessons] = await Promise.all([
    d.getAll('cards'), d.getAll('words'), d.getAll('reviews'), d.getAll('lessons'),
  ]);
  const push = collectPush({ cards, words, reviews, lessons }, cfg.syncedAt);

  const res = await fetchImpl(`${cfg.api}/v1/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ since: cfg.cursor, push }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(res.status === 401
      ? 'That sync token was not accepted'
      : `Sync failed (${res.status}) ${detail.slice(0, 120)}`);
  }
  const body = await res.json();

  const merged = applyPull(
    { localCards: cards, localWords: words, localReviews: reviews }, body.pull || {});

  const tx = d.transaction(['cards', 'words', 'reviews'], 'readwrite');
  for (const c of merged.cards) tx.objectStore('cards').put(c);
  for (const w of merged.words) tx.objectStore('words').put(w);
  /* Reviews already stored keep their auto key; only genuinely new ones are added. */
  const known = new Set(reviews.map((r) => r.uid));
  for (const r of merged.reviews) if (!known.has(r.uid)) tx.objectStore('reviews').add(r);
  await tx.done;

  const now = Date.now();
  await setSetting(SYNC_KEYS.cursor, body.cursor ?? cfg.cursor);
  await setSetting(SYNC_KEYS.syncedAt, now);

  return {
    at: now,
    sent: push.cards.length + push.words.length + push.reviews.length + push.lessons.length,
    received: merged.changed,
    summary: describe(push, merged.changed),
  };
}

function describe(push, changed) {
  const sent = push.reviews.length + push.cards.length + push.words.length;
  const got = changed.reviews + changed.cards + changed.words;
  if (!sent && !got) return 'Already up to date';
  const bits = [];
  if (sent) bits.push(`sent ${sent}`);
  if (got) bits.push(`received ${got}`);
  return bits.join(', ');
}
