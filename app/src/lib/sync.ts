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
import { db, getSettings, setSetting } from './db';
import { applyPull, collectPush, mergeCard, newest } from './merge';
import { connectionState, isOnline, onConnectionChange } from './network';
import { shouldAutoSync } from './syncpolicy';
import type { MergeCounts, SyncResponse } from './types';

/** What a thrown value has to say for itself.
 *
 *  A `catch` binds `unknown`, and every one of these messages is shown to the
 *  learner as it is, so something thrown that is not an `Error` is printed
 *  rather than reported as `undefined`.
 */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Which setting each piece of sync state is stored under. Kept in one object
 *  so that signing out can clear exactly what signing in wrote. */
export const SYNC_KEYS = {
  /** Where the API is. */
  api: 'syncApi',
  /** This device's bearer token. */
  token: 'syncToken',
  /** The server sequence this device has everything up to. */
  cursor: 'syncCursor',
  /** Milliseconds at the start of the last successful sync. */
  syncedAt: 'syncedAt',
  /** The account's email. */
  email: 'syncEmail',
} as const;

/** A pull the server had to cut short is followed up at once, up to this
 *  many times in one go, so a new device does not wait a quarter of an hour
 *  per page of its history. */
const MAX_ROUNDS = 20;

/** The sync in flight, so that two triggers firing together do one round trip
 *  rather than two. */
let inFlight: Promise<SyncResult> | null = null;

/** Everything this device knows about syncing, defaults resolved. */
export interface SyncConfig {
  /** Where the API is. Defaults to the origin the app is served from, which is
   *  where it lives in production. */
  api: string;
  /** This device's bearer token. Empty means not signed in. */
  token: string;
  /** The server sequence this device has everything up to. */
  cursor: number;
  /** Milliseconds at the start of the last successful sync; 0 for never. */
  syncedAt: number;
  /** The account's email, for the settings screen to show. */
  email: string;
}

/** Read the sync settings, with the same-origin default applied. */
export async function syncConfig(): Promise<SyncConfig> {
  const s = await getSettings();
  /* The API lives on the same origin as the app, so there is nothing to
     configure unless you are pointing at a different deployment. */
  const sameOrigin = typeof location !== 'undefined' ? location.origin : '';
  return {
    api: s[SYNC_KEYS.api] || sameOrigin,
    token: s[SYNC_KEYS.token] || '',
    cursor: s[SYNC_KEYS.cursor] || 0,
    syncedAt: s[SYNC_KEYS.syncedAt] || 0,
    email: s[SYNC_KEYS.email] || '',
  };
}

/** Point this device at a deployment and give it a token. A trailing slash on
 *  the address is dropped, since every path is joined with one. */
export async function configureSync({
  api,
  token,
}: {
  api?: string;
  token?: string;
}): Promise<void> {
  await setSetting(SYNC_KEYS.api, (api || '').replace(/\/$/, ''));
  await setSetting(SYNC_KEYS.token, token || '');
}

/** Forget the token and the cursor, so nothing syncs until this device signs
 *  in again. What has been learned stays. */
export async function forgetSync(): Promise<void> {
  await setSetting(SYNC_KEYS.token, '');
  await setSetting(SYNC_KEYS.cursor, 0);
  await setSetting(SYNC_KEYS.syncedAt, 0);
}

/** What one whole sync achieved. */
export interface SyncResult {
  /** Milliseconds when the last round trip started. */
  at: number;
  /** Rows sent, across every round. */
  sent: number;
  /** Rows received, by kind, across every round. */
  received: MergeCounts;
  /** The one line the settings screen shows verbatim. */
  summary: string;
}

/** What an automatic attempt did, or why it did not. */
export type AutoSyncOutcome =
  | ({ ran: true } & SyncResult)
  | { ran: false; reason: string; failed?: boolean };

/** Sync if the policy allows it right now. Returns the result, or the reason
 *  it did not run, so callers can say why nothing happened. */
export async function maybeAutoSync({
  busy = false,
  fetchImpl = fetch,
}: { busy?: boolean; fetchImpl?: typeof fetch } = {}): Promise<AutoSyncOutcome> {
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
    return { ran: false, reason: messageOf(err), failed: true };
  }
}

/** How the home screen hooks automatic sync up. */
export interface AutoSyncHooks {
  /** True while a sitting is waiting to be carried on, so sync stands aside. */
  isBusy?: () => boolean;
  /** Called after a sync that actually ran, so the screen can re-read. */
  onResult?: (result: SyncResult) => void;
  /** Called when one was attempted and failed, so it is not invisible. */
  onFailure?: (outcome: { reason: string }) => void;
}

/** Retake the decision whenever the situation changes: coming back to the app,
 *  regaining connectivity, or walking onto wifi. `onResult` hears about a sync
 *  that ran; `onFailure` about one that was tried and could not.
 *
 *  Returns the teardown function; call it when the screen goes away.
 */
