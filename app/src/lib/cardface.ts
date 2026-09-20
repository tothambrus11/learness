/** What is on a card, whichever card it is.
 *
 *  These are the decisions the study screen used to make inside its own
 *  template: which of a word's sentences this card blanks, where the blank
 *  falls in it, which English cue to read out, and which of the word's senses
 *  are worth printing under an answer that already says one of them.
 *
 *  They live here because they are the same answers for the card you are
 *  looking at and for the card you answered ten minutes ago. A card you look
 *  back at once showed less than it did when it was live — the verb's forms
 *  were missing — because "what the card shows" was written inside the branch
 *  that draws the grading buttons, and only the live card has those. Nothing
 *  here can tell the two apart: every function takes the card, and that is
 *  all it takes.
 */
import type { Check, Verdict } from './check.js';
import { CORE_TENSES, conjSlot, spokenForm, spokenLead } from './conjspeech.js';
import { pickableTenses, splitOnForm, standsIn, untimed, TENSE_PICK } from './examples.js';
import type { PickedTense } from './examples.js';
import { HEARD_FIRST, PHRASED, SAY_ALOUD, lemmaOf } from './keys.js';
import type { Rung } from './keys.js';
import type {
  AttemptPart, ConjugationGroup, ConjugationRow, Example, Gender, GrammaticalNumber, StudyWord,
} from './model.js';
import type { Face } from './grammar/rules.js';
import { rungOf } from './queue.js';
import type { RuleItem, StudyItem, WordItem } from './queue.js';
import { sentenceSlot } from './tts.js';
import { TENSE_NOTES, TIME_MEANING } from './tenses.js';

/** The English prompt for a word: the short cue the catalogue ships, else the
 *  first translation, cut at the first semicolon — "day; daytime" is one cue,
 *  not two. */
/** A sitting's item as a word item, or null for a rule item: what every
 *  reader of a word's card narrows on first. */
const asWord = (item: StudyItem | null | undefined): WordItem | null =>
  (item?.kind === 'word' ? item : null);

export const cueOf = (word: StudyWord): string =>
  word.cue ?? (word.en[0] ?? '').split(';')[0]!.trim();

/** Which of the word's example sentences this card is about, or -1 for a word
 *  with none it can use.
 *
 *  Chosen from the card's own rep count rather than at random, so looking back
 *  at a card shows the sentence you were actually asked, and a word met again
 *  next week is asked about a different one. A sentence the word does not
 *  stand alone in — "Peut-être pas." for être — is not in the rotation at all:
 *  it was dealt once, with the gap in the middle of *peut-être* (#39). */
export function sentenceAt(item: StudyItem | null | undefined): number {
  const it = asWord(item);
  const ex = it?.word.ex;
  if (!it || !ex?.length) return -1;
  const usable = ex.map((e, i) => (standsIn(e) ? i : -1)).filter((i) => i >= 0);
  if (!usable.length) return -1;
  return usable[it.card.reps % usable.length]!;
}

/** The example sentence this card is about, or null. */
export function sentenceFor(item: StudyItem | null | undefined): Example | null {
  const at = sentenceAt(item);
  return at < 0 ? null : asWord(item)?.word.ex?.[at] ?? null;
}

/** The sentence with its word taken out, as the text before and after the gap.
 *
 *  The form in the sentence is what is removed — "il s'agit" for "agir" — and
 *  it is found the one way a form is found anywhere in the app, `findForm`:
 *  on a letter boundary, so "l'an" does not blank the "an" inside "dans", and
 *  never after a hyphen joined to a letter, so "Peut-être" is not "être"
 *  (#39). A sentence whose form cannot be found comes back whole, which shows
 *  the learner a sentence rather than an empty card — and `sentenceAt` no
 *  longer deals one. */
export function blank(sentence: Example): { before: string; after: string } {
  const [before, found, after] = splitOnForm(sentence.fr, sentence.f);
  return found ? { before, after } : { before: sentence.fr, after: '' };
}

/** The English senses worth adding to what the card already shows.
 *
 *  What the catalogue files under def.en are the word's translations in full,
 *  not definitions — English Wiktionary glosses a French word rather than
 *  defining it, which is why the French side reads like a dictionary and this
 *  one reads like a phrasebook. Printing all of them under "Definition" meant
 *  most cards repeated their own answer back, so the one already printed as
 *  the answer is dropped and what is left is called what it is.
 *
 *  def.en holds the first few translations unshortened and word.en holds all
 *  of them shortened, so taking the full ones first and then whatever else is
 *  left gives the longest form of every sense the word has.
 */
