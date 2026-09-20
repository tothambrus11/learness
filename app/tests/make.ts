/** Fixtures, as complete records.
 *
 *  A card and a review are wide records with rules — an id built from the key,
 *  a channel that matches the rung — and a test that writes one out by hand
 *  either repeats all of it or quietly tests a shape the app never stores. So
 *  every fixture is built here from the same constructors the app uses, and a
 *  test says only what it is actually about.
 *
 *  Keys arrive as plain strings for brevity: `card('bug|noun', …)` rather than
 *  `card(trustWordKey('bug|noun'), …)`. This is the one place that conversion
 *  is made, which is the point of the branded types — it is greppable.
 */
import { Rating, State } from 'ts-fsrs';
import { cardId, trustWordKey } from '../src/lib/keys.js';
import type { CardId, Channel, Rung, WordKey } from '../src/lib/keys.js';
import { DEFAULT_SETTINGS } from '../src/lib/db.js';
import { DEFAULT_DISPLAY } from '../src/lib/gender.js';
import { emptyCard } from '../src/lib/scheduler.js';
import type {
  BitState, Clip, DisplaySettings, IndexEntry, LadderCard, Review, Settings, StoredCard, StudyWord, UserWord,
} from '../src/lib/model.js';
import { BIT_V } from '../src/lib/model.js';
import { secOf, trustMs, trustSec } from '../src/lib/units.js';
import type { Millis, Seconds } from '../src/lib/units.js';

export const k = (key: string): WordKey => trustWordKey(key);
export const ms = (n: number): Millis => trustMs(n);
export const sec = (n: number): Seconds => trustSec(n);

/** A card on a rung, knowing nothing, with whatever the test cares about on
 *  top. `extra` is applied after the constructor, so a test can age a card
 *  into any state without building the FSRS half of it. */
export function card(
  key: string,
  channel: Channel = 'written',
  rung: Rung = 'recognise',
  extra: Partial<LadderCard> = {},
  now: Date = new Date('2026-03-01T08:00:00Z'),
): LadderCard {
  return { ...emptyCard(k(key), channel, rung, now), ...extra };
}

/** A review of that card. The id follows the key and rung unless the test
 *  says otherwise, so a log row always names a card that could exist. */
export function review(over: Omit<Partial<Review>, 'key'> & { key?: string } = {}): Review {
  const { key: given, ...rest } = over;
  const key = k(given ?? 'bug|noun');
  const channel = over.channel ?? 'written';
  const rung = over.rung ?? 'recognise';
  return {
    uid: `uid-${key}-${String(over.ts ?? 0)}-${Math.random().toString(36).slice(2, 8)}`,
    id: cardId(key, channel, rung),
    direction: `${channel}/${rung}`,
    ts: secOf(trustMs(Date.now())),
    rating: Rating.Good,
    ms: null,
    state: State.Review,
    ...rest,
    key,
  };
}

/** A word as a card shows it. */
export function word(over: Omit<Partial<StudyWord>, 'k'> & { k?: string } = {}): StudyWord {
  const { k: given, ...rest } = over;
  return {
    fr: 'le bug',
    en: ['bug'],
    answer: 'le bug',
    lemma: 'bug',
    pos: 'noun',
    lvl: 1,
    ...rest,
    k: k(given ?? 'bug|noun'),
  };
}

/** One of your own words, as it is stored. */
export function userWord(over: Omit<Partial<UserWord>, 'k'> & { k?: string } = {}): UserWord {
  const { k: given, ...rest } = over;
  return {
    fr: 'le natel', en: ['mobile phone'], pos: 'noun', ...rest, k: k(given ?? 'natel|noun'),
  };
}

/** A row of the shipped index. */
export function entry(over: Omit<Partial<IndexEntry>, 'k'> & { k?: string } = {}): IndexEntry {
  const { k: given, ...rest } = over;
  return { fr: 'le bug', en: ['bug'], lvl: 1, m: 0.001, ...rest, k: k(given ?? 'bug|noun') };
}

/** Audio made on the device. */
export function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: 'bug|noun|fr|supertonic',
    key: 'bug|noun',
    kind: 'fr',
    engine: 'supertonic',
    text: 'le bug',
    blob: new Blob(['x']),
    ...over,
  };
}

export const settings = (over: Partial<Settings> = {}): Settings =>
  ({ ...DEFAULT_SETTINGS, ...over });

export const display = (over: Partial<DisplaySettings> = {}): DisplaySettings =>
  ({ ...DEFAULT_DISPLAY, ...over });

/** A voice the speech engine might offer. */
export function voice(over: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice {
  return {
    lang: 'fr-FR',
    name: 'a voice',
    default: false,
    localService: true,
    voiceURI: over.name ?? 'a voice',
    ...over,
  };
}

/** A grammar bit the learner has opened, complete. */
export const bit = (id: string, over: Partial<BitState> = {}): BitState =>
  ({ id, openedAt: ms(1), updatedAt: ms(1), v: BIT_V, ...over });

export const id = (value: string): CardId => value as CardId;

/** What a request was for, whichever of the three shapes `fetch` was given. */
export const asked = (input: RequestInfo | URL): string =>
  (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

/** A request body a stub was handed, as the object it was sent as. */
export const sent = <T>(body: BodyInit | null | undefined): T =>
  JSON.parse(typeof body === 'string' ? body : '{}') as T;

/** A card from before the ladder: keyed by direction, with no channel or rung.
 *  What a device that has not migrated still sends, and what the upgrade has
 *  to place. */
export function legacyCard(
  key: string, direction: string, extra: Partial<StoredCard> = {},
): StoredCard {
  /* No channel, no rung, and no `retired`: none of the three existed when a
     card was keyed by direction. */
  const { channel: _channel, rung: _rung, retired: _retired, ...fsrs } = card(key);
  return { ...fsrs, id: id(`${key}|${direction}`), direction, ...extra };
}
