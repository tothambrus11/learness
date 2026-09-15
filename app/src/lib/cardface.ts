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
import type { Rung } from './keys.js';
import type { Example, Gender, GrammaticalNumber, StudyWord } from './model.js';
import type { StudyItem } from './queue.js';

/** The English prompt for a word: the short cue the catalogue ships, else the
 *  first translation, cut at the first semicolon — "day; daytime" is one cue,
 *  not two. */
export const cueOf = (word: StudyWord): string =>
  word.cue ?? (word.en[0] ?? '').split(';')[0]!.trim();

/** Which of the word's example sentences this card is about, or -1 for a word
 *  with none.
 *
 *  Chosen from the card's own rep count rather than at random, so looking back
 *  at a card shows the sentence you were actually asked, and a word met again
 *  next week is asked about a different one. */
export function sentenceAt(item: StudyItem | null | undefined): number {
  const ex = item?.word?.ex;
  if (!item || !ex?.length) return -1;
  return item.card.reps % ex.length;
}

/** The example sentence this card is about, or null. */
export function sentenceFor(item: StudyItem | null | undefined): Example | null {
  const at = sentenceAt(item);
  return at < 0 ? null : item?.word.ex?.[at] ?? null;
}

/** The sentence with its word taken out, as the text before and after the gap.
 *
 *  The form in the sentence is what is removed — "il s'agit" for "agir" — and
 *  it is matched on a letter boundary so that "l'an" does not blank the "an"
 *  inside "dans". A sentence whose form cannot be found comes back whole,
 *  which shows the learner a sentence rather than an empty card. */
export function blank(sentence: Example): { before: string; after: string } {
  const re = new RegExp(
    `(^|[^\\p{L}])(${sentence.f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}])`, 'iu');
  const m = re.exec(sentence.fr);
  if (!m) return { before: sentence.fr, after: '' };
  const at = m.index + (m[1] ?? '').length;
  return {
    before: sentence.fr.slice(0, at),
    after: sentence.fr.slice(at + (m[2] ?? '').length),
  };
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
  icon: 'eye' | 'mic' | 'keyboard' | 'ear' | 'pen';
  verb: string;
}

const TASK: Record<Rung, Task> = {
  recognise: { from: 'fr', heard: false, icon: 'eye', verb: 'Read it, recall the English', to: 'en' },
  say: { from: 'en', heard: false, icon: 'mic', verb: 'Say it in French, then check', to: 'fr' },
  write: { from: 'en', heard: false, icon: 'keyboard', verb: 'Type the French, then say it', to: 'fr' },
  hear: { from: 'fr', heard: true, icon: 'ear', verb: 'Listen, recall the English', to: 'en' },
  dictate: { from: 'fr', heard: true, icon: 'keyboard', verb: 'Listen, type what you heard', to: 'fr' },
  use: { from: 'fr', heard: false, icon: 'pen', verb: 'Fill the gap in the sentence', to: 'fr' },
};

export const taskOf = (rung: Rung): Task => TASK[rung];

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
  | { kind: 'wrote'; text: string };

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
export function face(item: StudyItem, { revealed, typed = '', verdict = null }: FaceState): Line[] {
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

  const sentence = rung === 'use' ? sentenceFor(item) : null;
  if (sentence) {
    /* A real sentence with the word taken out; the English says what it
       means, and the word's own meaning sits beside it. */
    const gap = blank(sentence);
    line({ kind: 'sentence', before: gap.before, gap: revealed ? sentence.f : '', after: gap.after,
      filled: revealed });
    line({ kind: 'hint', text: sentence.en });
    line({ kind: 'alts', text: `${english}${revealed && gender ? ` · ${gender}` : ''}` });
    if (!revealed) line({ kind: 'box', placeholder: 'the missing word' });
    else { line(judged()); line(answerFr()); line(ipa()); line(wrote()); }
    return lines;
  }

  switch (rung) {
    case 'recognise':
      line({ kind: 'prompt-fr', text: w.fr, gender, number, small: false });
      if (revealed) { line(ipa()); line(answerEn()); line(alts()); }
      break;
    case 'say':
      /* The whole first translation, not the short cue the walk reads out:
         "bug; insect" says which bug, and the answer has to be produced. */
      line({ kind: 'prompt-en', text: english });
      line(posHint());
      if (!revealed) line({ kind: 'status', text: 'Say it in French, then' });
      else { line(answerFr()); line(ipa()); }
      break;
    case 'hear':
      /* The way to hear it again has to be on the card before the flip, not
         in the row of chips that only appears after it. */
      line({ kind: 'speaker' });
      if (revealed) {
        line({ kind: 'prompt-fr', text: w.fr, gender, number, small: true });
        line(ipa()); line(answerEn()); line(alts());
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
        line(judged()); line(answerFr()); line(ipa()); line(answerEn()); line(alts()); line(wrote());
      }
      break;
    default:
      /* write, and a "use it" card whose word has no sentence. */
      line({ kind: 'prompt-en', text: english });
      line(posHint());
      if (!revealed) line({ kind: 'box', placeholder: 'type the French' });
      else { line(judged()); line(answerFr()); line(ipa()); line(wrote()); }
  }
  return lines;
}
