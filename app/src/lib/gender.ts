/** The article a noun comes with, and what colour it should be.
 *
 *  Gender is the thing about a French noun that a learner gets wrong long
 *  after the word itself is known, so it is worth seeing rather than reading:
 *  the article is coloured wherever a word is shown — feminine red, masculine
 *  blue, plural green — and the rest of the word is left alone.
 *
 *  The article is read off the word itself, since the catalogue stores the
 *  full form ("la source"), with the stored gender only settling the cases the
 *  article cannot: elision hides it ("l'eau"), and a word you typed yourself
 *  may have no article at all.
 */
import type { DisplaySettings, Gender, GrammaticalNumber } from './model.js';

/** What an article says about the noun: a gender, both genders at once, the
 *  plural, or nothing worth painting. */
export type ArticleKind = 'm' | 'f' | 'mf' | 'pl' | '';

/** One piece of an article, ready to be drawn. */
export interface ArticlePiece { text: string; kind: ArticleKind }

/** A piece with the paint on it: a fill, and a second colour underlined
 *  beneath where one article carries two meanings. */
export interface PaintedPiece extends ArticlePiece {
  colour: string;
  under: string;
  underStyle: string;
}

/** Everything a French word needs to be drawn. */
export interface WordDrawing {
  pieces: PaintedPiece[];
  /** The word after its article. */
  rest: string;
  /** Whether a space belongs between the article and the rest. */
  gap: boolean;
  /** The letter mark that follows the word, or empty. */
  mark: string;
}
const KIND: Record<string, ArticleKind | null> = {
  le: 'm', un: 'm', du: 'm',
  la: 'f', une: 'f', "de la": 'f',
  les: 'pl', des: 'pl',
  "l'": null, "de l'": null,          /* elided: only the gender knows */
};

/* A noun that is the same word for either gender is stored with both articles,
   "le/la enfant", and is shown with both coloured. */
const PAIRS = ['le/la', 'la/le', 'un/une', 'une/un'];

/* Longest first, so "de la" wins over "de", the pairs win over "le", and "l'"
   is not read as "le". */
const ARTICLES = [...PAIRS, ...Object.keys(KIND)].sort((a, b) => b.length - a.length);

/** Split a stored form into its article and the noun. Anything that does not
 *  start with an article comes back whole, which is every verb, adjective and
 *  phrase, and the reflexive "se" they sometimes start with. */
export function splitArticle(text: string | null | undefined): { article: string; rest: string } {
  const word = (text ?? '').trim();
  const lower = word.toLowerCase().replace(/[’‘]/g, "'");
  for (const article of ARTICLES) {
    if (!lower.startsWith(article)) continue;
    const after = word.slice(article.length);
    /* "l'eau" runs on, "la source" needs the space; "les" must not match
       "lesquels". */
    if (article.endsWith("'")) return { article: word.slice(0, article.length), rest: after };
    if (/^\s/.test(after)) {
      return { article: word.slice(0, article.length), rest: after.trimStart() };
    }
  }
  return { article: '', rest: word };
}

/** 'm' | 'f' | 'mf' | 'pl' | '' — the last meaning "do not colour this".
 *
 *  "mf" is the elided case of a noun that is either gender: "le/la ministre"
 *  splits into two articles that can each take their own colour, but "l'ami"
 *  is one article for both, so it is marked as the pair and painted as one. */
export function articleKind(article: string, gender: Gender = ''): ArticleKind {
  if (!article) return '';
  const key = article.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
  const kind = KIND[key];
  if (kind) return kind;
  return gender === 'm' || gender === 'f' || gender === 'mf' ? gender : '';   /* elided */
}

/** The article as pieces to paint: one for a plain article, three for a pair
 *  ("le", "/", "la"), so both genders keep their own colour. */
export function articlePieces(article: string, gender: Gender = ''): ArticlePiece[] {
  if (!article) return [];
  if (!article.includes('/')) return [{ text: article, kind: articleKind(article, gender) }];
  const pieces: ArticlePiece[] = [];
  article.split('/').forEach((part, i) => {
    if (i) pieces.push({ text: '/', kind: '' });
    pieces.push({ text: part, kind: articleKind(part, gender) });
  });
  return pieces;
}

/** A word you typed, shown the way the catalogue shows every noun: with its
 *  definite article. "une erreur" becomes "l'erreur", "natel" with a gender
 *  becomes "le natel", "le/la" for a noun of either gender, "les" for one
 *  taught in the plural. A word whose elision the spelling cannot settle
 *  ("héros") keeps whatever you typed, since a guessed article would be worse
 *  than yours. Anything that is not a gendered noun is left alone. */
export function withDefiniteArticle(fr: string | null | undefined, pos: string | undefined,
  gender: Gender | undefined, number: GrammaticalNumber = ''): string {
  const text = (fr ?? '').trim();
  if (pos !== 'noun' || !text) return text;
  const { article, rest } = splitArticle(text);
  /* Taught in the plural: "les gens" is the form that is actually used, and
     the singular article would teach the wrong one. */
  if (number === 'pl') return articleKind(article) === 'pl' ? text : `les ${rest}`;
  const g = gender === 'm' || gender === 'f' || gender === 'mf' ? gender : articleKind(article);
  if (g !== 'm' && g !== 'f' && g !== 'mf') return text;
  const definite = articleFor(rest, g === 'mf' ? 'm' : g);
  if (!definite) return text;
  if (definite.endsWith("'")) return definite + rest;
  return `${g === 'mf' ? 'le/la' : definite} ${rest}`;
}