export function senses(word: StudyWord | null | undefined): string[] {
  const primary = (word?.en?.[0] ?? '').toLowerCase().trim();
  const seen = new Set<string>(primary ? [primary] : []);
  const out: string[] = [];
  for (const line of [...(word?.def?.en ?? []), ...(word?.en ?? [])]) {
    const text = line.replace(/\s+([,;])/g, '$1').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/* ------------------------------------------------------------ meeting -- */

/** The sentence a function word is met in: the first that is long enough to
 *  be a scene — six words, so "Demande à Alex." is not the whole of *à* —
 *  else the first there is. Not the rep-counted one: the meeting is meant to
 *  be the same every time it is looked back at. */
export function anchorFor(word: Pick<StudyWord, 'ex'> | null | undefined): Example | null {
  const ex = word?.ex ?? [];
  return ex.find((e) => e.fr.split(/\s+/).length >= 6) ?? ex[0] ?? null;
}

/* ------------------------------------------------------------- choice -- */

/** What a tap card offers: the options in the order they are shown, and the
 *  one that is right. */
export interface Choice {
  options: string[];
  answer: string;
}

/** A permutation of `n` fixed by `seed`, so that the same card shows its
 *  buttons in the same places when it is looked back at, and in different
 *  places the next time it is dealt. A shuffle from Math.random did neither. */
export function orderedBy(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  let x = (seed * 2654435761 + 12345) >>> 0;
  for (let i = n - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The choose card: the gap's word among the words it is confused with.
 *
 *  The options are the word and its contrast partners, by their spelling —
 *  a partner's key is "sous|prep", and the button says "sous" — in an order
 *  that the card's rep count fixes. Null for a word with no partners or no
 *  sentence, which is a word that should never have reached this rung. */
export function choiceFor(item: StudyItem | null | undefined): Choice | null {
  const it = asWord(item);
  const sentence = sentenceFor(it);
  const partners = it?.word.contrast ?? [];
  if (!it || !sentence || !partners.length) return null;
  const all = [sentence.f, ...partners.map((k) => lemmaOf(k))];
  const order = orderedBy(all.length, it.card.reps);
  return { options: order.map((i) => all[i]!), answer: sentence.f };
}

/* -------------------------------------------------------- which time -- */

/** The which-time card: one sentence in one of the tenses the verb can be
 *  asked about, and the three times to choose from. */
export interface TensePick {
  tense: PickedTense;
  example: Example;
  /** The sentence's place in the verb's list for that tense as the catalogue
   *  ships it — the timed ones counted too, so the number does not move when
   *  the time-word filter changes. With the tense it names the clip: the tense
   *  alone did not, and the first sentence's clip played under the second
   *  (#76). */
  index: number;
  options: { tense: PickedTense; label: string }[];
  /** The tense's French name, for the back of the card. */
  name: string;
}

/** The tense rotates with the rep count and the sentence with what is left
 *  of it, so a verb met three times has been asked about each of its tenses
 *  once, in the sentence for that tense that the last time did not use. Only
 *  sentences that carry no time word are dealt: the ending has to be the clue.
 *  Null for a verb with fewer than two tenses to tell apart. */
export function tenseFor(item: StudyItem | null | undefined): TensePick | null {
  const it = asWord(item);
  const conj = it?.word.conj;
  const tenses = pickableTenses(conj, it?.tenses);
  if (!it || !conj || tenses.length < 2) return null;
  const reps = it.card.reps;
  const tense = tenses[reps % tenses.length]!;
  const shipped = conj.examples[tense] ?? [];
  const pool = untimed(shipped);
  const example = pool[Math.floor(reps / tenses.length) % pool.length];
  if (!example) return null;
  return {
    tense,
    example,
    index: shipped.indexOf(example),
    options: TENSE_PICK.map((t) => ({ tense: t, label: TIME_MEANING[t] ?? t })),
    name: TENSE_NOTES[tense]?.name ?? tense,
  };
}

/* --------------------------------------------------------------- line -- */

/** The voice card: one line of the verb's table to say from its pronoun and
 *  its tense. */
export interface TableLine {
  group: ConjugationGroup;
  row: ConjugationRow;
  /** The row's place in its tense; with the tense it names the clip. */
  index: number;
  slot: string;
  /** What is said: the pronoun and the form, "je partirai". */
  text: string;
  /** The tense's French name. */
  name: string;
}

/** The tense rotates with the rep count and the row with what is left of it,
 *  over the tenses the learner has opened (`item.tenses`) among those a
 *  learner meets first; the literary ones are read, never said. A row with
 *  no form — a cell the table leaves blank — is skipped. Null for a verb
 *  with no table, or none in an open tense, which the sitting never deals
 *  here (ladder.ts `askable`). */
export function lineFor(item: StudyItem | null | undefined): TableLine | null {
  const it = asWord(item);
  const asked = it?.tenses;
  const groups = (it?.word.conj?.groups ?? [])
    .filter((g) => CORE_TENSES.includes(g.id) && (!asked || asked.includes(g.id))
      && g.rows.some((r) => !!r.f));
  if (!it || !groups.length) return null;
  const reps = it.card.reps;
  const group = groups[reps % groups.length]!;
  const rows = group.rows.map((row, index) => ({ row, index })).filter((r) => !!r.row.f);
  const { row, index } = rows[Math.floor(reps / groups.length) % rows.length]!;
  return {
    group, row, index,
    slot: conjSlot(group.id, index),
    text: spokenForm(row),
    name: TENSE_NOTES[group.id]?.name ?? group.tense,
  };
}

/** What a card says aloud, when it is about more than a word: the sentence on
 *  a card about a sentence, the line on a card about a form — and where the
 *  clip of it is kept, so the second hearing does not wait. Null for a card
 *  whose French is the word itself. */
export function phraseFor(item: StudyItem | null | undefined): { slot: string; text: string } | null {
  if (item?.kind !== 'word') return null;
  switch (item.card.rung) {
    case 'use': case 'fill': case 'choose': {
      const s = sentenceFor(item);
      return s ? { slot: sentenceSlot(sentenceAt(item)), text: s.fr } : null;
    }
    case 'meet': {
      const a = anchorFor(item.word);
      return a ? { slot: 'meet', text: a.fr } : null;
    }
    case 'tense': {
      /* The sentence, not only the tense. A tense has several sentences and
         the card deals them in turn, but the voice queue tells one job from
         another by the slot alone, so under "time:pc" the second sentence
         joined the first one's job and the first one's clip was heard (#76). */
      const t = tenseFor(item);
      return t ? { slot: `time:${t.tense}:${t.index}`, text: t.example.fr } : null;
    }
    case 'voice': {
      const l = lineFor(item);
      return l ? { slot: l.slot, text: l.text } : null;
    }
    default: return null;
  }
}

/** The right answer on a card answered by tapping: the word for the gap, or
 *  the time the form means. Null on any other card. */
export function answerOf(item: StudyItem | null | undefined): string | null {
  const rung = rungOf(item);
  if (rung === 'choose') return choiceFor(item)?.answer ?? null;
  if (rung === 'tense') return tenseFor(item)?.tense ?? null;
  return null;
}

/* ------------------------------------------------------------- the face -- */

/** What each rung asks, at a glance: which language the question is in,
 *  whether it is read or heard, what you do, and which language the answer
 *  is in. The card can look the same across rungs — an English word on top —
 *  while asking for something different, so this is said in pictures before
 *  the word is read. The icon is named here and drawn by the component. */
export interface Task {
  from: 'fr' | 'en';
  to: 'fr' | 'en';
  heard: boolean;
  icon: 'eye' | 'mic' | 'keyboard' | 'ear' | 'pen' | 'book' | 'pointer' | 'clock';
  verb: string;
}

const TASK: Record<Rung, Task> = {
  recognise: { from: 'fr', heard: false, icon: 'eye', verb: 'Read it, recall the English', to: 'en' },
  say: { from: 'en', heard: false, icon: 'mic', verb: 'Say it in French, then check', to: 'fr' },
  write: { from: 'en', heard: false, icon: 'keyboard', verb: 'Type the French, then say it', to: 'fr' },
  hear: { from: 'fr', heard: true, icon: 'ear', verb: 'Listen, recall the English', to: 'en' },
  dictate: { from: 'fr', heard: true, icon: 'keyboard', verb: 'Listen, type what you heard', to: 'fr' },
  use: { from: 'fr', heard: false, icon: 'pen', verb: 'Fill the gap in the sentence', to: 'fr' },
  meet: { from: 'fr', heard: false, icon: 'book', verb: 'Meet it in a sentence', to: 'en' },
  choose: { from: 'fr', heard: false, icon: 'pointer', verb: 'Tap the word for the gap', to: 'fr' },
  fill: { from: 'fr', heard: false, icon: 'pen', verb: 'Fill the gap in the sentence', to: 'fr' },
  tense: { from: 'fr', heard: false, icon: 'clock', verb: 'Read the form: when is it?', to: 'en' },
  voice: { from: 'en', heard: false, icon: 'mic', verb: 'Say the form, then check', to: 'fr' },
};

export const taskOf = (rung: Rung): Task => TASK[rung];

/** A grammar exercise's task, by its face: French in, French out, typed. */
const DRILL_TASK: Partial<Record<Face, Task>> = {
  gap: { from: 'fr', heard: false, icon: 'pen', verb: 'Fill in the forms', to: 'fr' },
  transform: { from: 'fr', heard: false, icon: 'pen', verb: 'Rewrite the sentence', to: 'fr' },
};
const ANY_DRILL: Task = { from: 'fr', heard: false, icon: 'pen', verb: 'Grammar', to: 'fr' };

/** What an item asks, at a glance: the rung's task for a word, the face's
 *  for a rule. */
export const taskFor = (item: StudyItem): Task =>
  (item.kind === 'word' ? TASK[item.card.rung] : DRILL_TASK[item.instance.face] ?? ANY_DRILL);

/** What the button that plays the model says on a turned card — the sentence
 *  on a card about a sentence, the form on a card about a form, the word
 *  otherwise — or null on a card asked by ear, whose face already carries the
 *  speaker, face down and face up. The back of a listening card used to have
 *  both: "Play it again" over the answer and "Hear again" under it, the same
 *  sound and the same key beside each. One action, one button (#63). */
export const modelLabel = (rung: Rung): string | null =>
  HEARD_FIRST.has(rung) ? null
    : rung === 'voice' ? 'Hear the form'
      : PHRASED.has(rung) ? 'Hear the sentence' : 'Hear again';

/** What the live card asks of the learner once it is turned, on a rung whose
 *  answer was produced in silence: say it too, and hear the model again to
 *  compare. Null on every other rung — one that asked for the voice already,
 *  or whose question was the sound.
 *
 *  A sentence and not a button. The aid used to carry its own "hear the
 *  sentence again", a hand's width under the card's "Hear the sentence", with
 *  the same key drawn beside both (#63). The button is the card's; this says
 *  what to do with it. */
export const sayAloud = (rung: Rung): string | null =>
  SAY_ALOUD.has(rung)
    ? `Say it aloud too, then hear ${PHRASED.has(rung) ? 'the sentence' : 'it'} again to compare.`
    : null;

/** One line of a card, in the order the card shows them. The component draws
 *  each kind one way and decides nothing else; what is on the card, and in
 *  what order, is `face`'s answer. */
export type Line =
  /** The French, painted with its gender, as the question. */
  | { kind: 'prompt-fr'; text: string; gender: Gender; number: GrammaticalNumber; small: boolean }
  /** The English as the question. */
  | { kind: 'prompt-en'; text: string }
  /** A sentence with the word taken out, or put back once turned. */
  | { kind: 'sentence'; before: string; gap: string; after: string; filled: boolean }
  /** The French is the question, and it is heard: the way to hear it again. */
  | { kind: 'speaker' }
  /** Under the question: the part of speech, and the gender once it is no
   *  longer the answer; the sentence's meaning on a "use it" card. */
  | { kind: 'hint'; text: string }
  /** What to do now, on a card answered aloud. */
  | { kind: 'status'; text: string }
  /** The answer box. */
  | { kind: 'box'; placeholder: string }
  /** How the typed answer was judged. */
  | { kind: 'verdict'; text: string; ok: boolean }
  /** The French, painted, as the answer. */
  | { kind: 'answer-fr'; text: string; gender: Gender; number: GrammaticalNumber }
  | { kind: 'ipa'; text: string }
  /** The English as the answer. */
  | { kind: 'answer-en'; text: string }
  /** The other translations, or a meaning beside the answer. */
  | { kind: 'alts'; text: string }
  /** What was typed, where it was not right. */
  | { kind: 'wrote'; text: string }
  /** A function word's core sense: one line of prose, the picture its other
   *  senses grow out of. */
  | { kind: 'sense'; text: string }
  /** A sentence with the word marked in it rather than taken out. */
  | { kind: 'marked'; before: string; mark: string; after: string }
  /** The options of a tap card, each with whether it has been tapped and
   *  found wrong. */
  | { kind: 'options'; options: { text: string; value: string; wrong: boolean }[]; column: boolean }
  /** A form of a verb as the answer, split so the ending stands out; `lead`
   *  is the pronoun, "je " or "j'". */
  | { kind: 'form'; lead: string; stem: string; ending: string; also: string }
  /** What was tapped first, where it was not right. */
  | { kind: 'tapped'; text: string }
  /** The prepositions the word governs, with what each chunk means: on the
   *  back of every card of a word that has any, since the chunk is what
   *  there is to learn about *à* and *de*. */
  | { kind: 'chunks'; items: { fr: string; en: string }[] }
  /** The cells of a grammar exercise, one row each: the prompt and a box
   *  before the check; after it, what was typed, whether it was right, and
   *  the form. */
  | { kind: 'column'; cells: { prompt: string; expected: string; got?: string; ok?: boolean }[] };

const VERDICT_TEXT: Record<Verdict, string> = {
  ok: 'Correct',
  accent: 'Right, mind the accents',
  article: 'Right, mind the article',
  close: 'Almost, a typo',
  no: 'Not quite',
};

/** The sitting's part of what the card shows: which way up it is, and what
 *  was typed into it and how that was judged. */
export interface FaceState {
  revealed: boolean;
  typed?: string;
  verdict?: Check | null;
  /** On a tap card: what has been tapped, in order. The first is graded. */
  picked?: readonly string[];
  /** On a rule item, once checked: every cell as answered. */
  parts?: readonly AttemptPart[];
}

/** A grammar exercise, as lines: what it is about, then its cells — the
 *  boxes before the check, each cell's verdict and form after it. */
function ruleFace(item: RuleItem, revealed: boolean, parts: readonly AttemptPart[]): Line[] {
  const { instance } = item;
  const lines: Line[] = [{ kind: 'prompt-en', text: instance.title }];
  if (instance.sentence) {
    /* The sentence to change, its verb marked: what the rule acts on. */
    const [before, mark, after] = splitOnForm(instance.sentence.fr, instance.sentence.f);
    lines.push({ kind: 'marked', before, mark, after });
  }
  lines.push({ kind: 'hint', text: instance.hint });
  if (!revealed) {
    lines.push({ kind: 'column', cells: instance.cells.map((c) => ({ prompt: c.prompt, expected: c.expected })) });
    return lines;
  }
  const right = parts.filter((p) => p.ok).length;
  lines.push({
    kind: 'verdict', ok: right === parts.length,
    text: right === parts.length ? 'All right' : `${right} of ${parts.length} right`,
  });
  lines.push({ kind: 'column', cells: instance.cells.map((c, i) => {
    const p = parts[i];
    const cell: { prompt: string; expected: string; got?: string; ok?: boolean } =
      { prompt: c.prompt, expected: c.expected };
    if (p) { cell.got = p.got; cell.ok = p.ok; }
    return cell;
  }) });
  return lines;
}

/** Everything on the card, as lines, for this card in this state.
 *
 *  The one place that decides what a card shows. It used to be a six-way
 *  branch in the template, and each branch decided for itself: dictation
 *  showed the spelling and never the meaning (#28), a card looked back at
 *  lost its verb table (#30), and nothing but a person would have noticed.
 *  The rules, which `tests/cardface.test.ts` checks over every rung in both
 *  states:
 *
 *  - a turned card shows the French, its IPA and the English, whatever it
 *    asked; where the English is the answer the other translations too;
 *  - nothing that is the answer appears before the flip — the French and
 *    the gender on a card that asks for the French, the English on one that
 *    asks for the English;
 *  - a card whose question is heard has the speaker on it, in both states;
 *  - a typed card has the box before the flip and the verdict after.
 */
export function face(
  item: StudyItem, { revealed, typed = '', verdict = null, picked = [], parts = [] }: FaceState,
): Line[] {
  if (item.kind === 'rule') return ruleFace(item, revealed, parts);
  const w = item.word;
  const rung = item.card.rung;
  const gender = w.gender ?? '';
  const number = w.number ?? '';
  const english = w.en[0] ?? '';
  const others = w.en.slice(1, 4).join(' · ');
  const lines: Line[] = [];
  const line = (l: Line | null): void => { if (l) lines.push(l); };
  /* The article is part of the answer, so the gender waits for the reveal. */
  const posHint = (): Line => ({ kind: 'hint', text: `${w.pos}${revealed && gender ? `, ${gender}` : ''}` });
  const answerFr = (): Line => ({ kind: 'answer-fr', text: w.answer, gender, number });
  const ipa = (): Line | null => (w.ipa ? { kind: 'ipa', text: w.ipa } : null);
  const answerEn = (): Line => ({ kind: 'answer-en', text: english });
  const alts = (): Line | null => (others ? { kind: 'alts', text: others } : null);
  const judged = (): Line => ({
    kind: 'verdict', text: verdict ? VERDICT_TEXT[verdict.verdict] : '',
    ok: !!verdict && verdict.verdict !== 'no',
  });
  const wrote = (): Line | null =>
    (typed && verdict?.verdict !== 'ok' ? { kind: 'wrote', text: typed } : null);

  const sense = (): Line | null => (w.sense ? { kind: 'sense', text: w.sense } : null);
  const chunks = (): Line | null => (w.chunks?.length ? { kind: 'chunks', items: w.chunks } : null);
  const marked = (ex: Example): Line => {
    const [before, mark, after] = splitOnForm(ex.fr, ex.f);
    return { kind: 'marked', before, mark, after };
  };
  /** What was tapped first, where it was not right — said as the option
   *  read, not as its value: "it was going on", not "imp". */
  const tapped = (answer: string, label: (v: string) => string = (v) => v): Line | null =>
    (picked[0] && picked[0] !== answer ? { kind: 'tapped', text: label(picked[0]) } : null);

  const sentence = rung === 'use' || rung === 'fill' ? sentenceFor(item) : null;
  if (sentence) {
    /* A real sentence with the word taken out; the English says what it
       means, and the word's own meaning sits beside it — for a function
       word, its sense line, which is the only meaning it has. */
    const gap = blank(sentence);
    line({ kind: 'sentence', before: gap.before, gap: revealed ? sentence.f : '', after: gap.after,
      filled: revealed });
    line({ kind: 'hint', text: sentence.en });
    if (rung === 'use') line({ kind: 'alts', text: `${english}${revealed && gender ? ` · ${gender}` : ''}` });
    if (!revealed) line({ kind: 'box', placeholder: 'the missing word' });
    else { line(judged()); line(answerFr()); line(ipa()); line(sense()); line(chunks()); line(wrote()); }
    return lines;
  }

  const choice = rung === 'choose' ? choiceFor(item) : null;
  if (choice) {
    /* The gap, and the word among the words it is confused with. A wrong tap
       is taken away and the question stands; the first tap is what was
       graded, the rest is the card teaching. */
    const s = sentenceFor(item)!;
    const gap = blank(s);
    line({ kind: 'sentence', before: gap.before, gap: revealed ? s.f : '', after: gap.after,
      filled: revealed });
    line({ kind: 'hint', text: s.en });
    if (!revealed) {
      line({ kind: 'options', column: false,
        options: choice.options.map((o) => ({ text: o, value: o, wrong: picked.includes(o) })) });
      if (picked.length) line({ kind: 'verdict', text: 'Not that one — try again', ok: false });
    } else {
      line(judged()); line(answerFr()); line(ipa()); line(sense()); line(tapped(choice.answer));
    }
    return lines;
  }

  const pick = rung === 'tense' ? tenseFor(item) : null;
  if (pick) {
    /* A sentence with no time word in it, so the ending is the only clue to
       when. Three times to choose from, said as what happened rather than
       as tense names. */
    line(marked(pick.example));
    if (!revealed) {
      line({ kind: 'hint', text: 'When is this?' });
      line({ kind: 'options', column: true,
        options: pick.options.map((o) => ({ text: o.label, value: o.tense, wrong: picked.includes(o.tense) })) });
      if (picked.length) line({ kind: 'verdict', text: 'Not that one — read the ending again', ok: false });
    } else {
      line(judged());
      line({ kind: 'answer-fr', text: pick.name, gender: '', number: '' });
      line({ kind: 'hint', text: TIME_MEANING[pick.tense] ?? pick.tense });
      /* The sentence's English is a note under the tense, not the answer:
         the answer was the time, and it is already on the card. */
      line({ kind: 'alts', text: pick.example.en });
      line(tapped(pick.tense, (v) => TIME_MEANING[v] ?? v));
    }
    return lines;
  }

  const said = rung === 'voice' ? lineFor(item) : null;
  if (said) {
    /* One line of the table, from its pronoun and its tense: said aloud
       before the flip, heard after it. The pronoun is part of the answer —
       "j'étais", not "étais" — which is why the clip says the line. */
    line({ kind: 'prompt-en', text: `${said.row.p.replace(/['’]$/, '')} · ${w.lemma}` });
    line({ kind: 'hint', text: `${said.name} · ${english}` });
    if (!revealed) line({ kind: 'status', text: 'Say the form aloud, then' });
    else {
      const lead = spokenLead(said.row);
      line(said.row.s && said.row.e
        ? { kind: 'form', lead, stem: said.row.s, ending: said.row.e, also: (said.row.also ?? []).join(', ') }
        : { kind: 'answer-fr', text: said.text, gender: '', number: '' });
    }
    return lines;
  }

  if (rung === 'meet') {
    /* A function word, met rather than asked: its core sense in one line, and
       a sentence it stands in. The English glosses wait for the flip so the
       sense line is read first — a list of glosses is what a dictionary
       gives, and it is what these words were excluded to avoid. */
    line({ kind: 'prompt-fr', text: w.fr, gender: '', number: '', small: false });
    line(ipa());
    line(sense());
    const anchor = anchorFor(w);
    if (anchor) { line(marked(anchor)); line({ kind: 'hint', text: anchor.en }); }
    if (revealed) {
      line(answerEn());
      if (others) line({ kind: 'alts', text: `also: ${others}` });
      const partners = (w.contrast ?? []).map((k) => lemmaOf(k));
      if (partners.length) line({ kind: 'alts', text: `not to be confused with ${partners.join(', ')}` });
    }
    return lines;
  }

  switch (rung) {
    case 'recognise':
      line({ kind: 'prompt-fr', text: w.fr, gender, number, small: false });
      if (revealed) { line(ipa()); line(answerEn()); line(alts()); line(chunks()); }
      break;
    case 'say':
      /* The whole first translation, not the short cue the walk reads out:
         "bug; insect" says which bug, and the answer has to be produced. */
      line({ kind: 'prompt-en', text: english });
      line(posHint());
      if (!revealed) line({ kind: 'status', text: 'Say it in French, then' });
      else { line(answerFr()); line(ipa()); line(chunks()); }
      break;
    case 'hear':
      /* The way to hear it again has to be on the card before the flip, not
         in the row of chips that only appears after it. */
      line({ kind: 'speaker' });
      if (revealed) {
        line({ kind: 'prompt-fr', text: w.fr, gender, number, small: true });
        line(ipa()); line(answerEn()); line(alts()); line(chunks());
      }
      break;
    case 'dictate':
      line({ kind: 'speaker' });
      line(posHint());
      if (!revealed) line({ kind: 'box', placeholder: 'type the French' });
      else {
        /* A card asked by ear never showed what the word meant: its question
           was a sound and its answer was the spelling, so a learner who
           wrote it down correctly still did not find out what they had
           written (#28). */
        line(judged()); line(answerFr()); line(ipa()); line(answerEn()); line(alts()); line(chunks()); line(wrote());
      }
      break;
    default:
      /* write, and a "use it" card whose word has no sentence. */
      line({ kind: 'prompt-en', text: english });
      line(posHint());
      if (!revealed) line({ kind: 'box', placeholder: 'type the French' });
      else { line(judged()); line(answerFr()); line(ipa()); line(chunks()); line(wrote()); }
  }
  return lines;
}
