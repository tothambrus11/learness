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
const KIND = {
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
export function splitArticle(text) {
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

/** 'm' | 'f' | 'pl' | '' — the last meaning "do not colour this". */
export function articleKind(article, gender = '') {
  if (!article) return '';
  const key = article.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
  const kind = KIND[key];
  if (kind) return kind;
  return gender === 'm' || gender === 'f' ? gender : '';   /* elided */
}

/** The article as pieces to paint: one for a plain article, three for a pair
 *  ("le", "/", "la"), so both genders keep their own colour. */
export function articlePieces(article, gender = '') {
  if (!article) return [];
  if (!article.includes('/')) return [{ text: article, kind: articleKind(article, gender) }];
  const pieces = [];
  article.split('/').forEach((part, i) => {
    if (i) pieces.push({ text: '/', kind: '' });
    pieces.push({ text: part, kind: articleKind(part, gender) });
  });
  return pieces;
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
export function articleFor(noun, gender) {
  const word = (noun ?? '').trim();
  if (!word || (gender !== 'm' && gender !== 'f')) return '';
  if (/^[hyw]/i.test(word)) return '';
  if (/^[aeiouœæàâäéèêëîïôöùûü]/i.test(word)) return "l'";
  return gender === 'f' ? 'la' : 'le';
}
