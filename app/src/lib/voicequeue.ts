/** One voice, one queue, and an order of wanting.
 *
 *  The on-device voice is a single worker that takes a second or two a phrase,
 *  so everything that wants it has to take turns. Two kinds of wanting share
 *  the turn: a learner hovering a verb form, who wants it *now*, and the
 *  sitting's own preparation, which wants everything eventually and nothing
 *  urgently. Without a queue between them the preparation wins by being first,
 *  and the hover — the only one with a person waiting on it — is served after
 *  thirty clips it did not ask for.
 *
 *  So: asking for a phrase puts it at the head and hands back a promise;
 *  warming puts phrases at the tail; and `prefer` moves a word's waiting
 *  phrases to the front, which is what the card on screen does when it
 *  appears. One phrase is made at a time, because the worker can only do one.
 *
 *  And one turn is only for a phrase that has to be made. A clip already on
 *  the device is handed over at once, whatever the voice is busy with: for a
 *  while every ask took a turn, so a tense read aloud with all six clips made
 *  still went silent for a whole clip's synthesis between lines — each line
 *  queued behind whichever warm-up job the voice had just started (#60).
 *
 *  Nothing here ever starts the 380 MB download. A device without the voice
 *  makes nothing, says so by handing back null, and the caller falls back to
 *  the browser's own voice.
 */
import { phraseFor } from './cardface.js';
import { getSettings } from './db.js';
import { report } from './diagnostics.js';
import { WORD_SLOT, clipText, generationState, phraseClip, phraseMade } from './tts.js';
import { FIRST_TENSES, phrasesOf } from './conjspeech.js';
import type { Clip } from './model.js';
import type { Phrase } from './conjspeech.js';
import type { StudyItem } from './queue.js';

/** What a queue does for its callers. */
export interface VoiceQueue {
  /** Say this one now: the clip from the device if it has been made, else
   *  from the head of the queue, and null where this device cannot make one.
   *  A clip already made never waits its turn behind whatever the voice is
   *  busy with. */
  want: (phrase: Phrase) => Promise<Clip | null>;
  /** Make these next, in this order, ahead of everything else waiting: the
   *  lines of a tense about to be read, so the second is being made while
   *  the first is heard rather than asked for once it has ended. Returns at
   *  once; each line claims its clip with `want` when its turn to be said
   *  comes, and finds it made, or being made, rather than waiting a whole
   *  clip's synthesis for something nobody is listening for (#60). */
  wantNext: (phrases: readonly Phrase[]) => void;
  /** Make these when there is nothing more urgent. Returns at once. */
  warm: (phrases: readonly Phrase[]) => void;
  /** Move everything waiting for this word to the front, behind whatever is
   *  already being made: the word on screen is the one about to be hovered. */
  prefer: (key: string) => void;
  /** How many phrases are still waiting. */
  readonly waiting: number;
  /** Forget everything not yet started. What is being made finishes. */
  clear: () => void;
  /** Be told how the queue stands: at once, with the state now, and after
   *  every change — a phrase queued, a job started, a job ended, the queue
   *  cleared or reordered. Returns the unsubscribe. A watcher is a screen
   *  showing what is being made, or the backlog keeping one job in here. */
  onChange: (fn: (snapshot: QueueSnapshot) => void) => () => void;
}

/** The queue as it stands: the job the voice is on, the jobs waiting in their
 *  order, and — on the one snapshot that follows a job finishing — which job
 *  that was and whether the voice made a clip of it. A job forgotten by
 *  `clear` never ends: it simply stops being listed, which is how a watcher
 *  tells "dropped" from "could not be made". Ids are `phraseId`s. */
export interface QueueSnapshot {
  current: string | null;
  waiting: string[];
  ended?: { id: string; made: boolean };
}

interface Job extends Phrase {
  id: string;
  /** Someone is waiting on this one rather than it being prepared. */
  urgent: boolean;
  settle: ((clip: Clip | null) => void)[];
}

/** What tells one job from another: the word and the slot, never the text.
 *  Two phrases of one slot are one job whatever their wording (#76 is what
 *  happens when they are not). */
export const phraseId = (phrase: Pick<Phrase, 'key' | 'slot'>): string =>
  `${phrase.key}#${phrase.slot}`;

/** What a queue is built on: a way of making clips, and a way of finding the
 *  ones already made. Parameters, so that the ordering can be tested without
 *  a voice, which no test machine has. */
