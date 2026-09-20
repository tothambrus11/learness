/** What the voice is doing, for the screens: rune state over the queue and
 *  the backlog.
 *
 *  A screen may read three things here and decide nothing. `making` is the
 *  queue as it stands — which phrase the voice is on, which are waiting — so
 *  a row, a card, a verb form or a sentence can say "this is being made" the
 *  same way everywhere (`isMaking`). `backlog` is the feeder's own account of
 *  itself — how far the run has come, what holds it — for the panel that
 *  offers to make audio. `made` ticks every time a clip of one of your
 *  words is made, so a screen that keeps "what can this word play" looks
 *  again; it used to be told through a callback threaded from the button
 *  that made the clip, and now nobody presses a button.
 *
 *  The app's one feeder is built and installed here (`installBacklog`, from
 *  the layout, once — rules.test.ts), wired to the real queue, store and
 *  settings, and woken by everything that could change what is owed: the
 *  app coming back into view, a sync bringing words, a word added or
 *  corrected here, the voice arriving. Before it is installed the functions
 *  below do nothing, so a test of `isMaking` needs only `watchQueue`.
 */
import { createFeeder } from './backlog.js';
import type { BacklogState, Feeder } from './backlog.js';
import { forgetSrc } from './audio.js';
import { clipCacheSize } from './clipcache.js';
import { allClips, getSettings } from './db.js';
import { report } from './diagnostics.js';
import type { WordKey } from './keys.js';
import { onSync } from './sync.js';
import { generationState, onStatus } from './tts.js';
import { phraseId, voices } from './voicequeue.js';
import type { VoiceQueue } from './voicequeue.js';
import { activeUserWords, onWordsChanged } from './words.js';

/** The queue as it stands: the id of the phrase the voice is on, and the
 *  ids of those waiting, in order. Ids are `phraseId`s. */
export const making: { id: string | null; waiting: string[] } = $state({ id: null, waiting: [] });

const EMPTY: BacklogState = {
  running: false, manual: false, done: 0, total: 0, current: null, pending: {}, failed: [], why: '',
};

/** The backlog's account of itself. See `BacklogState`. */
export const backlog: BacklogState = $state({ ...EMPTY });

/** Ticks each time a clip of one of your words is made or made again;
 *  `key` is the word. Read `seq` in an effect to be re-run by it. */
export const made: { seq: number; key: WordKey | null } = $state({ seq: 0, key: null });

const ofWord = (id: string, key: string, slot?: string): boolean =>
  (slot === undefined ? id.startsWith(`${key}#`) : id === phraseId({ key, slot }));

/** Is the voice on this phrase now — or, with no slot, on any phrase of this
 *  word? What a screen paints the sweep by. */
export const isMaking = (key: string, slot?: string): boolean =>
  !!making.id && ofWord(making.id, key, slot);

/** Is this phrase — or any of the word's — queued, not yet on the voice? */
export const isWaiting = (key: string, slot?: string): boolean =>
  making.waiting.some((id) => ofWord(id, key, slot));

/** Mirror a queue into `making`. The app's, unless a test hands one in.
 *  Returns the function that stops mirroring. */
export function watchQueue(queue: VoiceQueue = voices): () => void {
  return queue.onChange((s) => {
    making.id = s.current;
    making.waiting = s.waiting;
  });
}

let feeder: Feeder | null = null;

/** The word being looked at — the detail page open on it, its row being
 *  edited: made next, and moved up in the queue if it is already there.
 *  Null on the way out. */
export function preferWord(key: WordKey | null): void {
  feeder?.prefer(key);
}

/** Make the owed words now, whatever the setting says: the Make audio
 *  button, with the voice already here. */
export function runBacklogNow(): void {
  feeder?.runOnce();
}

/** Call off a run started with `runBacklogNow`. */
export function stopBacklogRun(): void {
  feeder?.stopRun();
}

/** Look at the list again: the settings page calls this after a dial the
 *  backlog reads has moved, so a run held by the setting starts now rather
 *  than at the next app open. */
export function kickBacklog(): void {
  feeder?.rescan();
}

/** Start the backlog for this session, over the real app, and mirror it
 *  into `backlog`. Returns the teardown. Installed by the layout, once. */
export function installBacklog(queue: VoiceQueue = voices): () => void {
  if (feeder) return () => {};
  const mine = createFeeder({
    queue,
    words: activeUserWords,
    clips: allClips,
    cache: clipCacheSize,
    settings: getSettings,
    voiceReady: async () => (await generationState()) === 'ready',
    report: (what) => { report('voice', what); },
    made: (key) => {
      /* The URL minted for the old clip, if any, must not be handed out
         again; then whoever is showing the word looks again. */
      forgetSrc(key);
      made.seq += 1;
      made.key = key;
    },
  });
  feeder = mine;
  const stops: (() => void)[] = [
    watchQueue(queue),
    mine.onState((s) => { Object.assign(backlog, s); }),
    onSync((result) => { if (result.received.words) mine.rescan(); }),
    onWordsChanged(() => { mine.rescan(); }),
  ];
  /* The voice arriving — the download the learner agreed to, finishing —
     is the one moment a word set aside is worth another try. The worker
     writes the "voice is here" setting a moment before it says so; the
     backlog's read of it is a later transaction on the same store, so it
     sees it. */
  let phase = 'idle';
  stops.push(onStatus((status) => {
    if (status.phase === 'ready' && phase === 'loading') mine.rescan({ retryFailed: true });
    phase = status.phase;
  }));
  if (typeof document !== 'undefined') {
    const onVisible = (): void => { if (!document.hidden) mine.rescan(); };
    document.addEventListener('visibilitychange', onVisible);
    stops.push(() => { document.removeEventListener('visibilitychange', onVisible); });
  }
  mine.rescan();
  return () => {
    for (const stop of stops) stop();
    mine.stop();
    feeder = null;
    Object.assign(backlog, EMPTY);
  };
}
