/** One grammar exercise, generated: what it shows, what it expects, and
 *  what each part is evidence about (GRAMMAR.md, "Rules, items, and
 *  instances").
 *
 *  An instance is made by a generator from a spec — a verb and a tense, a
 *  number — and dealt in the sitting among the word cards. It is never
 *  stored: the attempt it becomes is (model.ts Attempt), and it carries the
 *  answer key with it, so a catalogue rebuild cannot make an old right
 *  answer wrong. What a wrong cell says about each rule is decided here,
 *  once, from the cell's own parts: a form is a stem and an ending, and
 *  which of them is missing is which rule was misapplied; a number is its
 *  words, and which of them is missing is which rule was.
 */
import { checkCloze, norm } from '../check.js';
import type { AttemptPart, Example } from '../model.js';
import type { Face, RuleId } from './rules.js';

/** What one label of a cell is evidence about: the whole form, or the stem
 *  or the ending alone. A wrong cell with the ending right is the stem's
 *  rule (or the verb's own irregularity) wrong, not the ending's. */
export interface Obs {
  /** A rule id, or an item ref (grammar/grade.ts `itemRef`). */
  of: string;
  /** `token`: judged on the cell's tokens this rule produced (`Cell.tokens`),
   *  each of which must be among the words typed. */
  on: 'form' | 'stem' | 'ending' | 'token';
}

/** One box of an exercise: what stands before it, what it expects, and
 *  what it observes. */
export interface Cell {
  /** "je", "nous", "281". */
  prompt: string;
  /** The answer key, as the generator made it. */
  expected: string;
  /** Accepted variants of the same answer: "je paye" or "je paie". */
  also?: string[];
  /** A cell answered by tapping one of these rather than typing: the
   *  *choose* and *which* faces. `expected` is one of them. */
  options?: string[];
  /** A cell answered by tapping these in order (the *order* face, the
   *  answer being `joinPieces` of them in the right order) or by tapping
   *  every one that applies (`multi`, the *mark* face, the answer being
   *  `markPieces` of the right ones). Shown in the order given, which the
   *  generator has already shuffled by its seed. */
  pieces?: string[];
  multi?: boolean;
  /** A cell answered aloud (the *say* face): nothing is typed, the model
   *  is shown and heard after the flip, and the learner says whether it
   *  came out right — the same self-judgement the voice card asks. */
  say?: boolean;
  /** The form's parts, where the answer has them; what `on` refers to. */
  stem?: string;
  ending?: string;
  /** The answer's words and the rules that put each there, for a cell
   *  judged token by token: a number. */
  tokens?: { text: string; of: string[] }[];
  obs: Obs[];
}

export interface Instance {
  /** The identity for breadth: `table:parler|verb:pres`,
   *  `sentence:parler|verb:1001:G.pas`. */
  id: string;
  /** The generator, as a string, as the attempt records it. */
  gen: string;
  face: Face;
  /** What the generator was given; the attempt keeps it for re-labelling. */
  spec: unknown;
  /** The version of the generator's analyser that labelled the cells. */
  genv: number;
  /** The rule this instance is dealt for; the card it comes back for. */
  rule: RuleId;
  /** What the card says it is about: "parler · Présent". */
  title: string;
  /** One line under the title: the verb's English, the tense's use. */
  hint: string;
  cells: Cell[];
  /** On a sentence exercise: the sentence the learner is asked to change,
   *  shown on the card with the verb marked. */
  sentence?: Example;
  /** What the exercise says aloud, where it says anything: the model after
   *  the flip on a *say* face, the question before it on a *hear* face, and
   *  the answer once a written number is checked — every flip ends in the
   *  French said aloud (#95). Absent on an exercise nothing says: a table
   *  of six forms, a sentence rewritten. Kept under `key` and `slot` like a
   *  word's phrases (voicequeue.ts), so the second hearing is instant, and
   *  made ahead of the flip with them (#96). */
  speech?: Speech;
}

