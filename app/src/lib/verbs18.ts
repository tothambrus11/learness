/** Eighteen essential verbs: their present tense, their past participle, how
 *  they are said, and how an answer about them is graded.
 *
 *  This stands apart from the course on purpose. Nothing here is a card,
 *  nothing is scheduled, and nothing is written to the database: it is a
 *  page to read and a round of questions to answer, like a sheet handed out
 *  in a class. The table is written out by hand rather than read from the
 *  catalogue, so it is there whatever the catalogue teaches and whether or
 *  not it has loaded.
 *
 *  The exercises built on them are verbs18book.ts.
 */
import type { Phrase } from './conjspeech.js';

/** The six persons of the present, in the order a table is read. */
export const PERSONS = ['je', 'tu', 'il/elle', 'nous', 'vous', 'ils/elles'] as const;
export type Person = 0 | 1 | 2 | 3 | 4 | 5;

/** One verb as the sheet gives it. `present` is the six forms in PERSONS
 *  order, without their pronouns. `aux` is the auxiliary its passé composé
 *  takes, so the participle can be shown in use. `irregular` is true for a
 *  verb whose present cannot be built from the ‑er pattern. */
export interface Verb {
  inf: string;
  en: string;
  present: readonly [string, string, string, string, string, string];
  pp: string;
  aux: 'avoir' | 'être';
  irregular: boolean;
}

/** An ‑er verb's present, from its stem: the pattern every regular verb on
 *  the sheet follows. *manger* keeps its e before ‑ons so the g stays soft. */
function er(inf: string): Verb['present'] {
  const stem = inf.slice(0, -2);
  const nous = stem.endsWith('g') ? `${stem}eons` : `${stem}ons`;
  return [`${stem}e`, `${stem}es`, `${stem}e`, nous, `${stem}ez`, `${stem}ent`];
}

const regular = (inf: string, en: string): Verb =>
  ({ inf, en, present: er(inf), pp: `${inf.slice(0, -2)}é`, aux: 'avoir', irregular: false });

/** The eighteen, in the order the sheet lists them. */
export const VERBS: readonly Verb[] = [
  { inf: 'être', en: 'to be', present: ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'],
    pp: 'été', aux: 'avoir', irregular: true },
  { inf: 'avoir', en: 'to have', present: ['ai', 'as', 'a', 'avons', 'avez', 'ont'],
    pp: 'eu', aux: 'avoir', irregular: true },
  { inf: 'aller', en: 'to go', present: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'],
    pp: 'allé', aux: 'être', irregular: true },
  { inf: 'faire', en: 'to do / make', present: ['fais', 'fais', 'fait', 'faisons', 'faites', 'font'],
    pp: 'fait', aux: 'avoir', irregular: true },
  regular('habiter', 'to live'),
  regular('étudier', 'to study'),
  regular('travailler', 'to work'),
  regular('parler', 'to speak'),
  regular('aimer', 'to like / love'),
  regular('regarder', 'to watch / look at'),
  regular('écouter', 'to listen'),
  { inf: 'prendre', en: 'to take / have',
    present: ['prends', 'prends', 'prend', 'prenons', 'prenez', 'prennent'],
    pp: 'pris', aux: 'avoir', irregular: true },
  regular('manger', 'to eat'),
  { inf: 'boire', en: 'to drink', present: ['bois', 'bois', 'boit', 'buvons', 'buvez', 'boivent'],
    pp: 'bu', aux: 'avoir', irregular: true },
  { inf: 'apprendre', en: 'to learn',
    present: ['apprends', 'apprends', 'apprend', 'apprenons', 'apprenez', 'apprennent'],
    pp: 'appris', aux: 'avoir', irregular: true },
  { inf: 'comprendre', en: 'to understand',
    present: ['comprends', 'comprends', 'comprend', 'comprenons', 'comprenez', 'comprennent'],
    pp: 'compris', aux: 'avoir', irregular: true },
  { inf: 'vouloir', en: 'to want', present: ['veux', 'veux', 'veut', 'voulons', 'voulez', 'veulent'],
    pp: 'voulu', aux: 'avoir', irregular: true },
  { inf: 'sortir', en: 'to go out', present: ['sors', 'sors', 'sort', 'sortons', 'sortez', 'sortent'],
    pp: 'sorti', aux: 'être', irregular: true },
];

/** *je* before a form, elided where French elides it: *j'ai*, *j'habite*
 *  (the h of *habiter* is mute), but *je suis*. Every other pronoun is
 *  written as it stands. */
export function withPronoun(person: Person, form: string): string {
  const pronoun = PERSONS[person];
  return person === 0 && /^[aeiouéèêh]/.test(form) ? `j'${form}` : `${pronoun} ${form}`;
}

/** The participle in a passé composé, for the first person: *j'ai mangé*,
 *  *je suis allé(e)* — with *être* the participle agrees, which the (e)
 *  says. */
export function perfect(verb: Verb): string {
  return verb.aux === 'être' ? `je suis ${verb.pp}(e)` : `j'ai ${verb.pp}`;
}

/** What is said for one person: the pronoun the ear expects, *il* rather
 *  than *il/elle*, joined to the form as withPronoun joins it. */