export interface VoiceDeps {
  make: (phrase: Phrase) => Promise<Clip | null>;
  /** The clip already on the device for this phrase, or null. Never makes
   *  one. */
  have: (phrase: Phrase) => Promise<Clip | null>;
}

/** A queue over a voice. The app's is built on the on-device voice and the
 *  clip store; a test hands in both. */
export function createVoiceQueue(
  { make = defaultMake, have = defaultHave }: Partial<VoiceDeps> = {},
): VoiceQueue {
  const queue: Job[] = [];
  /** The job the voice is on, which is no longer in the queue. */
  let current: Job | null = null;
  const watchers = new Set<(snapshot: QueueSnapshot) => void>();

  const snapshot = (ended?: QueueSnapshot['ended']): QueueSnapshot => ({
    current: current?.id ?? null,
    waiting: queue.map((job) => job.id),
    ...(ended ? { ended } : {}),
  });
  /** A watcher is a screen; a screen's bug must not be a silent voice. */
  const changed = (ended?: QueueSnapshot['ended']): void => {
    if (!watchers.size) return;
    const now = snapshot(ended);
    for (const fn of watchers) {
      try { fn(now); } catch (err) {
        report('voice', `a watcher of the voice queue failed: ${(err as Error).message}`);
      }
    }
  };

  const push = (phrase: Phrase, { urgent }: { urgent: boolean }): Job | null => {
    if (!phrase.text || !phrase.key || !phrase.slot) return null;
    const id = phraseId(phrase);
    const found = queue.find((job) => job.id === id);
    if (found) {
      /* Already waiting, and now someone is waiting on it: it moves up. */
      if (urgent && !found.urgent) {
        found.urgent = true;
        queue.splice(queue.indexOf(found), 1);
        queue.unshift(found);
        changed();
      }
      return found;
    }
    const job: Job = { ...phrase, id, urgent, settle: [] };
    if (urgent) queue.unshift(job);
    else queue.push(job);
    changed();
    return job;
  };

  async function drain(): Promise<void> {
    if (current) return;
    try {
      while (queue.length) {
        const job = queue.shift()!;
        current = job;
        changed();
        let clip: Clip | null = null;
        try {
          clip = await make(job);
        } catch {
          clip = null;                  /* a phrase that will not be made is silent */
        }
        for (const settle of job.settle) settle(clip);
        /* Ended, and no longer current, in the one snapshot: a watcher must
           never see a job both finished and on the voice. */
        current = null;
        changed({ id: job.id, made: clip !== null });
      }
    } finally {
      current = null;
    }
  }

  const claim = (job: Job): Promise<Clip | null> => {
    const waited = new Promise<Clip | null>((resolve) => { job.settle.push(resolve); });
    void drain();
    return waited;
  };

  return {
    async want(phrase: Phrase): Promise<Clip | null> {
      /* Being made, or already waiting: the ask joins that job — moving it
         up — and nothing is looked up, since the store was asked once, when
         it was queued. */
      const id = phraseId(phrase);
      if (current?.id === id) return claim(current);
      if (queue.some((job) => job.id === id)) return claim(push(phrase, { urgent: true })!);
      let stored: Clip | null = null;
      try {
        stored = await have(phrase);
      } catch (err) {
        /* A store that cannot be read is a clip not found: the voice makes
           it again, and the trouble is written down rather than swallowed. */
        report('voice', `the audio cache could not be read: ${(err as Error).message}`);
      }
      if (stored) return stored;
      const job = push(phrase, { urgent: true });
      return job ? claim(job) : null;
    },
    wantNext(phrases: readonly Phrase[]): void {
      /* Each goes to the head, so the batch would come out reversed; it is
         then put back in the order given, which is the order it is read in. */
      const jobs: Job[] = [];
      for (const phrase of phrases) {
        const job = push(phrase, { urgent: true });
        if (job && !jobs.includes(job)) jobs.push(job);
      }
      for (const job of jobs) queue.splice(queue.indexOf(job), 1);
      queue.unshift(...jobs);
      if (jobs.length) changed();
      void drain();
    },
    warm(phrases: readonly Phrase[]): void {
      for (const phrase of phrases) push(phrase, { urgent: false });
      void drain();
    },
    prefer(key: string): void {
      const mine = queue.filter((job) => job.key === key);
      if (!mine.length) return;
      for (const job of mine) queue.splice(queue.indexOf(job), 1);
      queue.unshift(...mine);
      changed();
    },
    get waiting(): number { return queue.length; },
    clear(): void {
      if (!queue.length) return;
      queue.length = 0;
      changed();
    },
    onChange(fn: (snapshot: QueueSnapshot) => void): () => void {
      watchers.add(fn);
      try { fn(snapshot()); } catch (err) {
        report('voice', `a watcher of the voice queue failed: ${(err as Error).message}`);
      }
      return () => { watchers.delete(fn); };
    },
  };
}