export function installAutoSync({
  isBusy = () => false,
  onResult = () => {},
  onFailure = () => {},
}: AutoSyncHooks = {}): () => void {
  const attempt = async (): Promise<void> => {
    const res = await maybeAutoSync({ busy: isBusy() });
    if (res.ran) onResult(res);
    else if (res.failed) onFailure(res);
  };
  const stopConnection = onConnectionChange(() => void attempt());
  const onVisible = (): void => {
    if (!document.hidden) void attempt();
  };
  document.addEventListener('visibilitychange', onVisible);
  void attempt();
  return () => {
    stopConnection();
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** One sync: as many round trips as the server needs to hand everything over.
 *  Returns a summary the UI can show verbatim.
 *
 *  Only one runs at a time — a visibility change and a connection change can
 *  fire together, and pushing the same batch twice is pointless even if
 *  harmless — so a second caller joins the first.
 */
export async function sync({
  fetchImpl = fetch,
}: { fetchImpl?: typeof fetch } = {}): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = runSync({ fetchImpl }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Round-trip until the server says it has nothing more, then report the
 *  totals. Stops at `MAX_ROUNDS` so a server that always says "more" cannot
 *  spin for ever. */
async function runSync({
  fetchImpl = fetch,
}: { fetchImpl?: typeof fetch } = {}): Promise<SyncResult> {
  let sent = 0;
  const received: MergeCounts = { cards: 0, words: 0, reviews: 0 };
  let at = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const r = await oneRound({ fetchImpl });
    sent += r.sent;
    received.cards += r.received.cards;
    received.words += r.received.words;
    received.reviews += r.received.reviews;
    at = r.at;
    if (!r.more) break;
  }
  return { at, sent, received, summary: describe(sent, received) };
}

/** What one round trip did, and whether another is needed. */
interface RoundResult {
  /** Milliseconds when this round started, which is what is stamped. */
  at: number;
  /** Rows pushed. */
  sent: number;
  /** Rows merged in, by kind. */
  received: MergeCounts;
  /** True when the server had to cut a page short. */
  more: boolean;
}

/** Push what is new, pull what is missing, and write both down.
 *
 *  Throws with a sentence rather than a status code: every one of these
 *  reaches the settings screen as it is.
 */
async function oneRound({ fetchImpl }: { fetchImpl: typeof fetch }): Promise<RoundResult> {
  const cfg = await syncConfig();
  if (!cfg.api || !cfg.token) throw new Error('Sync is not set up yet');

  const d = await db();
  /* Stamped before the read, not after the write. Anything answered while
     this round trip is in flight has an `updatedAt` after this moment, so the
     next push carries it; stamped afterwards, it fell between two syncs and
     never left the device. */
  const startedAt = Date.now();
  const [cards, words, reviews, lessons] = await Promise.all([
    d.getAll('cards'),
    d.getAll('words'),
    d.getAll('reviews'),
    d.getAll('lessons'),
  ]);
  const push = collectPush({ cards, words, reviews, lessons }, cfg.syncedAt);
  /* `i` is this device's own auto-increment key for the review row. It means
     nothing anywhere else, and carried across it collides with the other
     device's keys when the row is added there — an AbortError on the whole
     write. Identity is the uid. The rows themselves are kept, with their keys,
     to be marked as sent once the server has them. */
  const pushedReviews = push.reviews;
  push.reviews = pushedReviews.map(({ i: _i, synced: _synced, ...r }) => r);

  const res = await fetchImpl(`${cfg.api}/v1/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ since: cfg.cursor, push }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      res.status === 401
        ? 'That sync token was not accepted'
        : `Sync failed (${res.status}) ${detail.slice(0, 120)}`,
    );
  }
  /* `Response.json()` is untyped; naming the shape on the binding is the
     narrowing, and the server is the only thing that writes it. */
  const body: SyncResponse = await res.json();

  const merged = applyPull(
    { localCards: cards, localWords: words, localReviews: reviews },
    body.pull || {},
  );

  const tx = d.transaction(['cards', 'words', 'reviews'], 'readwrite');
  try {
    /* Only what the pull changed, and each one checked against the row as it
       is now rather than as it was before the round trip: a card answered
       meanwhile is newer than anything the server sent, and stays. */
    const cardStore = tx.objectStore('cards');
    for (const c of merged.touched.cards) {
      void cardStore.put(mergeCard(c, await cardStore.get(c.id)) ?? c);
    }
    const wordStore = tx.objectStore('words');
    for (const w of merged.touched.words) {
      void wordStore.put(newest(w, await wordStore.get(w.k)));
    }
    /* Reviews already stored keep their auto key; only genuinely new ones are
       added, and without whatever key the other device gave them. The ones
       just pushed are marked as sent, so the next push does not carry the
       whole log again. */
    const reviewStore = tx.objectStore('reviews');
    const known = new Set(reviews.map((r) => r.uid));
    for (const r of merged.reviews) {
      if (known.has(r.uid)) continue;
      const { i: _i, ...row } = r;
      void reviewStore.add(row);
    }
    for (const r of pushedReviews) void reviewStore.put({ ...r, synced: true });
    await tx.done;
  } catch (err) {
    /* A DOMException says "AbortError" and little else; say what was being
       done, so the next report of it can be acted on. */
    const name = err instanceof Error ? err.name : 'Error';
    const detail = messageOf(err);
    throw new Error(`Could not save what came back: ${name}${detail ? ` — ${detail}` : ''}`, {
      cause: err,
    });
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

/** The one line the settings screen shows: what went, what came, or that
 *  there was nothing to do. */
function describe(sent: number, changed: MergeCounts): string {
  const got = changed.reviews + changed.cards + changed.words;
  if (!sent && !got) return 'Already up to date';
  const bits: string[] = [];
  if (sent) bits.push(`sent ${sent}`);
  if (got) bits.push(`received ${got}`);
  return bits.join(', ');
}