export function spokenLine(person: Person, form: string): string {
  const said = withPronoun(person, form);
  return said.replace(/^il\/elle /, 'il ').replace(/^ils\/elles /, 'ils ');
}

/** Where a verb's clips are kept. Its own namespace rather than the
 *  catalogue's word key: these lines are not the catalogue's table (it says
 *  *il/elle* differently, and has no passé composé), and a clip kept under
 *  a slot it shares with a different text would be a clip of the wrong
 *  thing. */
export const clipKeyOfVerb = (verb: Pick<Verb, 'inf'>): string => `verbs18|${verb.inf}`;

/** Every phrase of a verb that can be pointed at on the page: the
 *  infinitive, the six present lines, and the participle in use. Spoken by
 *  the on-device voice, kept as clips, so the second play is instant. */
export interface VerbPhrases {
  inf: Phrase;
  present: Phrase[];
  pp: Phrase;
}
export function phrasesOfVerb(verb: Verb): VerbPhrases {
  const key = clipKeyOfVerb(verb);
  return {
    inf: { key, slot: 'inf', text: verb.inf },
    present: verb.present.map((form, i) =>
      ({ key, slot: `pres:${i}`, text: spokenLine(i as Person, form) })),
    pp: { key, slot: 'pp', text: perfect(verb).replace('(e)', '') },
  };
}

/** What an answer is reduced to before it is compared: lower case, one
 *  kind of apostrophe, single spaces, and no full stop, question or
 *  exclamation mark at the end, with no space before one either. Everything
 *  else counts — an accent is a letter, and the sheet is there to learn the
 *  spelling. The app's own grading forgives a missing accent as a note; here
 *  that would let *etes* stand for *êtes*. */
export function tidy(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ')
    .trim().replace(/\s*([?!.,;:])/g, '$1').replace(/[?!.]+$/, '');
}

/** The answer with a pronoun in front of it taken off, for a cell that
 *  asks for the form alone: *nous buvons* for *buvons*. */
export function dropPronoun(typed: string): string {
  return typed.trim().replace(/^(j'|j’|je |tu |il |elle |on |nous |vous |ils |elles )/i, '');
}

/** Right or not, against any of the accepted answers, by `tidy`. */
export function isRight(typed: string, accepted: readonly string[]): boolean {
  const got = tidy(typed);
  return !!got && accepted.some((a) => tidy(a) === got);
}

/** A run of letters in a compared answer: the same in both, or only in this
 *  one — typed and not wanted, on the learner's side; wanted and not typed,
 *  on the answer's. */
export interface Segment { text: string; same: boolean }

/** Where what was typed and what was wanted part ways, letter by letter,
 *  for drawing both with the difference marked. A longest common
 *  subsequence over the characters: *etes* against *êtes* marks the *e*
 *  typed and the *ê* wanted, and nothing else. Case is compared as typed
 *  lowered, so a capital is never the mistake. Both sides read back as the
 *  strings they came from, composed (NFC), joined. */
export function diff(typed: string, want: string): { typed: Segment[]; want: Segment[] } {
  /* Composed first, so an accent typed as a mark after its letter is one
     letter, as it is on the screen; every letter French uses is then a
     single code unit. */
  const a = typed.normalize('NFC').split('');
  const b = want.normalize('NFC').split('');
  const eq = (x: string, y: string): boolean => x.toLowerCase() === y.toLowerCase();
  /* lcs[i][j]: the common length of a[i..] and b[j..]. */
  const lcs = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = eq(a[i]!, b[j]!) ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const left: Segment[] = [];
  const right: Segment[] = [];
  const push = (out: Segment[], ch: string, same: boolean): void => {
    const last = out.at(-1);
    if (last && last.same === same) last.text += ch;
    else out.push({ text: ch, same });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && eq(a[i]!, b[j]!)) {
      push(left, a[i++]!, true);
      push(right, b[j++]!, true);
    } else if (j < b.length && (i >= a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      push(right, b[j++]!, false);
    } else {
      push(left, a[i++]!, false);
    }
  }
  return { typed: left, want: right };
}

/** Of the accepted answers, the one nearest what was typed: the one the
 *  feedback compares against, so a translation that took the other wording
 *  is not marked against the wording it did not take. */
export function nearest(typed: string, accepted: readonly string[]): string {
  let best = accepted[0] ?? '';
  let score = -1;
  for (const a of accepted) {
    const common = diff(tidy(typed), tidy(a)).want.filter((s) => s.same).reduce((n, s) => n + s.text.length, 0);
    const mine = common * 2 - tidy(a).length;
    if (mine > score) { score = mine; best = a; }
  }
  return best;
}

/** Whether marking the difference helps: the answer shares most of its
 *  letters with what was wanted. Against a sentence typed for another
 *  sentence altogether, every other letter would be marked, which says
 *  less than the right answer shown plainly. */
export function worthMarking(typed: string, want: string): boolean {
  const common = diff(typed, want).want.filter((s) => s.same).reduce((n, s) => n + s.text.length, 0);
  return common >= want.normalize('NFC').length * 0.6;
}
