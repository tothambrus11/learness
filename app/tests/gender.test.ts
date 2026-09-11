/** The article a noun comes with, and what colour it is painted. */
import { expect, test } from 'vitest';

import {
  articleFor,
  articleKind,
  articlePieces,
  describeWord,
  splitArticle,
  withDefiniteArticle,
} from '../src/lib/gender';
import type { DisplaySettings } from '../src/lib/types';

/** What a stored form's own article says about its gender, which is the pair
 *  of calls every screen makes: split the form, then read the article. */
const kindOf = (text: string, gender: string = ''): string => {
  const { article } = splitArticle(text);
  return articleKind(article, gender);
};

test('the article comes off the front of a stored form', () => {
  expect(splitArticle('la source')).toEqual({ article: 'la', rest: 'source' });
  expect(splitArticle("l'eau")).toEqual({ article: "l'", rest: 'eau' });
  expect(splitArticle('les gens')).toEqual({ article: 'les', rest: 'gens' });
  expect(splitArticle('de la crème')).toEqual({ article: 'de la', rest: 'crème' });
});

test('a word that only looks like it starts with an article keeps it', () => {
  expect(splitArticle('lesquels')).toEqual({ article: '', rest: 'lesquels' });
  expect(splitArticle('lundi')).toEqual({ article: '', rest: 'lundi' });
  expect(splitArticle('descendre')).toEqual({ article: '', rest: 'descendre' });
  expect(splitArticle('se laver')).toEqual({ article: '', rest: 'se laver' });
  expect(splitArticle('être')).toEqual({ article: '', rest: 'être' });
});

test('colour follows the article, and the gender where the article elides', () => {
  expect(kindOf('le train')).toBe('m');
  expect(kindOf('la source')).toBe('f');
  expect(kindOf('un club')).toBe('m');
  expect(kindOf('une bricolette')).toBe('f');
  expect(kindOf('les vacances')).toBe('pl');
  expect(kindOf("l'eau", 'f')).toBe('f');
  expect(kindOf("l'argent", 'm')).toBe('m');
  expect(kindOf("l'accès"), 'no gender stored: better uncoloured than wrong').toBe('');
  expect(kindOf('être')).toBe('');
});

test('a curly apostrophe is the same article', () => {
  expect(splitArticle('l’eau')).toEqual({ article: 'l’', rest: 'eau' });
  expect(articleKind('l’', 'f')).toBe('f');
});

test('a bare noun gets the article its gender calls for', () => {
  expect(articleFor('bricolette', 'f')).toBe('la');
  expect(articleFor('natel', 'm')).toBe('le');
  expect(articleFor('eau', 'f')).toBe("l'");
  expect(articleFor('œil', 'm')).toBe("l'");
  expect(articleFor('natel', ''), 'no gender, no guess').toBe('');
});

test('a word you typed is shown with its definite article, like the catalogue', () => {
  expect(withDefiniteArticle('une erreur', 'noun', 'f')).toBe("l'erreur");
  expect(withDefiniteArticle('natel', 'noun', 'm')).toBe('le natel');
  expect(withDefiniteArticle('la source', 'noun', 'f')).toBe('la source');
  expect(withDefiniteArticle('un club', 'noun', ''), 'the typed article says the gender').toBe(
    'le club',
  );
  expect(withDefiniteArticle('ministre', 'noun', 'mf')).toBe('le/la ministre');
  expect(withDefiniteArticle('enfant', 'noun', 'mf')).toBe("l'enfant");
  expect(withDefiniteArticle('un héros', 'noun', 'm'), 'elision unknown: keep yours').toBe(
    'un héros',
  );
  expect(withDefiniteArticle('natel', 'noun', ''), 'no gender, no article').toBe('natel');
  expect(withDefiniteArticle('bonjour', 'phrase', '')).toBe('bonjour');
  expect(withDefiniteArticle('parfait', 'adj', 'm')).toBe('parfait');
});

test('a word whose elision the spelling cannot settle gets no article', () => {
  expect(
    articleFor('hôpital', 'm'),
    "l'hôpital but le héros, and only a dictionary knows",
  ).toBe('');
  expect(articleFor('héros', 'm')).toBe('');
  expect(articleFor('yaourt', 'm'), "l'oiseau but le yaourt, likewise").toBe('');
  expect(articleFor('week-end', 'm')).toBe('');
});

test('a noun that is either gender shows both articles, each its own colour', () => {
  const { article, rest } = splitArticle('le/la enfant');
  expect(article).toBe('le/la');
  expect(rest).toBe('enfant');
  expect(articlePieces(article)).toEqual([
    { text: 'le', kind: 'm' },
    { text: '/', kind: '' },
    { text: 'la', kind: 'f' },
  ]);
  expect(articlePieces('un/une')).toEqual([
    { text: 'un', kind: 'm' },
    { text: '/', kind: '' },
    { text: 'une', kind: 'f' },
  ]);
});

test('a plain article is one piece', () => {
  expect(articlePieces('les')).toEqual([{ text: 'les', kind: 'pl' }]);
  expect(articlePieces("l'", 'f')).toEqual([{ text: "l'", kind: 'f' }]);
  expect(articlePieces('')).toEqual([]);
});

