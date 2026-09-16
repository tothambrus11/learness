/** Sync.
 *
 *  The local database stays the working copy, so a session in a basement gym
 *  behaves exactly as it does at home, and nothing is ever half-uploaded
 *  mid-review. It runs on its own when the app comes back into view or the
 *  connection changes, at most every so many minutes; before a sitting is
 *  dealt, once, whatever the minutes say, so a word added on the other phone
 *  a moment ago is in this sitting; and when you press the button.
 *
 *  Push carries only what changed since the last sync; pull asks for everything
 *  past a server cursor, so neither side depends on the two clocks agreeing.
 */
import { db, getSettings, setSetting } from './db.js';
import { trustTheme } from './theme.js';
import { report } from './diagnostics.js';
import { applyPull, collectPush, mergeCard, mergeTheme, mergeWord } from './merge.js';
import type { Pull } from './merge.js';
import type { Review } from './model.js';
import { connectionState, isOnline, onConnectionChange } from './network.js';
import { shouldAutoSync } from './syncpolicy.js';
import { MINUTE_MS, nowMs } from './units.js';
import type { Millis } from './units.js';

export const SYNC_KEYS = {
  api: 'syncApi', token: 'syncToken', cursor: 'syncCursor',
  syncedAt: 'syncedAt', email: 'syncEmail',
} as const;

/** Where this device syncs, and how far it has got. */
export interface SyncConfig {
  api: string;
  token: string;
  /** The server's own cursor, so neither side depends on the other's clock. */
  cursor: number;
  syncedAt: Millis;
  email: string;
}

/** What one round trip did. */
export interface SyncResult {
  at: Millis;
  sent: number;
  received: { cards: number; words: number; reviews: number; themes: number };
  summary: string;
}

/** Why an automatic sync did or did not run. */
export type AutoSyncOutcome =
  | ({ ran: true } & SyncResult)
  | { ran: false; reason: string; failed?: boolean };

let inFlight: Promise<SyncResult> | null = null;
const listeners = new Set<(result: SyncResult) => void>();

/** Be told whenever a sync finishes, whoever ran it: a screen that shows
 *  today's numbers re-reads them. Returns the unsubscribe. */
export function onSync(handler: (result: SyncResult) => void): () => void {
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}

export async function syncConfig(): Promise<SyncConfig> {
  const s = await getSettings();
  /* The API lives on the same origin as the app, so there is nothing to
     configure unless you are pointing at a different deployment. */
  const sameOrigin = typeof location !== 'undefined' ? location.origin : '';
  return { api: s[SYNC_KEYS.api] || sameOrigin, token: s[SYNC_KEYS.token] || '',
    cursor: s[SYNC_KEYS.cursor] || 0, syncedAt: s[SYNC_KEYS.syncedAt] ?? (0 as Millis),
    email: s[SYNC_KEYS.email] || '' };
}

export async function configureSync({ api, token }: { api?: string; token?: string }):
  Promise<void> {
  await setSetting(SYNC_KEYS.api, (api || '').replace(/\/$/, ''));
  await setSetting(SYNC_KEYS.token, token || '');
}

export async function forgetSync(): Promise<void> {
  await setSetting(SYNC_KEYS.token, '');
  await setSetting(SYNC_KEYS.cursor, 0);
  await setSetting(SYNC_KEYS.syncedAt, 0 as Millis);
}

/** One round trip. Returns a summary the UI can show verbatim. */
/** Sync if the policy allows it right now. Returns the result, or the reason
 *  it did not run, so callers can say why nothing happened. */
export async function maybeAutoSync({ busy = false, fetchImpl = fetch, minIntervalMs }: {
  busy?: boolean;
  fetchImpl?: typeof fetch;
  /** How recent a sync counts as recent enough; the setting unless given. */
  minIntervalMs?: number;
} = {}): Promise<AutoSyncOutcome> {
  const s = await getSettings();
  const cfg = await syncConfig();
  const verdict = shouldAutoSync({
    policy: s.autoSync,
    connection: connectionState(),
    online: isOnline(),
    configured: !!(cfg.api && cfg.token),
    lastSyncAt: cfg.syncedAt,
    minIntervalMs: minIntervalMs ?? (s.autoSyncMinutes ?? 15) * MINUTE_MS,
    busy,
  });
  if (!verdict.sync) return { ran: false, reason: verdict.reason };
  try {
    const result = await sync({ fetchImpl });
    return { ran: true, ...result };
  } catch (err) {
    /* An automatic sync failing is not an error the learner has to deal with;
       the next trigger will try again. */
    return { ran: false, reason: (err as Error).message, failed: true };
  }
}

/** Sync before a sitting is dealt: the policy without its interval, so a word
 *  added on the other phone a minute ago is in this sitting, raced against a
 *  short timeout so a slow connection costs at most that. A sync that loses
 *  the race carries on and writes when it lands; the next open has it.
 *  Failure is not this caller's problem — the sitting is dealt from what is
 *  here — and `maybeAutoSync` has already written it down. */
