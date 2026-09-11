/** The article a noun comes with, and what colour it should be: feminine red,
 *  masculine blue, plural green, with the rest of the word left alone. */

/* Gender is the thing about a French noun that a learner gets wrong long after
   the word itself is known, so it is worth seeing rather than reading.

   The article is read off the word itself, since the catalogue stores the full
   form ("la source"), with the stored gender only settling the cases the
   article cannot: elision hides it ("l'eau"), and a word you typed yourself may
   have no article at all. */
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
  "de l'": null /* elided: only the gender knows */,
};

/* A noun that is the same word for either gender is stored with both articles,
   "le/la enfant", and is shown with both coloured. */
/** The paired articles such a noun is stored with. */
const PAIRS = ['le/la', 'la/le', 'un/une', 'une/un'];

/* Longest first, so "de la" wins over "de", the pairs win over "le", and "l'"
   is not read as "le". */
/** Every article a stored form may start with, longest first. */
const ARTICLES = [...PAIRS, ...Object.keys(KIND)].sort((a, b) => b.length - a.length);

/** A stored form taken apart: what was in front, and what is left. */
export interface ArticleSplit {
  /** The article exactly as it was spelt, curly apostrophe and all; `''` when
   *  the word has none. */
  article: string;
  /** The rest of the word, with the space after the article dropped. */
  rest: string;
}

/** Split a stored form into its article and the noun. Anything that does not
 *  start with an article comes back whole, which is every verb, adjective and
 *  phrase, and the reflexive "se" they sometimes start with. */
export function splitArticle(text: string | null | undefined): ArticleSplit {
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

/** What one article says about the gender: 'm' | 'f' | 'mf' | 'pl' | '', the
 *  last meaning "do not colour this". `gender` settles an article that elides,
 *  and is ignored for one that does not. */
export function articleKind(article: string, gender: string = ''): GenderKind {
  /* "mf" is the elided case of a noun that is either gender: "le/la ministre"
     splits into two articles that can each take their own colour, but "l'ami"
     is one article for both, so it is marked as the pair and painted as one. */
  if (!article) return '';
  const key = article
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ');
  const kind = KIND[key];
  if (kind) return kind;
  return gender === 'm' || gender === 'f' || gender === 'mf' ? gender : ''; /* elided */
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
  /* Taught in the plural: "les gens" is the form that is actually used, and
     the singular article would teach the wrong one. */
  if (number === 'pl') return articleKind(article) === 'pl' ? text : `les ${rest}`;
  const g = gender === 'm' || gender === 'f' || gender === 'mf' ? gender : articleKind(article);
  if (g !== 'm' && g !== 'f' && g !== 'mf') return text;
  const definite = articleFor(rest, g === 'mf' ? 'm' : g);
  /* A word whose elision the spelling cannot settle ("héros") keeps whatever
     you typed: a guessed article would be worse than yours. */
  if (!definite) return text;
  if (definite.endsWith("'")) return definite + rest;
  return `${g === 'mf' ? 'le/la' : definite} ${rest}`;
}

/* Colour alone fails two ways: a red/green pair is the commonest colour
   blindness there is, and a colour learned here means nothing in a book. So the
   colour is one cue of three, each switchable on its own — a shape cue under
   the article, and the plain letter beside it — and the colours themselves can
   be replaced. Everything defaults to what the app has always done: colour,
   nothing else. */
/** How the gender is shown when the learner has changed nothing: the article
 *  coloured in the theme's own colours, with no letter and no shape cue. */
export const DEFAULT_DISPLAY: DisplaySettings = {
  genderColour: true, // colour the article at all
  genderMark: 'none', // 'none' | 'letter' — the "(f)" beside the word
  genderPattern: 'none', // 'none' | 'underline' — a shape cue, for colour blindness
  colourMasc: '', // '' means the theme's own blue
  colourFem: '', // ... red
  colourPlur: '', // ... green
  /* A word taught in the plural is still a masculine or a feminine word, and
     which cue wins is a matter of taste: the plural's own colour, the gender's,
     or the plural colour with the gender underneath it. */
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
/* Shapes, so the cue survives a screenshot in greyscale and a red/green eye. */
/** The underline drawn under each kind when the pattern cue is switched on. */
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

/* Free strings because that is how they arrive from the catalogue and from
   your own list. */
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

/** Everything a French word needs to be drawn: the article split into coloured
 *  pieces, the rest of the word, and the letter mark that follows it. Pure. */
export function describeWord(
  text: string | null | undefined,
  { gender = '', number = '' }: WordGender = {},
  display: Partial<DisplaySettings> = DEFAULT_DISPLAY,
): WordShape {
  /* The only place the display rules live; Fr.svelte turns this into spans.
     `under` is a second colour drawn as an underline, which is how a plural
     keeps its own colour and its gender at once. */
  const d: DisplaySettings = { ...DEFAULT_DISPLAY, ...display };
  const { article, rest } = splitArticle(text ?? '');
  const base = articlePieces(article, gender);
  const patterned = d.genderPattern === 'underline';
  const known = gender === 'm' || gender === 'f' ? gender : '';
  const pieces = base.map((piece): WordShapePiece => {
    /* A plural article can be painted three ways; the other two follow the
       article itself. */
    const asGender = piece.kind === 'pl' && known && d.pluralStyle !== 'plural';
    const kind = asGender && d.pluralStyle === 'gender' ? known : piece.kind;
    const both = asGender && d.pluralStyle === 'both';
    /* One article standing for both genders — "l'ami" — carries the second the
       same way a plural carries its gender: filled with one, underlined in the
       other. "le/la ministre" needs none of this; it has an article each. */
    const pair = piece.kind === 'mf';
    const under =
      both || pair ? colourFor(both ? known : 'f', d) : patterned ? colourFor(kind, d) : '';
    return {
      text: piece.text,
      kind,
      colour: colourFor(kind, d),
      under,
      underStyle: !under
        ? ''
        : (both || pair) && !patterned
          ? 'solid'
          : PATTERN[both ? known : kind] || '',
    };
  });
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

/** The definite article a bare noun should be shown with, or `''` where the
 *  spelling cannot settle it — an unknown gender, or a word starting with h, y
 *  or w. */
export function articleFor(
  noun: string | null | undefined,
  gender: string | null | undefined,
): string {
  /* "le" elides before a vowel, but whether it elides before an h is a fact
     about the word, not about its letters -- "l'hôtel" and "le héros" look
     alike -- and the same goes for the semi-vowels in "l'oiseau" against
     "le yaourt". The catalogue answers those from a dictionary in the pipeline;
     here there is nothing to ask, so such a word gets no article rather than a
     guessed one. */
  const word = (noun ?? '').trim();
  if (!word || (gender !== 'm' && gender !== 'f')) return '';
  if (/^[hyw]/i.test(word)) return '';
  if (/^[aeiouœæàâäéèêëîïôöùûü]/i.test(word)) return "l'";
  return gender === 'f' ? 'la' : 'le';
}
