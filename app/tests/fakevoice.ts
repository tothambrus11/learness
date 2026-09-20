/** A voice for the tests: one that makes nothing on its own and says what it
 *  was asked for, one phrase at a time, and only when the test lets it.
 *  Beside it a store that holds whatever the test puts there. Shared by the
 *  queue's tests and the backlog's, which drive the real queue over it. */
import type { Phrase } from '../src/lib/conjspeech.js';
import type { Clip } from '../src/lib/model.js';

export interface FakeVoice {
  /** The texts asked for, in order. */
  made: string[];
  /** What the store looks up, by phrase text. */
  stored: Map<string, Clip>;
  /** Let the phrase being made finish — with this clip, or with nothing. */
  release: (clip?: Clip | null) => void;
  make: (phrase: Phrase) => Promise<Clip | null>;
  have: (phrase: Phrase) => Promise<Clip | null>;
}

export function fakeVoice(): FakeVoice {
  const made: string[] = [];
  const stored = new Map<string, Clip>();
  let free: ((clip: Clip | null) => void) | null = null;
  return {
    made,
    stored,
    release(clip: Clip | null = null): void { free?.(clip); free = null; },
    make(phrase: Phrase): Promise<Clip | null> {
      made.push(phrase.text);
      return new Promise<Clip | null>((resolve) => { free = resolve; });
    },
    have: async (phrase: Phrase): Promise<Clip | null> => stored.get(phrase.text) ?? null,
  };
}

/** A clip the fake voice can hand back for a phrase. */
export const madeClip = (phrase: Phrase): Clip => ({
  id: `${phrase.key}|fr|supertonic`, key: phrase.key, kind: 'fr', engine: 'supertonic',
  text: phrase.text, blob: new Blob(['x']),
});

/** Let every promise already settled run. */
export const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
