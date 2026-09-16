/** A conjugated form, as it is said rather than as it is written.
 *
 *  A verb form on its own is not what anyone hears. "ais" is nothing, "étais"
 *  is barely a word, and "j'étais" is French: the pronoun carries the elision,
 *  the liaison and half the rhythm, and it is what tells you that "parle",
 *  "parles" and "parlent" are one sound with three spellings. So the table
 *  speaks the line, not the cell.
 *
 *  The pipeline has already done the hard part — its pronouns come elided
 *  ("j'", "qu'il") and its subjunctive rows carry their "que" — so the rule
 *  here is short: what stands between a pronoun and its verb is a space, or
 *  nothing after an apostrophe, and that one rule (`leadOf`) is what the
 *  table draws, the voice says and the form card shows. The one case beyond
 *  it is the imperative, whose pronoun is written in brackets because it is
 *  not said at all.
 */
import type { Conjugation, ConjugationGroup, ConjugationRow, FormGap } from './model.js';
import { nowMs } from './units.js';

/** The tenses a learner meets first, and the only ones made ahead of time: the
 *  literary ones are read far more often than they are said. */
export const CORE_TENSES: readonly string[] = ['pres', 'imp', 'fut', 'cond', 'subj', 'imper'];

/** One phrase of a word: where its clip is kept, and what is in it. */
export interface Phrase {
  /** The word it belongs to. */
  key: string;
  /** Which phrase of that word — "conj:pres:0". Clips are stored under it. */
  slot: string;
  /** What the voice says. */
  text: string;
  /** The language it is said in. Absent means French: everything a card says
   *  is French, except the English cue, which is the one phrase that says so. */
  lang?: 'fr' | 'en';
}

/** Where a row's clip lives: the tense and the row's place in it. Stable
 *  across a rebuild of the catalogue, since neither moves. */
export const conjSlot = (groupId: string, row: number): string => `conj:${groupId}:${row}`;

/** The pronoun as it is written before its form: "je " with its space,
 *  "j'" and "que j'" with none, "(tu) " for the imperative, and "" for a row
 *  with no pronoun. An elision is one word on the page as well as in the ear,
 *  so this is the only place that decides what stands between a pronoun and
 *  its verb — the table used to draw them as two cells with a gap between,
 *  which read as "j' étais" on a phone (#58). A pronoun with stray spaces
 *  around it, from an older catalogue, is trimmed here rather than trusted
 *  at each reader.
 */
