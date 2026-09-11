/** The article a noun comes with, and what colour it should be: feminine red,
 *  masculine blue, plural green, with the rest of the word left alone. */

import type { DisplaySettings } from './types';

/** What an article says about a word, `''` meaning "do not colour this".
 *  `mf` is a noun that is either gender carried by one elided article. */
export type GenderKind = 'm' | 'f' | 'mf' | 'pl' | '';

/** The two genders a word can actually be stored as, for the letter mark. */
type Gender = 'm' | 'f';

/** How an underline is drawn under an article, `''` meaning none. */
export type UnderlineStyle = '' | 'solid' | 'dotted' | 'double';

/** What each article says on its own. `null` is an article that elides, where
 *  only the stored gender knows. */
const KIND: Record<string, GenderKind | null> = {
  le: 'm',
  un: 'm',
  du: 'm',
  la: 'f',
  une: 'f',
  'de la': 'f',
  les: 'pl',
  des: 'pl',
  "l'": null,
  "de l'": null,
};

/** The stored gender where it is one this module knows — 'm', 'f' or 'mf' —
 *  and `''` for anything else, which is what settles an article that elides. */
const storedGender = (gender: string): GenderKind =>
  gender === 'm' || gender === 'f' || gender === 'mf' ? gender : '';

/** The paired articles a noun that is the same word for either gender is
 *  stored with, "le/la enfant", so that each half can take its own colour. */
const PAIRS = ['le/la', 'la/le', 'un/une', 'une/un'];

/** Orders articles longest first, so that one starting with another is tried
 *  before it: "de la" before "de", the pairs before "le", "l'" not as "le". */
const longestFirst = (a: string, b: string): number => b.length - a.length;

/** Every article a stored form may start with, longest first. */
const ARTICLES = [...PAIRS, ...Object.keys(KIND)].sort(longestFirst);

/** A stored form taken apart: what was in front, and what is left. */
export interface ArticleSplit {
  /** The article exactly as it was spelt, curly apostrophe and all; `''` when
   *  the word has none. */
  article: string;
  /** The rest of the word, with the space after the article dropped. */
  rest: string;
}

/** True for an article that runs straight into the noun rather than taking a
 *  space after it, as "l'" does in "l'eau". */
const elides = (article: string): boolean => article.endsWith("'");

/** True where what follows an article is a space, so the article is a word of
 *  its own — which is what keeps "les" from matching "lesquels". */
const standsAlone = (afterArticle: string): boolean => /^\s/.test(afterArticle);

/** Split a stored form into its article and the noun. Anything that does not
 *  start with an article comes back whole, which is every verb, adjective and
 *  phrase, and the reflexive "se" they sometimes start with. */
export function splitArticle(text: string | null | undefined): ArticleSplit {
  const word = (text ?? '').trim();
  const lower = word.toLowerCase().replace(/[’‘]/g, "'");
  for (const article of ARTICLES) {
    if (!lower.startsWith(article)) continue;
    const after = word.slice(article.length);
    if (elides(article)) return { article: word.slice(0, article.length), rest: after };
    if (standsAlone(after)) {
      return { article: word.slice(0, article.length), rest: after.trimStart() };
    }
  }
  return { article: '', rest: word };
}

/** What one article says about the gender: 'm' | 'f' | 'mf' | 'pl' | '', the
 *  last meaning "do not colour this". `gender` settles an article that elides,
 *  and is ignored for one that does not. */
export function articleKind(article: string, gender: string = ''): GenderKind {
  if (!article) return '';
  const key = article
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ');
  const kind = KIND[key];
  if (kind) return kind;
  return storedGender(gender);
}

/** One run of an article that takes a colour of its own. */
export interface ArticlePiece {
  /** The text to draw, which is an article or the "/" between two of them. */
  text: string;
  /** What this run says about the gender; `''` for the separator and for
   *  anything the article and the stored gender together cannot settle. */
  kind: GenderKind;
}

/** The article as pieces to paint: one for a plain article, three for a pair
 *  ("le", "/", "la"), so both genders keep their own colour. */