export async function pullOnOpen({ timeoutMs = 2000, fetchImpl = fetch }: {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
} = {}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  try {
    await Promise.race([maybeAutoSync({ fetchImpl, minIntervalMs: 0 }), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Retake the decision whenever the situation changes: coming back to the app,
 *  regaining connectivity, or walking onto wifi. */
export function installAutoSync({ isBusy = (): boolean => false, onResult = (): void => {} }: {
  isBusy?: () => boolean;
  onResult?: (result: AutoSyncOutcome & { ran: true }) => void;
} = {}): () => void {
  const attempt = async (): Promise<void> => {
    const res = await maybeAutoSync({ busy: isBusy() });
    if (res.ran) onResult(res);
  };
  const stopConnection = onConnectionChange(() => { void attempt(); });
  const onVisible = (): void => { if (!document.hidden) void attempt(); };
  document.addEventListener('visibilitychange', onVisible);
  void attempt();
  return () => {
    stopConnection();
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export async function sync({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}):
  Promise<SyncResult> {
  /* One at a time: a visibility change and a connection change can fire
     together, and pushing the same batch twice is pointless even if harmless. */
  if (inFlight) return inFlight;
  inFlight = runSync({ fetchImpl })
    .then((result) => {
      for (const handler of listeners) handler(result);
      return result;
    })
    .catch((err: unknown) => { report('sync', (err as Error).message); throw err; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

async function runSync({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}):
  Promise<SyncResult> {
  const cfg = await syncConfig();
  if (!cfg.api || !cfg.token) throw new Error('Sync is not set up yet');

  const d = await db();
  /* The moment the store was read is the moment the server has seen up to,
     not the moment its answer was written: whatever is edited in between is
     stamped later than this and goes out on the next sync. */
  const startedAt = nowMs();
  const [cards, words, reviews, lessons, themes] = await Promise.all([
    d.getAll('cards'), d.getAll('words'), d.getAll('reviews'), d.getAll('lessons'),
    d.getAll('themes'),
  ]);
  const push = collectPush({ cards, words, reviews, lessons, themes }, cfg.syncedAt);
  /* `i` is this device's own auto-increment key for the review row. It means
     nothing anywhere else, and carried across it collides with the other
     device's keys when the row is added there — an AbortError on the whole
     write. Identity is the uid. `synced` is likewise a note this device keeps
     to itself, written below once the server has the rows. */
  const sending = push.reviews;
  push.reviews = sending.map(({ i: _i, synced: _synced, ...r }) => r as Review);

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
  const body = (await res.json()) as { pull?: Pull; cursor?: number };

  const pulled = body.pull ?? {};
  /* A theme is data off the wire: trusted once, here, and a record that is
     not a theme is left out rather than stored. */
  const merged = applyPull(
    { localCards: cards, localWords: words, localReviews: reviews, localThemes: themes },
    { ...pulled, themes: (pulled.themes ?? []).map(trustTheme).filter((t) => t !== null) });

  const tx = d.transaction(['cards', 'words', 'reviews', 'themes'], 'readwrite');
  try {
    /* Each record is laid over what is in the store *now*, not over the copy
       read before the request went out: a colour changed, or a word
       corrected, while the server was answering used to be written back
       over by that stale copy — and then never pushed, since the sync's own
       stamp was later than the edit's. The merge rules decide, as they do
       for the pull, and a row they leave as it stands is not written. */
    const cardStore = tx.objectStore('cards');
    for (const c of merged.cards) {
      const now = await cardStore.get(c.id);
      const keep = mergeCard(now, c);
      if (keep && keep !== now) void cardStore.put(keep);
    }
    const wordStore = tx.objectStore('words');
    for (const w of merged.words) {
      const now = await wordStore.get(w.k);
      const keep = mergeWord(now, w);
      if (keep && keep !== now) void wordStore.put(keep);
    }
    const themeStore = tx.objectStore('themes');
    for (const t of merged.themes) {
      const now = await themeStore.get(t.id);
      const keep = mergeTheme(now, t);
      if (keep && keep !== now) void themeStore.put(keep);
    }
    /* Reviews already stored keep their auto key; only genuinely new ones are
       added, and without whatever key the other device gave them. */
    const known = new Set(reviews.map((r) => r.uid));
    for (const r of merged.reviews) {
      if (known.has(r.uid)) continue;
      const { i: _i, ...row } = r;
      void tx.objectStore('reviews').add(row);
    }
    /* Mark what the server has now seen. Without this every sync pushed the
       whole log again — a year of study is tens of thousands of rows, sent
       from a phone every fifteen minutes, for ever. */
    for (const r of sending) {
      if (r.i !== undefined) void tx.objectStore('reviews').put({ ...r, synced: true });
    }
    await tx.done;
  } catch (err) {
    /* A DOMException says "AbortError" and little else; say what was being
       done, so the next report of it can be acted on. */
    const e = err as Error;
    throw new Error(
      `Could not save what came back: ${e.name}${e.message ? ` — ${e.message}` : ''}`,
      { cause: err });
  }

  await setSetting(SYNC_KEYS.cursor, body.cursor ?? cfg.cursor);
  await setSetting(SYNC_KEYS.syncedAt, startedAt);

  return {
    at: startedAt,
    sent: push.cards.length + push.words.length + push.reviews.length + push.lessons.length
      + push.themes.length,
    received: merged.changed,
    summary: describe(push, merged.changed),
  };
}

function describe(push: ReturnType<typeof collectPush>,
  changed: { cards: number; words: number; reviews: number; themes: number }): string {
  const sent = push.reviews.length + push.cards.length + push.words.length + push.themes.length;
  const got = changed.reviews + changed.cards + changed.words + changed.themes;
  if (!sent && !got) return 'Already up to date';
  const bits = [];
  if (sent) bits.push(`sent ${sent}`);
  if (got) bits.push(`received ${got}`);
  return bits.join(', ');
}