/** How the gender is shown, and what the learner may change about it.
 *
 *  Colour alone fails two ways: a red/green pair is the commonest colour
 *  blindness there is, and a colour learned here means nothing in a book. So
 *  the colour is one cue of three, each switchable on its own — a shape cue
 *  under the article, and the plain letter beside it — and the colours
 *  themselves can be replaced. Everything defaults to what the app has always
 *  done: colour, nothing else.
 */
export const DEFAULT_DISPLAY: DisplaySettings = {
  genderColour: true,          // colour the article at all
  genderMark: 'none',          // 'none' | 'letter' — the "(f)" beside the word
  genderPattern: 'none',       // 'none' | 'underline' — a shape cue, for colour blindness
  colourMasc: '',              // '' means the theme's own blue
  colourFem: '',               // ... red
  colourPlur: '',              // ... green
  /* A word taught in the plural is still a masculine or a feminine word, and
     which cue wins is a matter of taste: the plural's own colour, the gender's,
     or the plural colour with the gender underneath it. */
  pluralStyle: 'plural',       // 'plural' | 'gender' | 'both'
};

type Painted = Exclude<ArticleKind, ''>;
const VAR: Record<Painted, string> = {
  m: 'var(--masc)', f: 'var(--fem)', pl: 'var(--plur)', mf: 'var(--masc)',
};
const CUSTOM: Record<Painted, keyof DisplaySettings> = {
  m: 'colourMasc', f: 'colourFem', pl: 'colourPlur', mf: 'colourMasc',
};
/* Shapes, so the cue survives a screenshot in greyscale and a red/green eye. */
const PATTERN: Record<ArticleKind, string> = {
  m: 'solid', f: 'dotted', pl: 'double', mf: 'dotted', '': '',
};
const LETTER: Record<'m' | 'f' | 'pl', string> = { m: 'm', f: 'f', pl: 'pl' };

/** The colour a kind is painted in: yours if you set one, the theme's if not. */
export function colourFor(kind: ArticleKind, display: DisplaySettings = DEFAULT_DISPLAY): string {
  if (!kind || display.genderColour === false) return '';
  const custom = display[CUSTOM[kind]];
  return (typeof custom === 'string' ? custom : '').trim() || VAR[kind];
}

/** Everything a French word needs to be drawn: the article split into coloured
 *  pieces, the rest of the word, and the letter mark that follows it.
 *
 *  Pure, and the only place the rules live; Fr.svelte turns this into spans.
 *  `under` is a second colour drawn as an underline, which is how a plural
 *  keeps its own colour and its gender at once.
 */
export function describeWord(
  text: string | null | undefined,
  { gender = '', number = '' }: { gender?: Gender; number?: GrammaticalNumber } = {},
  display: Partial<DisplaySettings> = DEFAULT_DISPLAY,
): WordDrawing {
  const d = { ...DEFAULT_DISPLAY, ...display };
  const { article, rest } = splitArticle(text ?? '');
  const base = articlePieces(article, gender);
  const patterned = d.genderPattern === 'underline';
  const known = gender === 'm' || gender === 'f' ? gender : '';
  const pieces = base.map((piece) => {
    /* A plural article can be painted three ways; the other two follow the
       article itself. */
    const asGender = piece.kind === 'pl' && known && d.pluralStyle !== 'plural';
    const kind = asGender && d.pluralStyle === 'gender' ? known : piece.kind;
    const both = asGender && d.pluralStyle === 'both';
    /* One article standing for both genders — "l'ami" — carries the second the
       same way a plural carries its gender: filled with one, underlined in the
       other. "le/la ministre" needs none of this; it has an article each. */
    const pair = piece.kind === 'mf';
    const under = both || pair ? colourFor(both ? known : 'f', d)
      : patterned ? colourFor(kind, d) : '';
    return {
      text: piece.text,
      kind,
      colour: colourFor(kind, d),
      under,
      underStyle: !under ? '' : (both || pair) && !patterned ? 'solid'
        : PATTERN[both ? known : kind],
    };
  });
  const plural = number === 'pl' || base.some((p) => p.kind === 'pl');
  const genders = [...new Set(base.flatMap((p): ('m' | 'f')[] =>
    (p.kind === 'mf' ? ['m', 'f'] : p.kind === 'm' || p.kind === 'f' ? [p.kind] : [])))];
  return {
    pieces,
    rest,
    gap: !!article && !/['’]$/.test(article),
    mark: mark(genders.length ? genders : known ? [known] : [], plural, d),
  };
}

function mark(genders: ('m' | 'f')[], plural: boolean, display: DisplaySettings): string {
  if (display.genderMark !== 'letter') return '';
  const parts = [];
  if (plural) parts.push(LETTER.pl);
  if (genders.length) parts.push(genders.map((k) => LETTER[k]).join('/'));
  return parts.length ? `(${parts.join(' ')})` : '';
}

/** The article a bare noun should be shown with, for a word typed without one.
 *
 *  Only where the spelling settles it. "le" elides before a vowel, but whether
 *  it elides before an h is a fact about the word, not about its letters --
 *  "l'hôtel" and "le héros" look alike -- and the same goes for the semi-vowels
 *  in "l'oiseau" against "le yaourt". The catalogue answers those from a
 *  dictionary in the pipeline; here there is nothing to ask, so a word that
 *  starts with h, y or w gets no article rather than a guessed one.
 */
export function articleFor(noun: string | null | undefined, gender: Gender): string {
  const word = (noun ?? '').trim();
  if (!word || (gender !== 'm' && gender !== 'f')) return '';
  if (/^[hyw]/i.test(word)) return '';
  if (/^[aeiouœæàâäéèêëîïôöùûü]/i.test(word)) return "l'";
  return gender === 'f' ? 'la' : 'le';
}
