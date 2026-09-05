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
import { isOnline } from './network.js';

export function prefetchMedia(files, { concurrency = 2, onProgress = () => {} } = {}) {
  const queue = [...new Set(files.filter(Boolean))];
  const total = queue.length;
  let stopped = false;
  let done = 0;
  let failed = 0;
  if (!total || !isOnline() || typeof fetch === 'undefined') {
    return { stop() {}, done: Promise.resolve({ done: 0, failed: 0, total }) };
  }

  const missed = [];
  const drain = async () => {
    while (!stopped && queue.length) {
      const file = queue.shift();
      try {
        const res = await fetch(`${base}/media/${file}`);
        await res.arrayBuffer();          /* read it through, so it is stored */
        if (!res.ok) missed.push(file);
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
    return { done, failed: missed.length, total, missing: [...missed] };
  })();
  return { stop() { stopped = true; }, done: finished };
}

/** Is every one of these clips already in the offline cache? */
export async function cachedCount(files) {
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