test('a word taught in the plural is shown with les', () => {
  expect(withDefiniteArticle('gens', 'noun', 'm', 'pl')).toBe('les gens');
  expect(withDefiniteArticle('les vacances', 'noun', 'f', 'pl')).toBe('les vacances');
  expect(
    withDefiniteArticle('la vacance', 'noun', 'f', 'pl'),
    'the plural article wins over the one you typed',
  ).toBe('les vacance');
  expect(withDefiniteArticle('gens', 'noun', 'm'), 'singular unless asked').toBe('le gens');
});

test('by default a word is drawn exactly as it always was', () => {
  const d = describeWord('la source', { gender: 'f' });
  expect(d.pieces).toEqual([
    { text: 'la', kind: 'f', colour: 'var(--fem)', under: '', underStyle: '' },
  ]);
  expect(d.rest).toBe('source');
  expect(d.gap).toBe(true);
  expect(d.mark).toBe('');
});

test('an elided article leaves no gap, and carries the stored gender', () => {
  const d = describeWord("l'eau", { gender: 'f' });
  expect(d.gap).toBe(false);
  expect(d.pieces[0].colour).toBe('var(--fem)');
});

test('your own colours replace the theme’s', () => {
  const d = describeWord('le train', { gender: 'm' }, { colourMasc: '#0f0' });
  expect(d.pieces[0].colour).toBe('#0f0');
});

test('colouring can be switched off entirely', () => {
  const d = describeWord('le train', { gender: 'm' }, { genderColour: false });
  expect(d.pieces[0].colour).toBe('');
  expect(d.pieces[0].kind, 'the gender is still known, only unpainted').toBe('m');
});

test('a shape cue can be drawn under the article, for a colour-blind eye', () => {
  const m = describeWord('le train', { gender: 'm' }, { genderPattern: 'underline' });
  const f = describeWord('la source', { gender: 'f' }, { genderPattern: 'underline' });
  expect(m.pieces[0].underStyle).toBe('solid');
  expect(f.pieces[0].underStyle).toBe('dotted');
  expect(f.pieces[0].under).toBe('var(--fem)');
});

test('the letter beside the word says the same thing without colour', () => {
  /** The one display setting these cases turn on: the plain letter cue. */
  const letters: Partial<DisplaySettings> = { genderMark: 'letter' };
  expect(describeWord('le train', { gender: 'm' }, letters).mark).toBe('(m)');
  expect(describeWord('la source', { gender: 'f' }, letters).mark).toBe('(f)');
  expect(describeWord('le/la ministre', { gender: 'mf' }, letters).mark).toBe('(m/f)');
  expect(describeWord('les gens', { gender: 'm' }, letters).mark).toBe('(pl m)');
  expect(describeWord("l'accès", {}, letters).mark, 'nothing known, nothing claimed').toBe('');
  expect(describeWord('être', {}, letters).mark).toBe('');
});

test('a plural keeps its own colour, its gender’s, or both', () => {
  /** A word taught in the plural whose gender is known, which is what the
   *  three plural styles differ about. */
  const gens = { gender: 'm' };
  expect(describeWord('les gens', gens).pieces[0].colour).toBe('var(--plur)');
  expect(describeWord('les gens', gens, { pluralStyle: 'gender' }).pieces[0].colour).toBe(
    'var(--masc)',
  );
  const both = describeWord('les gens', gens, { pluralStyle: 'both' }).pieces[0];
  expect(both.colour, 'plural fills').toBe('var(--plur)');
  expect(both.under, 'gender underlines').toBe('var(--masc)');
  expect(both.underStyle).toBe('solid');
});

test('a plural whose gender is unknown stays plural however it is styled', () => {
  for (const pluralStyle of ['plural', 'gender', 'both'] as const) {
    const d = describeWord('les vacances', {}, { pluralStyle });
    expect(d.pieces[0].colour).toBe('var(--plur)');
    expect(d.pieces[0].under).toBe('');
  }
});

test('an either-gender noun whose article elides still shows both', () => {
  const d = describeWord("l'ami", { gender: 'mf' });
  expect(d.pieces[0].kind).toBe('mf');
  expect(d.pieces[0].colour, 'one elided article for both genders takes the masculine…').toBe(
    'var(--masc)',
  );
  expect(d.pieces[0].under, '…and wears the feminine underneath').toBe('var(--fem)');
  expect(describeWord("l'ami", { gender: 'mf' }, { genderMark: 'letter' }).mark).toBe('(m/f)');
  expect(
    describeWord("l'ami", { gender: 'mf' }, { genderColour: false }).pieces[0].colour,
    'and none of it when colour is off',
  ).toBe('');
});

test('an article that says the gender itself is untouched by mf', () => {
  expect(describeWord('le train', { gender: 'm' }).pieces[0].under).toBe('');
  expect(describeWord('le/la ministre', { gender: 'mf' }).pieces.map((p) => p.kind)).toEqual([
    'm',
    '',
    'f',
  ]);
});
