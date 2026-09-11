/** Warm the audio cache, in the order the clips will be wanted.
 *
 *  The service worker keeps every clip it serves, so fetching a session's
 *  clips up front means the first card never waits on the network and a
 *  sitting that loses signal halfway keeps its voice. Earlier cards first, a few at a
 *  time, so the queue is useful within a second and never floods a phone. A
 *  session is under a megabyte, small enough not to gate on metering; a whole
 *  level is a few megabytes, and the caller asks first.
 */
import { base } from '$app/paths';

import { isOnline } from './network';

/** How hard to pull, and who to tell about it. */
export interface PrefetchOptions {
  /** How many clips are in flight at once. Two keeps a phone responsive; a
   *  screen that is explicitly downloading a level asks for more. */
  concurrency?: number;
  /** Called after every clip, finished or failed, with how many of how many
   *  are done. Never called after `stop()`. */
  onProgress?: (done: number, total: number) => void;
}

/** How a warming ended. */
export interface PrefetchResult {
  /** Clips attempted, failures included. */
  done: number;
  /** Clips that could not be fetched, after the second go. */
  failed: number;
  /** Clips asked for, duplicates and blanks removed. */
  total: number;
  /** Which ones failed. Absent where there was nothing to fetch. */
  missing?: string[];
}

/** A warming in progress. */
export interface PrefetchJob {
  /** Stop after the clips in flight. What is already cached stays. */
  stop(): void;
  /** Resolves when the queue is empty or stopped; never rejects, because a
   *  clip that will not come is a fact to report, not an error to handle. */
  done: Promise<PrefetchResult>;
}

/** Fetch these clips, in order, so the service worker keeps them. Returns at
 *  once with the job; nothing is awaited by the caller unless it wants the
 *  tally. Blank entries and duplicates are dropped, and a device that is
 *  offline or has no fetch does nothing at all. */
export function prefetchMedia(
  files: (string | null | undefined)[],
  { concurrency = 2, onProgress = () => {} }: PrefetchOptions = {},
): PrefetchJob {
  const queue = [...new Set(files.filter((f): f is string => Boolean(f)))];
  const total = queue.length;
  let stopped = false;
  let done = 0;
  if (!total || !isOnline() || typeof fetch === 'undefined') {
    return { stop() {}, done: Promise.resolve({ done: 0, failed: 0, total }) };
  }

  const missed: string[] = [];
  /** One worker through the queue, until it is empty or the job is stopped. */
  const drain = async (): Promise<void> => {
    while (!stopped && queue.length) {
      const file = queue.shift();
      /* The length was just checked, so there is always one; this is for the
         type rather than for a case that happens. */
      if (file === undefined) break;
      try {
        const res = await fetch(`${base}/media/${file}`);
        await res.arrayBuffer(); /* read it through, so it is stored */
        if (!res.ok) missed.push(file);
      } catch {
        missed.push(file);
      } /* signal gone; the play will say so */
      done += 1;
      onProgress(done, total);
    }
  };
  /** One sweep of the queue with every worker at once. */
  const pass = (): Promise<void[]> => Promise.all(Array.from({ length: concurrency }, drain));
  /** The whole job: a sweep, then a second go at whatever fell over. */
  const finished = (async (): Promise<PrefetchResult> => {
    await pass();
    /* A dropped connection or a server mid-restart fails a few at random;
       one more go, in order, before calling any of them missing. */
    if (missed.length && !stopped) {
      queue.push(...missed.splice(0));
      done -= queue.length;
      await pass();
    }
    return { done, failed: missed.length, total, missing: [...missed] };
  })();
  return {
    stop() {
      stopped = true;
    },
    done: finished,
  };
}

/** Is every one of these clips already in the offline cache? */
export async function cachedCount(files: (string | null | undefined)[]): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  const media = await caches.open('media');
  /* One read of the cache's keys, not one lookup per clip: a level is a few
     hundred files and every level is checked when the list opens. */
  const have = new Set((await media.keys()).map((r) => new URL(r.url).pathname));
  let n = 0;
  for (const file of files.filter(Boolean)) {
    if (have.has(`${base}/media/${file}`)) n += 1;
  }
  return n;
}
