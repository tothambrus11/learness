/** The audio still owed to your own words, made whenever the app is open.
 *
 *  A word from the catalogue comes with a recording; a word you added is
 *  said by the voice on this device, and until it has been, its card is mute
 *  and its row says "No audio yet". For a while the only way that changed was
 *  a button, pressed on the words screen, that made everything on the list
 *  — a button nobody presses when the word was added from a conversation
 *  on another device. The eager setting meanwhile prepared only the sitting
 *  on screen and forgot the rest when the sitting was left.
 *
 *  So: a feeder. It looks at the list, finds the words whose clip is missing
 *  or out of date (`outstanding`, pure), and hands the voice queue *one* of
 *  them at a time, at the tail. One, because the queue's order of wanting
 *  must stay the queue's: a hovered verb form is urgent and goes to the
 *  head, a sitting's warm-up was queued first, and the backlog's job is
 *  never more than a single clip's synthesis in anyone's way. When that job
 *  ends the next is fed; when it vanishes without ending — the study screen
 *  clears the queue on the way out — it is fed again. The feeder never
 *  starts the 380 MB download, never runs when the learner has said "when a
 *  card asks for it", and never fills a capped cache past the point where
 *  the next clip would drop one (`roomForOne`: fed regardless, a full cache
 *  churns for as long as the app is open).
 *
 *  A word the voice could not make is set aside for the session and written
 *  down once, not asked for again every two seconds; the voice arriving is
 *  the one moment a failure is worth another try.
 *
 *  Pure of the app: the queue, the store and the settings come in as
 *  functions, so the ordering and the invariant — one job out — are tested
 *  over the real queue and a fake voice. `voicestate.svelte.ts` is the app's
 *  one feeder, wired to the real ones and mirrored into rune state for the
 *  screens.
 */
import { roomForOne } from './clipcache.js';
import type { Phrase } from './conjspeech.js';
import type { WordKey } from './keys.js';
import type { Settings, UserWord } from './model.js';
import { WORD_SLOT, clipStateOf, clipText } from './tts.js';
import type { ClipRecord } from './tts.js';
import { phraseId } from './voicequeue.js';
import type { QueueSnapshot, VoiceQueue } from './voicequeue.js';

/** The phrase a word's own clip is made from: the slot and the wording that
 *  `phraseClip` stores, `srcFor` plays and `clipStateOf` checks — one rule,
 *  or two producers remake each other's clip for ever. */
export const wordPhrase = (rec: Pick<UserWord, 'k' | 'fr' | 'pos' | 'gender' | 'number'>): Phrase =>
  ({ key: rec.k, slot: WORD_SLOT, text: clipText(rec, 'fr') });

/** One word still owed its audio, and why. */
export interface Owed {
  word: UserWord;
  state: 'missing' | 'stale';
}

/** Which of your words the voice still owes a clip, in the order to make
 *  them: the word asked for first, then the newest — the word typed a moment
 *  ago is the one about to be looked at — then by key, so the order is
 *  total. Only words of your own: a word promoted from the catalogue has a
 *  recording. Only those with a French to say; and not one that would not be
 *  made this session. Pure. */
export function outstanding(
  words: readonly UserWord[], clips: readonly ClipRecord[],
  { prefer = null, skip = new Set<WordKey>() }: {
    prefer?: WordKey | null; skip?: ReadonlySet<WordKey>;
  } = {},
): Owed[] {
  const owed: Owed[] = [];
  for (const word of words) {
    if (word.deleted || word.source === 'catalogue' || skip.has(word.k)) continue;
    const state = clipStateOf(word, clips);
    if (state === 'missing' || state === 'stale') owed.push({ word, state });
  }
  return owed.sort((a, b) => {
    if (prefer && a.word.k !== b.word.k) {
      if (a.word.k === prefer) return -1;
      if (b.word.k === prefer) return 1;
    }
    return (b.word.addedAt ?? 0) - (a.word.addedAt ?? 0)
      || (a.word.k < b.word.k ? -1 : a.word.k > b.word.k ? 1 : 0);
  });
}

/** Why nothing is being made: the voice is not on this device (and is never
 *  fetched on the backlog's account), the learner set audio to be made when
 *  a card asks for it, or the capped cache has no room for one more. */
export type Hold = 'no voice' | 'on demand' | 'cache full';

/** Whether the backlog may hand the voice a word now. One function, so the
 *  reasons are a table. `manual` is a run asked for with a press, which the
 *  on-demand setting does not hold back. */
export function mayFeed({ voiceReady, eager, manual, room }: {
  voiceReady: boolean; eager: boolean; manual: boolean; room: boolean;
}): { ok: true } | { ok: false; why: Hold } {
  if (!voiceReady) return { ok: false, why: 'no voice' };
  if (!eager && !manual) return { ok: false, why: 'on demand' };
  if (!room) return { ok: false, why: 'cache full' };
  return { ok: true };
}

