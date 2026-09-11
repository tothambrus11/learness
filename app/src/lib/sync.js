/** Sync.
 *
 *  The local database stays the working copy, so a session in a basement gym
 *  behaves exactly as it does at home, and nothing is ever half-uploaded
 *  mid-review. Sync runs on its own from the home screen when the policy
 *  allows and a sitting is not waiting, or whenever you press the button.
 *
 *  Push carries only what changed since the last sync; pull asks for everything
 *  past a server cursor, so neither side depends on the two clocks agreeing.
 */
import { db, getSettings, setSetting } from './db.js';
import { applyPull, collectPush, mergeCard, newest } from './merge.js';
import { connectionState, isOnline, onConnectionChange } from './network.js';
import { shouldAutoSync } from './syncpolicy.js';

export const SYNC_KEYS = { api: 'syncApi', token: 'syncToken', cursor: 'syncCursor',
  syncedAt: 'syncedAt', email: 'syncEmail' };

/** A pull the server had to cut short is followed up at once, up to this
 *  many times in one go, so a new device does not wait a quarter of an hour
 *  per page of its history. */
const MAX_ROUNDS = 20;

let inFlight = null;

export async function syncConfig() {
  const s = await getSettings();
  /* The API lives on the same origin as the app, so there is nothing to
     configure unless you are pointing at a different deployment. */
  const sameOrigin = typeof location !== 'undefined' ? location.origin : '';
  return { api: s[SYNC_KEYS.api] || sameOrigin, token: s[SYNC_KEYS.token] || '',
    cursor: s[SYNC_KEYS.cursor] || 0, syncedAt: s[SYNC_KEYS.syncedAt] || 0,
    email: s[SYNC_KEYS.email] || '' };
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
    /* An automatic sync failing is not something to stop the learner for,
       and the next trigger will try again — but it is reported, so a sync
       that fails every time is not invisible. */
    return { ran: false, reason: err.message, failed: true };
  }
}

/** Retake the decision whenever the situation changes: coming back to the app,
 *  regaining connectivity, or walking onto wifi. `onResult` hears about a sync
 *  that ran; `onFailure` about one that was tried and could not. */
export function installAutoSync({ isBusy = () => false, onResult = () => {},
  onFailure = () => {} } = {}) {
  const attempt = async () => {
    const res = await maybeAutoSync({ busy: isBusy() });
    if (res.ran) onResult(res);
    else if (res.failed) onFailure(res);
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

/** One sync: as many round trips as the server needs to hand everything over.
 *  Returns a summary the UI can show verbatim. */
export async function sync({ fetchImpl = fetch } = {}) {
  /* One at a time: a visibility change and a connection change can fire
     together, and pushing the same batch twice is pointless even if harmless. */
  if (inFlight) return inFlight;
  inFlight = runSync({ fetchImpl }).finally(() => { inFlight = null; });
  return inFlight;
}

async function runSync({ fetchImpl = fetch } = {}) {
  let sent = 0;
  const received = { cards: 0, words: 0, reviews: 0 };
  let at = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const r = await oneRound({ fetchImpl });
    sent += r.sent;
    for (const k of Object.keys(received)) received[k] += r.received[k] ?? 0;
    at = r.at;
    if (!r.more) break;
  }
  return { at, sent, received, summary: describe(sent, received) };
}

async function oneRound({ fetchImpl }) {
  const cfg = await syncConfig();
  if (!cfg.api || !cfg.token) throw new Error('Sync is not set up yet');

  const d = await db();
  /* Stamped before the read, not after the write. Anything answered while
     this round trip is in flight has an `updatedAt` after this moment, so the
     next push carries it; stamped afterwards, it fell between two syncs and
     never left the device. */
  const startedAt = Date.now();
  const [cards, words, reviews, lessons] = await Promise.all([
    d.getAll('cards'), d.getAll('words'), d.getAll('reviews'), d.getAll('lessons'),
  ]);
  const push = collectPush({ cards, words, reviews, lessons }, cfg.syncedAt);
  /* `i` is this device's own auto-increment key for the review row. It means
     nothing anywhere else, and carried across it collides with the other
     device's keys when the row is added there — an AbortError on the whole
     write. Identity is the uid. The rows themselves are kept, with their keys,
     to be marked as sent once the server has them. */
  const pushedReviews = push.reviews;
  push.reviews = pushedReviews.map(({ i, synced, ...r }) => r);

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
  try {
    /* Only what the pull changed, and each one checked against the row as it
       is now rather than as it was before the round trip: a card answered
       meanwhile is newer than anything the server sent, and stays. */
    const cardStore = tx.objectStore('cards');
    for (const c of merged.touched.cards) {
      cardStore.put(mergeCard(c, await cardStore.get(c.id)));
    }
    const wordStore = tx.objectStore('words');
    for (const w of merged.touched.words) {
      wordStore.put(newest(w, await wordStore.get(w.k)));
    }
    /* Reviews already stored keep their auto key; only genuinely new ones are
       added, and without whatever key the other device gave them. The ones
       just pushed are marked as sent, so the next push does not carry the
       whole log again. */
    const reviewStore = tx.objectStore('reviews');
    const known = new Set(reviews.map((r) => r.uid));
    for (const r of merged.reviews) {
      if (known.has(r.uid)) continue;
      const { i, ...row } = r;
      reviewStore.add(row);
    }
    for (const r of pushedReviews) reviewStore.put({ ...r, synced: true });
    await tx.done;
  } catch (err) {
    /* A DOMException says "AbortError" and little else; say what was being
       done, so the next report of it can be acted on. */
    throw new Error(`Could not save what came back: ${err.name}${err.message ? ` — ${err.message}` : ''}`);
  }

  await setSetting(SYNC_KEYS.cursor, body.cursor ?? cfg.cursor);
  await setSetting(SYNC_KEYS.syncedAt, startedAt);

  return {
    at: startedAt,
    sent: push.cards.length + push.words.length + push.reviews.length + push.lessons.length,
    received: merged.changed,
    more: !!body.more,
  };
}

function describe(sent, changed) {
  const got = changed.reviews + changed.cards + changed.words;
  if (!sent && !got) return 'Already up to date';
  const bits = [];
  if (sent) bits.push(`sent ${sent}`);
  if (got) bits.push(`received ${got}`);
  return bits.join(', ');
}