export function leadOf(pronoun: string | null | undefined): string {
  const p = (pronoun ?? '').trim();
  if (!p) return '';
  return /['’]$/.test(p) ? p : `${p} `;
}

/** One line of the table as it is written: the pronoun joined to its form by
 *  `leadOf`'s rule — "j'aime", "je parle", "qu'il aime", "(tu) parle". Empty
 *  for a row with no form, whatever its pronoun. */
export function joinPronoun(pronoun: string | null | undefined, form: string | null | undefined): string {
  const f = (form ?? '').trim();
  return f ? `${leadOf(pronoun)}${f}` : '';
}

/** What is said before the form: the written lead, except that "(tu)" is
 *  the imperative's way of writing a pronoun that is not spoken — "sois
 *  sage", not "tu sois sage" — so its lead is nothing. The form card draws
 *  its answer from this, so what it shows is what the clip said. */
export function spokenLead(row: ConjugationRow | null | undefined): string {
  const pronoun = (row?.p ?? '').trim();
  return pronoun.startsWith('(') ? '' : leadOf(pronoun);
}

/** What the voice says for one line of a table: the spoken lead and the
 *  form, so an elided pronoun runs into its verb with no pause — "j'étais",
 *  never "j' étais" — and the imperative's bracketed pronoun is dropped. */
export function spokenForm(row: ConjugationRow | null | undefined): string {
  const form = (row?.f ?? '').trim();
  return form ? `${spokenLead(row)}${form}` : '';
}

/** One line of a tense as a reading says it: which row of the table it is,
 *  so the screen can mark the line being said, and the phrase itself. */
export interface SpokenLine {
  /** The row's place in the group, as the table numbers it — the same
   *  number the slot carries, kept apart so a screen never parses a slot. */
  row: number;
  phrase: Phrase;
}

/** A whole tense, one person at a time, in the order the table shows: je,
 *  tu, il, nous, vous, ils — which is the order the pipeline writes the rows
 *  in, and the order they read down the first column and then the second.
 *  A row with nothing in it is skipped, not paused on; a variant ("je paye"
 *  beside "je paie") is not read, only the form the table stands on; and
 *  the imperative is read without its bracketed pronoun, as spokenForm says.
 *  Every line's slot is the one the hover uses, so a line read here is a
 *  clip the hover finds ready. */
export function tenseInOrder(key: string, group: ConjugationGroup): SpokenLine[] {
  const out: SpokenLine[] = [];
  group.rows.forEach((row, i) => {
    const text = spokenForm(row);
    if (text) out.push({ row: i, phrase: { key, slot: conjSlot(group.id, i), text } });
  });
  return out;
}

/** Every line of one tense, ready to be said — the same lines, in the same
 *  order, as a reading of it. */
export function phrasesOfGroup(key: string, group: ConjugationGroup): Phrase[] {
  return tenseInOrder(key, group).map((line) => line.phrase);
}

/** A reading in progress. `done` resolves when the last line has been said,
 *  or sooner when the reading was stopped or a line could not be heard:
 *  true only if every line sounded. */
export interface Reading {
  done: Promise<boolean>;
  /** End it now. What is being said is the caller's to cut short (the
   *  player's `stop`); what was still to come is never asked for. */
  stop: () => void;
}

/** How long a reading waits after a line, in milliseconds, before the next:
 *  the setting applied to how long this line ran and how long the next one
 *  will. Either length may be unknown — null — where nothing measured it,
 *  and counts as nothing then: a fixed pause never needs them, and an echo
 *  of a line nobody could time is an echo of the other line. Never negative,
 *  whatever a stored setting says. */
export function pauseAfter(
  gap: FormGap | null | undefined, previousMs: number | null, nextMs: number | null,
): number {
  if (!gap || gap.mode !== 'echo') {
    const ms = gap?.ms;
    return typeof ms === 'number' && ms > 0 ? ms : 0;
  }
  return Math.max(previousMs ?? 0, nextMs ?? 0, 0);
}

/** How long to wait after a line, given how long it ran (null where nothing
 *  measured it) and the line that follows. It may take its time: the next
 *  line's length is its clip's, so asking is waiting for the clip — which
 *  is time the reading counts as part of the pause, not on top of it. */
export type PauseRule = (previousMs: number | null, next: SpokenLine) => number | Promise<number>;

/** The reading's own default: no pause, and nothing asked about the next
 *  line. */
export const NO_PAUSE: PauseRule = () => 0;

/** The setting as a pause rule, over a way of finding how long a line's clip
 *  runs — the voice queue's, which waits for the clip if it is still being
 *  made, and knows nothing (null) of a line the browser's own voice will
 *  say. Asked for every line, whatever the setting: a clip waited for here
 *  is one the pause absorbs, and one the next play finds ready. */
export function pauseRule(
  gap: FormGap | null | undefined, lengthOf: (line: SpokenLine) => Promise<number | null>,
): PauseRule {
  return async (previousMs, next) => pauseAfter(gap, previousMs, await lengthOf(next));
}

/** Say these lines one after another: each starts when the last has finished,
 *  never before, because six voices at once is what pointing along a column
 *  used to do and the whole point of a reading is to hear them in turn.
 *
 *  `say` is one line, resolving how long it ran in milliseconds, or null when
 *  it was not heard; it is a parameter so the order can be tested without a
 *  speaker, and so this file stays free of the player it is said through.
 *  `onLine` hears each line as it starts and null when the reading is over,
 *  however it ended. A line nothing could sound — no clip, no voice — ends
 *  the reading: a device that cannot say the first person cannot say the
 *  sixth, and a button that sits through six silent turns is a button that
 *  did nothing.
 *
 *  Between two lines the reading waits for as long as `pause` says, and not
 *  at all by default: the pause is the learner's setting, and the seconds
 *  that once sat there uninvited were the next clip being made (#60). A
 *  pause is counted from the moment the line ended, so whatever `pause`
 *  itself waited on — the next clip — is part of it. The line just said
 *  stays marked through the pause: it is the one to say back.
 */
export function readInTurn(
  lines: readonly SpokenLine[],
  say: (line: SpokenLine) => Promise<number | null>,
  onLine: (line: SpokenLine | null) => void = () => {},
  pause: PauseRule = NO_PAUSE,
): Reading {
  let stopped = false;
  let wake: (() => void) | null = null;
  /* A wait that `stop` can cut short, so a stopped reading is over now and
     not when its pause runs out. */
  const wait = (ms: number): Promise<void> => new Promise((resolve) => {
    const timer = setTimeout(() => { wake = null; resolve(); }, ms);
    wake = (): void => { clearTimeout(timer); wake = null; resolve(); };
  });
  const done = (async (): Promise<boolean> => {
    try {
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        if (stopped) return false;
        onLine(line);
        let ranMs: number | null = null;
        try {
          ranMs = await say(line);
        } catch {
          ranMs = null;                /* a line that throws is one that did not sound */
        }
        if (stopped || ranMs === null) return false;
        const next = lines[i + 1];
        if (!next) break;
        const ended = nowMs();
        let gap = 0;
        try {
          gap = await pause(ranMs, next);
        } catch {
          gap = 0;                     /* a pause that cannot be worked out is none */
        }
        if (stopped) return false;
        const left = gap - (nowMs() - ended);
        if (left > 0) await wait(left);
      }
      return true;
    } finally {
      onLine(null);
    }
  })();
  return {
    done,
    stop(): void { stopped = true; wake?.(); },
  };
}

/** The tense every learner meets first, and the only one prepared for a verb
 *  merely sitting in the queue: six clips a verb rather than forty. */
export const FIRST_TENSES: readonly string[] = ['pres'];

/** Every line of a verb's table worth saying, or only those of the tenses
 *  named.
 *
 *  Nothing prepares a whole table off its own bat: forty clips is a couple of
 *  minutes of a phone's attention, and nobody hovers over the past historic.
 *  The tenses on screen are made when the table is opened, the rest when they
 *  are hovered — which is what the lazy setting makes the rule for everything.
 */
export function phrasesOf(
  key: string, conj: Conjugation | null | undefined, tenses?: readonly string[],
): Phrase[] {
  const groups = conj?.groups ?? [];
  return groups
    .filter((g) => !tenses || tenses.includes(g.id))
    .flatMap((g) => phrasesOfGroup(key, g));
}