/** What the feeder is doing, for the screen that shows it. A fresh object on
 *  every change, so rune state that mirrors it sees each one. */
export interface BacklogState {
  /** A run is on: the words owed are being made, one after another. */
  running: boolean;
  /** This run was asked for with a press, so it may be cancelled with one. */
  manual: boolean;
  /** How far the run has come, and how many words it will make in all —
   *  re-counted when the list changes under it. */
  done: number;
  total: number;
  /** The word being made now: its key, and the words the voice is saying. */
  current: { key: WordKey; text: string } | null;
  /** Every word still owed a clip, by key, as of the last look — the one
   *  being made included. */
  pending: Record<string, 'missing' | 'stale'>;
  /** The words set aside this session because the voice could not make them. */
  failed: WordKey[];
  /** Why the owed words are not being made, or empty while they are or when
   *  nothing is owed. */
  why: Hold | '';
}

/** What a feeder is built on, so it can be tested without the app. */
export interface FeederDeps {
  queue: VoiceQueue;
  /** Your words, the deleted ones already left out. */
  words: () => Promise<readonly UserWord[]>;
  /** Every clip the voice has made here. */
  clips: () => Promise<readonly ClipRecord[]>;
  /** How much the voice has made here. */
  cache: () => Promise<{ clips: number; bytes: number }>;
  settings: () => Promise<Pick<Settings, 'eagerVoice' | 'capClips' | 'clipCacheMb'>>;
  /** The voice is on this device and can speak. */
  voiceReady: () => Promise<boolean>;
  /** Where trouble is written down. */
  report: (what: string) => void;
  /** A clip of this word was just made, or made again. */
  made?: (key: WordKey) => void;
}

export interface Feeder {
  /** Look at the list again — a word was added, a sync came in, the app came
   *  back into view — and carry on. While a look is under way, once more
   *  after it. `retryFailed` gives the words set aside another chance: for
   *  the voice arriving, and nothing else. */
  rescan: (opts?: { retryFailed?: boolean }) => void;
  /** The word being looked at: made next, and moved up in the queue if it
   *  is already there. Null when no word is. */
  prefer: (key: WordKey | null) => void;
  /** One run through the owed words now, whatever the setting says — the
   *  Make audio button. The voice must still be here. `only` is the button
   *  on one word's row, card or page: that word, and no other, on the
   *  on-demand setting, where a press must never be work the device was
   *  not asked for; under ahead-of-time the word is simply made next.
   *  `retryFailed` gives the words set aside another chance — the one word,
   *  or all of them: a press is the other moment worth one. */
  runOnce: (opts?: { only?: WordKey; retryFailed?: boolean }) => void;
  /** Call off a run asked for with a press. What is being made finishes. */
  stopRun: () => void;
  /** Be told at once, and after every change. Returns the unsubscribe. */
  onState: (fn: (state: BacklogState) => void) => () => void;
  readonly state: BacklogState;
  /** Stop watching the queue. What is being made finishes. */
  stop: () => void;
}

