/** Warm the audio cache, in the order the clips will be wanted.
 *
 *  The service worker keeps every clip it serves, so fetching a session's
 *  clips up front means the first card never waits on the network and a walk
 *  that loses signal halfway keeps its voice. Earlier cards first, a few at a
 *  time, so the queue is useful within a second and never floods a phone. A
 *  session is under a megabyte, small enough not to gate on metering; a whole
 *  level is a few megabytes, and the caller asks first.
 */
import { base } from '$app/paths';
import { all, load, report } from './diagnostics.js';
import type { Note } from './diagnostics.js';
import { isOnline } from './network.js';

/** Where a warm-up writes down what it could not fetch. */
const WHERE = 'media';

/** Of the clips a warm-up could not fetch, the ones no note has named yet.
 *
 *  A recording the server does not have is missing at every sitting, and the
 *  warm-up used to say so at every sitting: the same two files, six times a
 *  day, until the notes held nothing else (#61). The first report is the one
 *  that matters and it stays; the notes themselves are the memory of it, so a
 *  file is reported again only once its note has been cleared or has aged
 *  out — which is to say, once nobody could still read that it was missing. */
export function unreported(files: readonly string[], notes: readonly Note[]): string[] {
  const named = notes.filter((n) => n.where === WHERE).map((n) => n.what);
  return files.filter((file) => !named.some((what) => what.includes(file)));
}

/** A response that is actually a recording.
 *
 *  A 200 is not enough. A server that answers a path it does not have with the
 *  app's own page — which this one did for every path, until it was taught the
 *  difference — returns HTML with a cheerful status, and a warm-up that counts
 *  that as fetched leaves the cache full of pages that will not decode. */
const audible = (res: Response): boolean =>
  res.ok && !(res.headers.get('content-type') ?? '').startsWith('text/html');

/** How a warm-up went: what was fetched, what could not be, out of how many. */
export interface PrefetchResult {
  done: number;
  failed: number;
  total: number;
  missing?: string[];
}

/** A warm-up in progress: stoppable, and awaitable. */
export interface Prefetch {
  stop: () => void;
  done: Promise<PrefetchResult>;
}

export function prefetchMedia(
  files: readonly (string | null | undefined)[],
  { concurrency = 2, onProgress = (): void => {} }: {
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Prefetch {
  const queue: string[] = [...new Set(files.filter((f): f is string => !!f))];
  const total = queue.length;
  let stopped = false;
  let done = 0;
  if (!total || !isOnline() || typeof fetch === 'undefined') {
    return { stop() {}, done: Promise.resolve({ done: 0, failed: 0, total }) };
  }

  const missed: string[] = [];
  const drain = async (): Promise<void> => {
    while (!stopped && queue.length) {
      const file = queue.shift()!;
      try {
        const res = await fetch(`${base}/media/${file}`);
        await res.arrayBuffer();          /* read it through, so it is stored */
        if (!audible(res)) missed.push(file);
      } catch { missed.push(file); }      /* signal gone; the play will say so */
      done += 1;
      onProgress(done, total);
    }
  };
  const pass = () => Promise.all(Array.from({ length: concurrency }, drain));
  const finished = (async () => {
    await pass();
    /* A dropped connection or a server mid-restart fails a few at random;
       one more go, in order, before calling any of them missing. */
    if (missed.length && !stopped) {
      queue.push(...missed.splice(0));
      done -= queue.length;
      await pass();
    }
    if (missed.length && !stopped) {
      /* What an earlier load wrote down is read in first: a warm-up runs as
         the sitting opens, before the notes have been loaded, and reported
         into an empty list that then filled up behind it. */
      await load();
      const fresh = unreported(missed, all());
      if (fresh.length) {
        report(WHERE, `${fresh.length} recording${fresh.length === 1 ? '' : 's'} could not be `
          + `fetched: ${fresh.slice(0, 5).join(', ')}${fresh.length > 5 ? ', …' : ''}`);
      }
    }
    return { done, failed: missed.length, total, missing: [...missed] };
  })();
  return { stop() { stopped = true; }, done: finished };
}

/** Is every one of these clips already in the offline cache? */
export async function cachedCount(files: readonly (string | null | undefined)[]): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  const media = await caches.open('media');
  /* One read of the cache's keys, not one lookup per clip: a level is a few
     hundred files and every level is checked when the list opens. */
  const have = new Set((await media.keys()).map((r) => new URL(r.url).pathname));
  let n = 0;
  for (const file of files.filter((f): f is string => !!f)) {
    if (have.has(`${base}/media/${file}`)) n += 1;
  }
  return n;
}
