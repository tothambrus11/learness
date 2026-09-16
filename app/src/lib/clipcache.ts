/** A cap on the audio made here.
 *
 *  Every sentence the voice says is a few hundred kilobytes of WAV kept in
 *  the database so the second hearing is instant, and a sitting a day for a
 *  year is a gigabyte on a phone. The cap is a size the learner sets, and
 *  what goes when it is passed is what has not been heard for longest: a
 *  clip that goes is simply made again the next time a card wants it.
 *
 *  The rule is a pure function over sizes and times; the database part is
 *  two calls around it.
 */
import { allClips, deleteClip, getSettings } from './db.js';
import type { Clip, Settings } from './model.js';
import type { Millis } from './units.js';

export const MB = 1048576;

/** What the rule knows about one clip: how big, and when it was last handed
 *  to the player — null for one that never was, or was made before the cap
 *  existed, which the rule treats as older than any that has. */
export interface ClipUse {
  id: string;
  bytes: number;
  usedAt: Millis | null;
}

/** A stored clip, as the rule sees it. The blob knows its own size, so no
 *  row has to be told it; a row that never recorded a hearing falls back to
 *  when it was made. */
export const usage = (clip: Clip): ClipUse =>
  ({ id: clip.id, bytes: clip.blob?.size ?? 0, usedAt: clip.lastUsed ?? clip.createdAt ?? null });

/** Which clips to drop so that what is left fits the limit: the least
 *  recently heard first, until it does. A limit of nothing — zero, absent,
 *  not a number — is no cap, and drops nothing; a cache already under the
 *  limit is left alone. The ids come back in the order they go. */
export function toEvict(clips: readonly ClipUse[], limitBytes: number): string[] {
  if (!(limitBytes > 0)) return [];
  let total = clips.reduce((n, c) => n + c.bytes, 0);
  if (total <= limitBytes) return [];
  /* Never heard first, then oldest hearing first. A stable sort, so two
     clips that tie go in the order they were listed. */
  const oldestFirst = [...clips].sort((a, b) => (a.usedAt ?? -Infinity) - (b.usedAt ?? -Infinity));
  const gone: string[] = [];
  for (const clip of oldestFirst) {
    if (total <= limitBytes) break;
    gone.push(clip.id);
    total -= clip.bytes;
  }
  return gone;
}

/** How much the voice has made here, in bytes, and how many clips it is. */
export async function clipCacheSize(): Promise<{ clips: number; bytes: number }> {
  const clips = await allClips();
  return { clips: clips.length, bytes: clips.reduce((n, c) => n + usage(c).bytes, 0) };
}

/** Bring the cache under the cap, if there is one. Called after every clip
 *  is stored and whenever the cap is changed. Resolves to the ids dropped,
 *  so a screen can say what happened. Rejects rather than swallowing: the
 *  caller writes the failure down. */
export async function trimClips(settings?: Settings): Promise<string[]> {
  const s = settings ?? await getSettings();
  if (!s.capClips) return [];
  const gone = toEvict((await allClips()).map(usage), s.clipCacheMb * MB);
  for (const id of gone) await deleteClip(id);
  return gone;
}
