/** One player.
 *
 *  Every sound the app makes goes through here: a recording the catalogue
 *  ships, a clip the voice made on this device, the browser's own voice
 *  reading what there is no clip of. There used to be three copies of "play
 *  it, or say it, or give up" — the study screen's, the verb table's and the
 *  words screen's — each with its own idea of what busy meant. The study
 *  screen's set its "making it…" flag before anyone had looked whether the
 *  clip was already on the device, so a cached sentence said it was being
 *  made while it played (#34). Nothing outside this file constructs an
 *  `Audio`; `tests/rules.test.ts` greps for it.
 *
 *  A play is a list of sources tried in order, and the first that sounds
 *  wins. The state is written down — idle, making, playing — with one
 *  sentence of trouble when nothing sounded, because a button that does
 *  nothing and says nothing is how a missing recording went unreported for a
 *  day (#31).
 *
 *  One sound at a time: a new play stops the old one, and a play stopped
 *  while its clip is still being made is dropped when the clip arrives. A
 *  sentence takes seconds to synthesise, and by then the card may have been
 *  graded and the next one dealt — and the next card's French, played before
 *  it has been asked, is the answer on a "write it" card.
 */
import { clipSrc } from './audio.js';
import type { Phrase } from './conjspeech.js';
import { report } from './diagnostics.js';
import { hush as hushAloud, say as sayAloud } from './speech.js';
import { generationState, phraseOnDevice } from './tts.js';
import { nowMs } from './units.js';
import { voices } from './voicequeue.js';

/** Where a sound may come from. Tried in the order given. */
export type Source =
  /** A recording: a URL, or a way of finding one that may find none. */
  | { file: string | (() => Promise<string | null>) }
  /** A clip the on-device voice makes, or has made, for this phrase. */
  | { phrase: Phrase }
  /** The browser's own voice. */
  | { say: string; lang: string; rate?: number };

export type Phase = 'idle' | 'making' | 'playing';

/** What the player is doing, for a screen that shows it. */
export interface PlayerStatus {
  phase: Phase;
  /** Why the last play could not be heard, in words, or empty. Cleared by the
   *  next play and by `stop`. */
  trouble: string;
  /** How long the last sound ran, in milliseconds, set as it ends: the
   *  audio's own length where the element knew it, the time it took to play
   *  otherwise — the browser's voice never says. Null until something has
   *  been heard, and after `stop`. A reading paces its pauses by it. */
  heardMs: number | null;
}

/** What a clip's state is before it is asked for: on the device, makeable
 *  here, or not to be had — the voice is not on this device, and a phrase
 *  is never what starts the 380 MB download. */
export type ClipState = 'ready' | 'makeable' | 'none';

/** One sounding thing. `play` resolves when it has finished, true if it
 *  was heard; `stop` cuts it short, and resolves `play` false. */
export interface Sounding {
  play: () => Promise<boolean>;
  stop: () => void;
  /** How long it runs, in milliseconds, once the audio has said; null until
   *  it has. Optional: a sounding that never knows is timed instead. */
  lengthMs?: () => number | null;
}

/** What the player is built on. Parameters, so the ordering and the state
 *  can be tested without a speaker, which no test machine has. */
export interface PlayerDeps {
  sound: (src: string) => Sounding;
  say: (text: string, opts: { lang: string; rate?: number }) => Promise<boolean>;
  hush: () => void;
  clipState: (phrase: Phrase) => Promise<ClipState>;
  /** The clip's URL, made if need be, or null where it cannot be. */
  clip: (phrase: Phrase) => Promise<string | null>;
  /** Where "nothing could be heard" is written down, beyond the screen. */
  report?: (what: string) => void;
}

export interface Player {
  readonly status: PlayerStatus;
  onStatus: (fn: (status: PlayerStatus) => void) => () => void;
  /** Try each source in turn. Resolves true when something was heard; false
   *  when nothing was, or the play was stopped — and in the first case
   *  `missing` is what the status says. */
  play: (sources: readonly Source[], opts?: { missing?: string }) => Promise<boolean>;
  /** Silence, now. Whatever was being made is dropped when it arrives. */
  stop: () => void;
}