export function createFeeder(deps: FeederDeps): Feeder {
  /** The words still to feed, in order; the one out now is not in it. */
  let plan: Owed[] = [];
  /** The backlog's one job in the queue: it ends, or the queue says it
   *  dropped it. */
  let job: { id: string; owed: Owed } | null = null;
  const failed = new Set<WordKey>();
  let preferred: WordKey | null = null;
  let manual = false;
  /** A press on one word, on the on-demand setting: the plan is that word. */
  let only: WordKey | null = null;
  /** Words made while a look at the list was under way: that look read the
   *  clips before they were stored, and would owe them again. */
  let madeMeanwhile: Set<WordKey> | null = null;
  let running = false;
  let done = 0;
  let total = 0;
  let why: Hold | '' = '';
  let scanning = false;
  let dirty = false;
  let feeding = false;
  const listeners = new Set<(state: BacklogState) => void>();

  const snapshot = (): BacklogState => {
    const pending: Record<string, 'missing' | 'stale'> = {};
    if (job) pending[job.owed.word.k] = job.owed.state;
    for (const owed of plan) pending[owed.word.k] = owed.state;
    return {
      running, manual, done, total,
      current: job ? { key: job.owed.word.k, text: wordPhrase(job.owed.word).text } : null,
      pending, failed: [...failed], why,
    };
  };
  let last = snapshot();
  /* The same loop as `notify` in diagnostics.ts, over the report handed in:
     this module reaches no store of its own. */
  const tell = (to: Iterable<(state: BacklogState) => void>): void => {
    for (const fn of to) {
      try { fn(last); } catch (err) {
        deps.report(`a screen watching the backlog failed: ${(err as Error).message}`);
      }
    }
  };
  const emit = (): void => {
    last = snapshot();
    tell(listeners);
  };

  /** The run is over: nothing owed, or the press's one word made. */
  const over = (): void => {
    running = false;
    manual = false;
    why = '';
    if (only) {
      /* The one word is done; the list is read again so the panel says
         what is still owed, held by the setting as before the press. */
      only = null;
      rescan();
    }
  };

  /** Hand the voice the next word, if there is one and nothing holds it. */
  async function feed(): Promise<void> {
    if (job || feeding) return;
    feeding = true;
    try {
      if (!plan.length) { over(); return; }
      const [ready, settings] = await Promise.all([deps.voiceReady(), deps.settings()]);
      /* The clip store is weighed only under a cap: weighing it is reading
         every clip's audio, and the answer is "room" without one. */
      const room = settings.capClips ? roomForOne(await deps.cache(), settings) : true;
      const gate = mayFeed({
        voiceReady: ready, eager: settings.eagerVoice !== false, manual, room,
      });
      if (!gate.ok) {
        running = false;
        manual = false;
        only = null;
        why = gate.why;
        return;
      }
      /* The plan may have been emptied while the settings were read — a
         run called off, the last owed word removed. */
      const owed = plan.shift();
      if (!owed) { over(); return; }
      if (settings.eagerVoice !== false) {
        /* The run is the setting's, not the press's: nothing to call off. */
        manual = false;
        only = null;
      }
      if (!running) { running = true; done = 0; }
      total = done + 1 + plan.length;
      why = '';
      const phrase = wordPhrase(owed.word);
      job = { id: phraseId(phrase), owed };
      deps.queue.warm([phrase]);
    } catch (err) {
      deps.report(`the backlog could not go on: ${(err as Error).message}`);
    } finally {
      feeding = false;
      emit();
    }
  }

  const onSnapshot = (s: QueueSnapshot): void => {
    if (!job) return;
    if (s.dropped?.includes(job.id)) {
      /* Forgotten by the sitting on its way out: back to the front. */
      plan.unshift(job.owed);
      job = null;
      void feed();
      return;
    }
    if (s.ended?.id === job.id) {
      const { owed } = job;
      job = null;
      if (s.ended.made) {
        done += 1;
        madeMeanwhile?.add(owed.word.k);
        deps.made?.(owed.word.k);
      } else {
        /* Set aside, and said once: the set is the memo. */
        failed.add(owed.word.k);
        deps.report(`the voice could not make “${wordPhrase(owed.word).text}”`);
      }
      void feed();
    }
  };
  const unwatch = deps.queue.onChange(onSnapshot);

  function rescan({ retryFailed = false }: { retryFailed?: boolean } = {}): void {
    if (retryFailed) failed.clear();
    if (scanning) { dirty = true; return; }
    scanning = true;
    void (async () => {
      try {
        do {
          dirty = false;
          madeMeanwhile = new Set();
          const [words, clips] = await Promise.all([deps.words(), deps.clips()]);
          const busy = job?.owed.word.k;
          const made = madeMeanwhile;
          plan = outstanding(words, clips, { prefer: preferred, skip: failed })
            .filter((owed) => owed.word.k !== busy && !made.has(owed.word.k)
              && (!(manual && only) || owed.word.k === only));
        } while (dirty);
        if (running) total = done + (job ? 1 : 0) + plan.length;
      } catch (err) {
        deps.report(`the words owed audio could not be read: ${(err as Error).message}`);
      } finally {
        scanning = false;
        madeMeanwhile = null;
      }
      /* Said now: with a job already out, `feed` has nothing to add, and the
         panel's count would otherwise wait for that job to end. */
      emit();
      await feed();
    })();
  }

  return {
    rescan,
    prefer(key: WordKey | null): void {
      preferred = key;
      if (!key) return;
      const at = plan.findIndex((owed) => owed.word.k === key);
      if (at > 0) plan.unshift(...plan.splice(at, 1));
      deps.queue.prefer(key);
      emit();
    },
    runOnce({ only: one, retryFailed = false }: { only?: WordKey; retryFailed?: boolean } = {}): void {
      manual = true;
      only = one ?? null;
      if (one) {
        if (retryFailed) failed.delete(one);
        rescan();
      } else {
        rescan({ retryFailed });
      }
    },
    stopRun(): void {
      if (!manual) return;
      manual = false;
      only = null;
      plan = [];
      /* The list is read again so the panel says what is still owed, and
         the setting then holds the run as it did before the press. */
      rescan();
    },
    onState(fn: (state: BacklogState) => void): () => void {
      listeners.add(fn);
      tell([fn]);
      return () => { listeners.delete(fn); };
    },
    get state(): BacklogState { return last; },
    stop: unwatch,
  };
}
