/** Warm the audio cache, in the order the clips will be wanted. */

import { base } from '$app/paths';

import { isOnline } from './network';

/** Clips in flight at once where the caller does not say: two keeps a phone
 *  responsive, and a screen explicitly downloading a level asks for more. */
const DEFAULT_CONCURRENCY = 2;

/** How hard to pull, and who to tell about it. */
export interface PrefetchOptions {
  /** How many clips are in flight at once; `DEFAULT_CONCURRENCY` where it is
   *  not given. */
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
  /** Resolves when the queue is empty or stopped; never rejects, a clip that
   *  will not come being a fact to report rather than an error to handle. */
  done: Promise<PrefetchResult>;
}

/** Reads a response's body to the end, which is what makes the service worker
 *  keep the clip. The bytes themselves are not wanted here. */
const storeThrough = (res: Response): Promise<ArrayBuffer> => res.arrayBuffer();

/** Fetch these clips, in order, so the service worker keeps them. Returns at
 *  once with the job; nothing is awaited by the caller unless it wants the
 *  tally. Blank entries and duplicates are dropped, and a device that is
 *  offline or has no fetch does nothing at all. */
export function prefetchMedia(
  files: (string | null | undefined)[],
  { concurrency = DEFAULT_CONCURRENCY, onProgress = () => {} }: PrefetchOptions = {},
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
      /* `shift()` is typed as possibly undefined; the length was just checked. */
      if (file === undefined) break;
      try {
        const res = await fetch(`${base}/media/${file}`);
        await storeThrough(res);
        if (!res.ok) missed.push(file);
      } catch {
        missed.push(file);
      }
      done += 1;
      onProgress(done, total);
    }
  };
  /** One sweep of the queue with every worker at once. */
  const pass = (): Promise<void[]> => Promise.all(Array.from({ length: concurrency }, drain));
  /** The whole job: a sweep, then a second go, in order, at whatever fell
   *  over, before any of it is called missing. */
  const finished = (async (): Promise<PrefetchResult> => {
    await pass();
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

/** How many of these clips are already in the offline cache; 0 where the
 *  browser has no cache storage. */
export async function cachedCount(files: (string | null | undefined)[]): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  const media = await caches.open('media');
  const have = new Set((await media.keys()).map((r) => new URL(r.url).pathname));
  let n = 0;
  for (const file of files.filter(Boolean)) {
    if (have.has(`${base}/media/${file}`)) n += 1;
  }
  return n;
}