export function createPlayer(deps: PlayerDeps): Player {
  let status: PlayerStatus = { phase: 'idle', trouble: '', heardMs: null };
  const listeners = new Set<(status: PlayerStatus) => void>();
  /* Changes with every play and every stop. A play that finds the stamp has
     moved on is stale, and touches nothing. */
  let stamp = 0;
  let sounding: Sounding | null = null;

  const emit = (next: Partial<PlayerStatus>): void => {
    status = { ...status, ...next };
    for (const fn of listeners) fn(status);
  };

  function stop(): void {
    stamp += 1;
    deps.hush();
    sounding?.stop();
    sounding = null;
    emit({ phase: 'idle', trouble: '', heardMs: null });
  }

  /** Try one source. Resolves how long it ran when it was heard, null when
   *  it was not. Every wait is followed by a look at the stamp: what arrives
   *  after a stop is silence. */
  async function attempt(source: Source, live: () => boolean): Promise<number | null> {
    if ('say' in source) {
      if (!source.say) return null;
      emit({ phase: 'playing' });
      const { say, lang, rate } = source;
      const started = nowMs();
      const heard = await deps.say(say, rate === undefined ? { lang } : { lang, rate });
      return heard ? nowMs() - started : null;
    }
    let src: string | null;
    if ('phrase' in source) {
      const state = await deps.clipState(source.phrase);
      if (state === 'none' || !live()) return null;
      /* Only a clip that is not here yet is "being made": the one on the
         device plays at once, and saying otherwise was #34. */
      if (state === 'makeable') emit({ phase: 'making' });
      src = await deps.clip(source.phrase);
    } else {
      src = typeof source.file === 'string' ? source.file : await source.file();
    }
    if (!src || !live()) return null;
    emit({ phase: 'playing' });
    const s = deps.sound(src);
    sounding = s;
    const started = nowMs();
    const heard = await s.play();
    if (sounding === s) sounding = null;
    if (!heard) return null;
    return s.lengthMs?.() ?? nowMs() - started;
  }

  async function play(
    sources: readonly Source[], { missing = '' }: { missing?: string } = {},
  ): Promise<boolean> {
    stop();
    const mine = stamp;
    const live = (): boolean => mine === stamp;
    for (const source of sources) {
      let heardMs: number | null = null;
      try {
        heardMs = await attempt(source, live);
      } catch {
        heardMs = null;               /* a source that throws is one that did not sound */
      }
      if (!live()) return false;
      if (heardMs !== null) {
        emit({ phase: 'idle', trouble: '', heardMs });
        return true;
      }
    }
    emit({ phase: 'idle', trouble: missing });
    if (missing) deps.report?.(missing);
    return false;
  }

  return {
    get status(): PlayerStatus { return status; },
    onStatus(fn): () => void {
      listeners.add(fn);
      fn(status);
      return () => { listeners.delete(fn); };
    },
    play,
    stop,
  };
}

/** An `HTMLAudioElement`, as a Sounding. The one place one is made. */
function sound(src: string): Sounding {
  const a = new Audio(src);
  let settle: (heard: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => { settle = resolve; });
  a.onended = (): void => settle(true);
  a.onerror = (): void => settle(false);
  return {
    play(): Promise<boolean> {
      a.play().catch(() => settle(false));
      return done;
    },
    stop(): void {
      a.pause();
      settle(false);
    },
    lengthMs(): number | null {
      return Number.isFinite(a.duration) ? a.duration * 1000 : null;
    },
  };
}

async function clipState(phrase: Phrase): Promise<ClipState> {
  if (await phraseOnDevice(phrase.key, phrase.slot, phrase.lang ?? 'fr')) return 'ready';
  return (await generationState()) === 'ready' ? 'makeable' : 'none';
}

/** The app's player. One speaker, so one of these. */
export const player: Player = createPlayer({
  sound,
  say: sayAloud,
  hush: hushAloud,
  clipState,
  clip: async (phrase) => clipSrc(await voices.want(phrase)),
  report: (what) => report('sound', what),
});