export interface Speech {
  key: string;
  slot: string;
  text: string;
  kind: 'form' | 'sentence' | 'word';
}

/** Where an exercise's clip is kept: one key for the grammar's, the
 *  exercise as the slot. */
export const speechOf = (id: string, text: string, kind: Speech['kind'] = 'form'): Speech =>
  ({ key: 'grammar|speech', slot: id, text, kind });

/** What is the same answer whatever the keyboard did: straight and curly
 *  apostrophes, the space before a French *?* or *!*, the full stop at the
 *  end, and how many spaces stand between words. */
export const loose = (s: string): string => s
  .replace(/[’‘]/g, "'")
  .replace(/\s+([?!:;])/g, '$1')
  .replace(/[.…]+\s*$/, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Whether what was typed is the cell's form: on the letter, accents and
 *  all, since an ending is a letter or two and *parle* and *parlé* are
 *  different forms. Case is forgiven, as everywhere, and so is the shape
 *  of an apostrophe or a full stop left off a sentence (`loose`). */
export const cellRight = (cell: Pick<Cell, 'expected' | 'also'>, typed: string): boolean =>
  [cell.expected, ...(cell.also ?? [])].some((f) =>
    /* On the letter first — the checker folds digits away, and a number
       heard is answered in figures — then the checker's own strict grade. */
    loose(typed).toLowerCase() === loose(f).toLowerCase()
    || checkCloze(loose(typed), loose(f), { strict: true }).verdict === 'ok');

/** Judge every cell, and label what each says.
 *
 *  A right cell is right about everything it observes. A wrong one is wrong
 *  about the whole form; about the ending only where the ending is not
 *  there, and about the stem only where the stem is not — so *parlent* for
 *  *parlons* is the ending rule wrong and the stem right, and nothing about
 *  the stem's rule is shortened by it. A cell left empty is wrong about
 *  everything. */
export function answerCells(instance: Pick<Instance, 'cells'>, typed: readonly string[]): AttemptPart[] {
  return instance.cells.map((cell, i) => {
    const got = typed[i] ?? '';
    const ok = cellRight(cell, got);
    const g = norm(got);
    const has = (part: string | undefined, where: 'start' | 'end'): boolean =>
      !!g && !!part && (where === 'end' ? g.endsWith(norm(part)) : g.startsWith(norm(part)));
    /* The words typed, however they were joined: a token a rule produced
       is right if it is among them. */
    const typedWords = new Set(g.split(/[\s-]+/).filter(Boolean));
    const tokensRight = (rule: string): boolean => {
      const mine = (cell.tokens ?? []).filter((t) => t.of.includes(rule));
      return mine.length > 0 && mine.every((t) => typedWords.has(norm(t.text)));
    };
    const judge = (o: Obs): boolean => {
      if (ok) return true;
      switch (o.on) {
        case 'ending': return has(cell.ending, 'end');
        case 'stem': return has(cell.stem, 'start');
        case 'token': return tokensRight(o.of);
        default: return false;
      }
    };
    return {
      expected: cell.expected, got, ok,
      obs: cell.obs.map((o) => ({ of: o.of, ok: judge(o) })),
    };
  });
}

/** Pieces put in order, as one string: a space between words, none after
 *  an apostrophe (*n'ai*). The one join the generator and the card share,
 *  so the key and the answer are made the same way. */
export const joinPieces = (pieces: readonly string[]): string =>
  pieces.reduce((out, piece) => (out === '' || /['’]$/.test(out) ? `${out}${piece}` : `${out} ${piece}`), '');

/** The pieces marked, as one string in the pieces' own order, so the same
 *  set is the same answer whatever order it was tapped in. */
export const markPieces = (pieces: readonly string[], marked: readonly string[]): string =>
  pieces.filter((p) => marked.includes(p)).join(' · ');

/** Every cell right. */
export const allRight = (parts: readonly Pick<AttemptPart, 'ok'>[]): boolean => parts.every((p) => p.ok);
