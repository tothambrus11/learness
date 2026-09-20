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
import { KIND_NAMES, RECORD_KINDS, sumCounts, zeroCounts } from './kinds.js';
import type { Counts } from './kinds.js';
import { applyPull, collectPush, identityOf, RECORD_MERGE, trustBit, trustLesson } from './merge.js';
import type { Merged, Pull, Push } from './merge.js';
import type { Review } from './model.js';
import { connectionState, isOnline, onConnectionChange } from './network.js';
import { applyUpdate as stepIn, updateNow } from './pwa.js';
import { SCHEMA } from './schema.js';
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
  received: Counts;
  summary: string;
  /** Set when nothing was written because the two sides speak different
   *  schemas (schema.ts): `'app'` when this build is behind the Worker and
   *  needs updating, `'server'` when the Worker is behind this build and the
   *  push has to wait. Absent on a sync that went through. */
  stale?: 'app' | 'server';
}

/** What a sync says when it stood down, in the words the screen shows. */
export const STALE_SUMMARY: Record<NonNullable<SyncResult['stale']>, string> = {
  app: 'A newer version of the app is needed before it can sync — reload to update',
  server: 'The server is being updated; nothing was synced, and it will be tried again',
};
/** What a sync says when it found a new build instead: the page is about to
 *  reload onto it, and the sync is the new build's to run. */
export const UPDATING_SUMMARY = 'A new version is being installed; it will sync once it has loaded';

/** How a sync finds and takes a new build: the two halves of pwa.ts, given
 *  so a test can hand in a build that is waiting and see it taken before
 *  the first request goes out, and never while a card is face up. */