/** The real maker: the on-device voice, and only where it is already here.
 *  Asking for a phrase must never be what starts a 380 MB download. A phrase
 *  says which language it is in; French unless it says otherwise. */
async function defaultMake(phrase: Phrase): Promise<Clip | null> {
  if (await generationState() !== 'ready') return null;
  return phraseClip(phrase.key, phrase.slot, phrase.text, phrase.lang ?? 'fr');
}

/** The real store: the clip made earlier for exactly this wording, if any. */
const defaultHave = (phrase: Phrase): Promise<Clip | null> =>
  phraseMade(phrase.key, phrase.slot, phrase.text, phrase.lang ?? 'fr');

/** The app's queue. One voice, so one of these. */
export const voices: VoiceQueue = createVoiceQueue();

/** How long a phrase's clip runs, in milliseconds — waiting for the clip if
 *  it is still to come — or null where there will be none: a device without
 *  the voice, whose browser will say the line and cannot say for how long.
 *  A reading paces its pauses by it, and a clip waited for here is one the
 *  play that follows finds ready. */
export async function lengthOf(phrase: Phrase, queue: VoiceQueue = voices): Promise<number | null> {
  const clip = await queue.want(phrase);
  return typeof clip?.audioMs === 'number' && clip.audioMs > 0 ? clip.audioMs : null;
}

/** May anything be made before it is asked for?
 *
 *  Two ways it may not: the learner has set the voice to make things on
 *  demand, and the voice is not on this device — in which case making one
 *  clip means fetching 380 MB first, which is never something to do on a
 *  guess about what will be hovered.
 */
export async function eagerAllowed(): Promise<boolean> {
  if (await generationState() !== 'ready') return false;
  const settings = await getSettings();
  return settings.eagerVoice !== false;
}

/** Everything a sitting's cards will say that has to be made first, in the
 *  order the cards come — so the first card's sentence is made before the
 *  tenth's, and the card on screen, which `prefer` moves up, is always next.
 *
 *  Per card: the phrase it plays at the flip — the sentence, the line of the
 *  table — or, on a card about the word alone, the word itself where nothing
 *  recorded it (a word of your own that Make audio has not reached); then
 *  the present tense of a verb, for the table under the card. Not the English
 *  cue: it is heard only on request, so it is made on request. What is
 *  warmed is what `sentenceSources` and `wordSources` would play, under the
 *  same slots, so the flip finds the clip waiting. Pure, so the order can be
 *  tested without a voice. */
export function phrasesForSitting(items: readonly StudyItem[]): Phrase[] {
  const out: Phrase[] = [];
  for (const item of items) {
    const { word } = item;
    const phrase = phraseFor(item);
    if (phrase) out.push({ key: word.k, slot: phrase.slot, text: phrase.text });
    else if (!word.audio && !word.native) {
      /* Worded the way the word's clip is checked and made everywhere else
         (`clipText`): two producers that disagree by a semicolon would each
         find the other's clip out of date and remake it, for ever. */
      out.push({ key: word.k, slot: WORD_SLOT, text: clipText(word, 'fr') });
    }
    out.push(...phrasesOf(word.k, word.conj, FIRST_TENSES));
  }
  return out;
}

/** Prepare what this sitting will want said, in the order it will want it —
 *  where the learner has asked for that (`eagerVoice`) and the voice is on
 *  the device. Resolves to how many phrases were queued.
 *
 *  This is the "before you meet it" half of the setting. The other half is the
 *  table itself, which asks for the rest of its tenses when it is opened, and
 *  for one line the moment it is hovered.
 */
export async function warmSitting(
  items: readonly StudyItem[], queue: VoiceQueue = voices,
): Promise<number> {
  if (!(await eagerAllowed())) return 0;
  const phrases = phrasesForSitting(items);
  queue.warm(phrases);
  return phrases.length;
}