export function articlePieces(article: string, gender: string = ''): ArticlePiece[] {
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
 *  taught in the plural. Anything that is not a gendered noun, and any word
 *  whose elision the spelling cannot settle, comes back unchanged. */
export function withDefiniteArticle(
  fr: string | null | undefined,
  pos: string | null | undefined,
  gender: string | null | undefined,
  number: string = '',
): string {
  const text = (fr ?? '').trim();
  if (pos !== 'noun' || !text) return text;
  const { article, rest } = splitArticle(text);
  if (number === 'pl') return articleKind(article) === 'pl' ? text : `les ${rest}`;
  const g = storedGender(gender ?? '') || articleKind(article);
  if (g !== 'm' && g !== 'f' && g !== 'mf') return text;
  const definite = articleFor(rest, g === 'mf' ? 'm' : g);
  if (!definite) return text;
  if (elides(definite)) return definite + rest;
  return `${g === 'mf' ? 'le/la' : definite} ${rest}`;
}

/** How the gender is shown when the learner has changed nothing: the article
 *  coloured in the theme's own colours, with no letter and no shape cue. */
export const DEFAULT_DISPLAY: DisplaySettings = {
  genderColour: true, // colour the article at all
  genderMark: 'none', // 'none' | 'letter' — the "(f)" beside the word
  genderPattern: 'none', // 'none' | 'underline' — a shape cue, for colour blindness
  colourMasc: '', // '' means the theme's own blue
  colourFem: '', // ... red
  colourPlur: '', // ... green
  pluralStyle: 'plural', // 'plural' | 'gender' | 'both'
};

/** The theme's colour for each kind, as a CSS variable the stylesheet owns. */
const VAR: Record<string, string> = {
  m: 'var(--masc)',
  f: 'var(--fem)',
  pl: 'var(--plur)',
  mf: 'var(--masc)',
};
/** Which setting holds the learner's own colour for each kind. */
const CUSTOM: Record<string, 'colourMasc' | 'colourFem' | 'colourPlur'> = {
  m: 'colourMasc',
  f: 'colourFem',
  pl: 'colourPlur',
  mf: 'colourMasc',
};
/** The underline drawn under each kind when the pattern cue is switched on:
 *  a shape, so the cue survives greyscale and a red/green eye. */
const PATTERN: Record<string, UnderlineStyle> = {
  m: 'solid',
  f: 'dotted',
  pl: 'double',
  mf: 'dotted',
};
/** The letter written beside a word when the mark is asked for. */
const LETTER = { m: 'm', f: 'f', pl: 'pl' } as const;

/** The colour a kind is painted in: yours if you set one, the theme's if not. */
export function colourFor(
  kind: GenderKind,
  display: DisplaySettings = DEFAULT_DISPLAY,
): string {
  if (!kind || display.genderColour === false) return '';
  return (display[CUSTOM[kind]] || '').trim() || VAR[kind] || '';
}

/** What a word is taught as, as the record stores it. Anything this module
 *  does not recognise simply goes uncoloured. */
export interface WordGender {
  /** `m` | `f` | `mf` | `''`. */
  gender?: string;
  /** `pl` where the plural is the form being taught, else `''`. */
  number?: string;
}

/** One run of the article, ready to be drawn. */
export interface WordShapePiece extends ArticlePiece {
  /** The fill colour, or `''` to inherit — which is what colouring switched
   *  off, and an unknown gender, both come to. */
  colour: string;
  /** A second colour drawn as an underline, or `''` for none. */
  under: string;
  /** How that underline is drawn; `''` exactly when `under` is. */
  underStyle: UnderlineStyle;
}

/** Everything a French word needs to be drawn, with no rule left to the
 *  component. */
export interface WordShape {
  /** The article, split into runs that each take their own colour. Empty for
   *  a word without an article. */
  pieces: WordShapePiece[];
  /** The rest of the word, drawn plain. */
  rest: string;
  /** True when a space belongs between the article and the rest — that is,
   *  everywhere but after an elision. */
  gap: boolean;
  /** The letter cue that follows the word, such as `(f)` or `(pl m)`; `''`
   *  when it is switched off or nothing is known. */
  mark: string;
}

/** One run of the article, painted. `known` is the word's own gender where the
 *  record gives one. A plural article may be painted three ways — as a plural,
 *  as the word's gender, or as a plural filled in its own colour with the
 *  gender underlined beneath it — and an article standing for both genders at
 *  once ("l'ami", where "le/la ministre" would have one each) carries the
 *  second the same way. Every other run takes the article's own colour, with
 *  the shape cue underlined beneath it where that is switched on. */
function paintPiece(
  piece: ArticlePiece,
  known: Gender | '',
  d: DisplaySettings,
): WordShapePiece {
  const patterned = d.genderPattern === 'underline';
  const pluralTakesGender = piece.kind === 'pl' && known && d.pluralStyle !== 'plural';
  const kind = pluralTakesGender && d.pluralStyle === 'gender' ? known : piece.kind;
  const pluralOverGender = pluralTakesGender && d.pluralStyle === 'both';
  const oneArticleBothGenders = piece.kind === 'mf';
  const under =
    pluralOverGender || oneArticleBothGenders
      ? colourFor(pluralOverGender ? known : 'f', d)
      : patterned
        ? colourFor(kind, d)
        : '';
  return {
    text: piece.text,
    kind,
    colour: colourFor(kind, d),
    under,
    underStyle: !under
      ? ''
      : (pluralOverGender || oneArticleBothGenders) && !patterned
        ? 'solid'
        : PATTERN[pluralOverGender ? known : kind] || '',
  };
}

/** Everything a French word needs to be drawn: the article split into coloured
 *  pieces, the rest of the word, and the letter mark that follows it. Pure,
 *  and the only place the display rules live — Fr.svelte turns this into
 *  spans. */
export function describeWord(
  text: string | null | undefined,
  { gender = '', number = '' }: WordGender = {},
  display: Partial<DisplaySettings> = DEFAULT_DISPLAY,
): WordShape {
  const d: DisplaySettings = { ...DEFAULT_DISPLAY, ...display };
  const { article, rest } = splitArticle(text ?? '');
  const base = articlePieces(article, gender);
  const known: Gender | '' = gender === 'm' || gender === 'f' ? gender : '';
  const pieces = base.map((piece) => paintPiece(piece, known, d));
  const plural = number === 'pl' || base.some((p) => p.kind === 'pl');
  const genders = [
    ...new Set(
      base.flatMap<Gender>((p) =>
        p.kind === 'mf' ? ['m', 'f'] : p.kind === 'm' || p.kind === 'f' ? [p.kind] : [],
      ),
    ),
  ];
  return {
    pieces,
    rest,
    gap: !!article && !/['’]$/.test(article),
    mark: mark(genders.length ? genders : known ? [known] : [], plural, d),
  };
}

/** The letter cue beside a word: the plural first, then the genders the
 *  article carries, in brackets. `''` unless the mark is switched on. */
function mark(genders: Gender[], plural: boolean, display: DisplaySettings): string {
  if (display.genderMark !== 'letter') return '';
  const parts = [];
  if (plural) parts.push(LETTER.pl);
  if (genders.length) parts.push(genders.map((k) => LETTER[k]).join('/'));
  return parts.length ? `(${parts.join(' ')})` : '';
}

/** A noun whose elision is a fact about the word rather than about its
 *  spelling: "l'hôtel" against "le héros", "l'oiseau" against "le yaourt". The
 *  catalogue answers those from a dictionary in the pipeline; here there is
 *  nothing to ask. */
const UNSETTLED_BY_SPELLING = /^[hyw]/i;

/** A noun beginning with a letter "le" and "la" elide before. */
const ELIDES_AFTER = /^[aeiouœæàâäéèêëîïôöùûü]/i;

/** The definite article a bare noun should be shown with, or `''` where the
 *  spelling cannot settle it — an unknown gender, or a word starting with h, y
 *  or w, which gets no article rather than a guessed one. */
export function articleFor(
  noun: string | null | undefined,
  gender: string | null | undefined,
): string {
  const word = (noun ?? '').trim();
  if (!word || (gender !== 'm' && gender !== 'f')) return '';
  if (UNSETTLED_BY_SPELLING.test(word)) return '';
  if (ELIDES_AFTER.test(word)) return "l'";
  return gender === 'f' ? 'la' : 'le';
}