export interface UpdateHooks {
  /** Asks for a new build and hands back the one waiting, or null. */
  checkUpdate?: () => Promise<ServiceWorker | null>;
  /** Steps the waiting build in; the page reloads onto it. */
  applyUpdate?: (worker: ServiceWorker) => void;
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
export async function maybeAutoSync({ busy = false, fetchImpl = fetch, minIntervalMs, ...hooks }: {
  busy?: boolean;
  fetchImpl?: typeof fetch;
  /** How recent a sync counts as recent enough; the setting unless given. */
  minIntervalMs?: number;
} & UpdateHooks = {}): Promise<AutoSyncOutcome> {
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
    const result = await sync({ fetchImpl, ...hooks });
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
export async function pullOnOpen({ timeoutMs = 2000, fetchImpl = fetch, ...hooks }: {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
} & UpdateHooks = {}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  try {
    await Promise.race([maybeAutoSync({ fetchImpl, minIntervalMs: 0, ...hooks }), late]);
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

export async function sync({ fetchImpl = fetch, checkUpdate = updateNow, applyUpdate = stepIn }:
  { fetchImpl?: typeof fetch } & UpdateHooks = {}): Promise<SyncResult> {
  /* One at a time: a visibility change and a connection change can fire
     together, and pushing the same batch twice is pointless even if harmless. */
  if (inFlight) return inFlight;
  inFlight = updateThenSync({ fetchImpl, checkUpdate, applyUpdate })
    .then((result) => {
      for (const handler of listeners) handler(result);
      return result;
    })
    .catch((err: unknown) => { report('sync', (err as Error).message); throw err; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Update before you sync. A build that is waiting is taken before the
 *  first request goes out, so the sync that reads what the other device
 *  wrote runs on the code that wrote it; and a sync that finds the Worker
 *  ahead of this build anyway — the check missed, the deploy landed in
 *  between — looks once more and takes what it finds. Never while a card is
 *  face up: the callers already do not sync then (syncpolicy.ts), so this
 *  runs only where a reload costs nothing. */
async function updateThenSync({ fetchImpl, checkUpdate, applyUpdate }: {
  fetchImpl: typeof fetch;
  checkUpdate: NonNullable<UpdateHooks['checkUpdate']>;
  applyUpdate: NonNullable<UpdateHooks['applyUpdate']>;
}): Promise<SyncResult> {
  const updating = (): SyncResult => ({
    at: nowMs(), sent: 0, received: zeroCounts(), summary: UPDATING_SUMMARY, stale: 'app',
  });
  const ready = await checkUpdate();
  if (ready) {
    applyUpdate(ready);
    return updating();
  }
  const result = await runSync({ fetchImpl });
  if (result.stale === 'app') {
    const found = await checkUpdate();
    if (found) {
      applyUpdate(found);
      return updating();
    }
  }
  return result;
}

/** One reply from the server: a page of what is new, and where the next page
 *  starts. `more` is set when some table held more rows than one reply
 *  carries; the cursor is then the place to carry on from, not the counter,
 *  and the row at it is sent again on the next page. `schema` is the number
 *  the Worker was built with; a reply without one is from a Worker older
 *  than the number, which is to say behind. */
interface SyncReply { pull?: Pull; cursor?: number; more?: boolean; schema?: number }

/** The Worker refused the push because this build is ahead of it: nothing of
 *  the push was stored, and the reply says what the Worker speaks. */
class ServerBehind extends Error {
  constructor(readonly schema: number) { super('The server is behind this build'); }
}

/** What goes up with the pages after the first: nothing, the push having
 *  gone with the first. */
const NOTHING: Push = Object.fromEntries(KIND_NAMES.map((k) => [k, []])) as unknown as Push;

async function runSync({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}):
  Promise<SyncResult> {
  const cfg = await syncConfig();
  if (!cfg.api || !cfg.token) throw new Error('Sync is not set up yet');

  const d = await db();
  /* The moment the store was read is the moment the server has seen up to,
     not the moment its answer was written: whatever is edited in between is
     stamped later than this and goes out on the next sync. */
  const startedAt = nowMs();
  const [cards, words, reviews, lessons, themes, bits] = await Promise.all([
    d.getAll('cards'), d.getAll('words'), d.getAll('reviews'), d.getAll('lessons'),
    d.getAll('themes'), d.getAll('bits'),
  ]);
  const push = collectPush({ cards, words, reviews, lessons, themes, bits }, cfg.syncedAt);
  /* `i` is this device's own auto-increment key for the review row. It means
     nothing anywhere else, and carried across it collides with the other
     device's keys when the row is added there — an AbortError on the whole
     write. Identity is the uid. `synced` is likewise a note this device keeps
     to itself, written below once the server has the rows. */
  const sending = push.reviews;
  push.reviews = sending.map(({ i: _i, synced: _synced, ...r }) => r as Review);

  const ask = async (since: number, body: Push): Promise<SyncReply> => {
    const res = await fetchImpl(`${cfg.api}/v1/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ since, schema: SCHEMA, push: body }),
    });
    if (res.status === 409) {
      const refused = (await res.json().catch(() => ({}))) as { schema?: number };
      if (typeof refused.schema === 'number') throw new ServerBehind(refused.schema);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(res.status === 401
        ? 'That sync token was not accepted'
        : `Sync failed (${res.status}) ${detail.slice(0, 120)}`);
    }
    return (await res.json()) as SyncReply;
  };

  /* Nothing is written on a sync that stood down: no record, no cursor, no
     "seen up to", and the reviews are not marked as sent — so what was
     pushed goes again next time, which is what makes pushing before looking
     safe. Written down, because a device that cannot sync is a device whose
     learner will ask why. */
  const stoodDown = (stale: NonNullable<SyncResult['stale']>, theirs: number): SyncResult => {
    report('sync', `${STALE_SUMMARY[stale]} (server schema ${theirs}, this build ${SCHEMA})`);
    return {
      at: startedAt, sent: 0, received: zeroCounts(), summary: STALE_SUMMARY[stale], stale,
    };
  };

  /* A long history comes down in pages, and the pages are one sync as far
     as the learner can tell: the request goes out again from where the last
     page ended, with nothing to push, until the server says there is no
     more, and the notice at the end carries the whole of it. The reply's
     cursor once meant "up to date" whatever the page held, and a fresh
     device on a long log kept the first five thousand reviews and never
     asked for the rest. Each page is laid over what the pages before it
     left, so the row sent at the join of two pages counts once. */
  let local = {
    localCards: cards, localWords: words, localReviews: reviews, localLessons: lessons,
    localThemes: themes, localBits: bits,
  };
  const received = zeroCounts();
  let since = cfg.cursor;
  let reply: SyncReply;
  try {
    reply = await ask(since, push);
  } catch (err) {
    if (err instanceof ServerBehind) return stoodDown('server', err.schema);
    throw err;
  }
  /* Look before writing. Above this build: a deploy in flight or a cached
     worker script, and this build must not write a shape it cannot read.
     Below, or a Worker from before the number: the push may have gone, but
     a kind the Worker did not know was dropped, so nothing is marked sent
     and it all goes again once the Worker has caught up. */
  const theirs = reply.schema ?? 0;
  if (theirs > SCHEMA) return stoodDown('app', theirs);
  if (theirs < SCHEMA) return stoodDown('server', theirs);
  for (let page = 0; ; page += 1) {
    const pulled = reply.pull ?? {};
    /* A theme or a lesson is data off the wire: trusted once, here, and a
       record that is not one is left out rather than stored. */
    const merged = applyPull(local, {
      ...pulled,
      lessons: (pulled.lessons ?? []).map(trustLesson).filter((l) => l !== null),
      themes: (pulled.themes ?? []).map(trustTheme).filter((t) => t !== null),
      bits: (pulled.bits ?? []).map(trustBit).filter((b) => b !== null),
    });
    await writeBack(d, merged, local.localReviews, page === 0 ? sending : []);
    for (const kind of KIND_NAMES) received[kind] += merged.changed[kind];
    local = {
      localCards: merged.cards, localWords: merged.words, localReviews: merged.reviews,
      localLessons: merged.lessons, localThemes: merged.themes, localBits: merged.bits,
    };
    const cursor = reply.cursor ?? since;
    /* Saved page by page: a sync cut off on its third page starts again at
       the third, not at the first. */
    await setSetting(SYNC_KEYS.cursor, cursor);
    if (!reply.more) break;
    if (cursor <= since) {
      throw new Error('The server said there was more to pull but not where to carry on from');
    }
    since = cursor;
    reply = await ask(since, NOTHING);
  }
  await setSetting(SYNC_KEYS.syncedAt, startedAt);

  return { at: startedAt, sent: pushed(push), received, summary: describe(push, received) };
}

/** One page, written into the store. `stored` is the review log as it stood
 *  before this page, so a review already there is not added a second time;
 *  `sending` is what this sync pushed, marked as seen by the server once the
 *  page that answered the push is in. */
async function writeBack(
  d: Awaited<ReturnType<typeof db>>, merged: Merged, stored: readonly Review[],
  sending: readonly Review[],
): Promise<void> {
  const tx = d.transaction([...KIND_NAMES], 'readwrite');
  try {
    /* Each record is laid over what is in the store *now*, not over the copy
       read before the request went out: a colour changed, or a word
       corrected, while the server was answering used to be written back
       over by that stale copy — and then never pushed, since the sync's own
       stamp was later than the edit's. The merge rules decide, as they do
       for the pull, and a row they leave as it stands is not written. */
    for (const kind of RECORD_KINDS) {
      /* One store per record kind, keyed as the kind says; the merge rule
         is the kind's, from the one table (merge.ts). The store's typing is
         per name, and a loop over names is where it stops being useful. */
      const store = tx.objectStore(kind) as unknown as {
        get(id: string): Promise<object | undefined>; put(value: object): unknown;
      };
      const merge = RECORD_MERGE[kind] as (a: unknown, b: unknown) => object | undefined;
      for (const r of merged[kind]) {
        const now = await store.get(identityOf(kind, r));
        const keep = merge(now, r);
        if (keep && keep !== now) void store.put(keep);
      }
    }
    /* Reviews already stored keep their auto key; only genuinely new ones are
       added, and without whatever key the other device gave them. */
    const known = new Set(stored.map((r) => r.uid));
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
}

/** How many records a push carries, over every kind. */
const pushed = (push: Push): number => KIND_NAMES.reduce((n, k) => n + push[k].length, 0);

function describe(push: Push, changed: Counts): string {
  const sent = pushed(push);
  const got = sumCounts(changed);
  if (!sent && !got) return 'Already up to date';
  const bits = [];
  if (sent) bits.push(`sent ${sent}`);
  if (got) bits.push(`received ${got}`);
  return bits.join(', ');
}
