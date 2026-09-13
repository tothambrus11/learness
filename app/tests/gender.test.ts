import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  articleFor, articleKind, articlePieces, describeWord, splitArticle, withDefiniteArticle,
} from '../src/lib/gender.js';
import type { ArticleKind } from '../src/lib/gender.js';
import type { Gender } from '../src/lib/model.js';

const kindOf = (text: string, gender: Gender = ''): ArticleKind => {
  const { article } = splitArticle(text);
  return articleKind(article, gender);
};

test('the article comes off the front of a stored form', () => {
  assert.deepEqual(splitArticle('la source'), { article: 'la', rest: 'source' });
  assert.deepEqual(splitArticle("l'eau"), { article: "l'", rest: 'eau' });
  assert.deepEqual(splitArticle('les gens'), { article: 'les', rest: 'gens' });
  assert.deepEqual(splitArticle('de la crème'), { article: 'de la', rest: 'crème' });
});

test('a word that only looks like it starts with an article keeps it', () => {
  assert.deepEqual(splitArticle('lesquels'), { article: '', rest: 'lesquels' });
  assert.deepEqual(splitArticle('lundi'), { article: '', rest: 'lundi' });
  assert.deepEqual(splitArticle('descendre'), { article: '', rest: 'descendre' });
  assert.deepEqual(splitArticle('se laver'), { article: '', rest: 'se laver' });
  assert.deepEqual(splitArticle('être'), { article: '', rest: 'être' });
});

test('colour follows the article, and the gender where the article elides', () => {
  assert.equal(kindOf('le train'), 'm');
  assert.equal(kindOf('la source'), 'f');
  assert.equal(kindOf('un club'), 'm');
  assert.equal(kindOf('une bricolette'), 'f');
  assert.equal(kindOf('les vacances'), 'pl');
  assert.equal(kindOf("l'eau", 'f'), 'f');
  assert.equal(kindOf("l'argent", 'm'), 'm');
  assert.equal(kindOf("l'accès"), '', 'no gender stored: better uncoloured than wrong');
  assert.equal(kindOf('être'), '');
});

test('a curly apostrophe is the same article', () => {
  assert.deepEqual(splitArticle('l’eau'), { article: 'l’', rest: 'eau' });
  assert.equal(articleKind('l’', 'f'), 'f');
});

test('a bare noun gets the article its gender calls for', () => {
  assert.equal(articleFor('bricolette', 'f'), 'la');
  assert.equal(articleFor('natel', 'm'), 'le');
  assert.equal(articleFor('eau', 'f'), "l'");
  assert.equal(articleFor('œil', 'm'), "l'");
  assert.equal(articleFor('natel', ''), '', 'no gender, no guess');
});

test('a word you typed is shown with its definite article, like the catalogue', () => {
  assert.equal(withDefiniteArticle('une erreur', 'noun', 'f'), "l'erreur");
  assert.equal(withDefiniteArticle('natel', 'noun', 'm'), 'le natel');
  assert.equal(withDefiniteArticle('la source', 'noun', 'f'), 'la source');
  assert.equal(withDefiniteArticle('un club', 'noun', ''), 'le club', 'the typed article says the gender');
  assert.equal(withDefiniteArticle('ministre', 'noun', 'mf'), 'le/la ministre');
  assert.equal(withDefiniteArticle('enfant', 'noun', 'mf'), "l'enfant");
  assert.equal(withDefiniteArticle('un héros', 'noun', 'm'), 'un héros', 'elision unknown: keep yours');
  assert.equal(withDefiniteArticle('natel', 'noun', ''), 'natel', 'no gender, no article');
  assert.equal(withDefiniteArticle('bonjour', 'phrase', ''), 'bonjour');
  assert.equal(withDefiniteArticle('parfait', 'adj', 'm'), 'parfait');
});

test('a word whose elision the spelling cannot settle gets no article', () => {
  /* "l'hôpital" but "le héros"; "l'oiseau" but "le yaourt". Only a dictionary
     can tell those apart, and the app has none. */
  assert.equal(articleFor('hôpital', 'm'), '');
  assert.equal(articleFor('héros', 'm'), '');
  assert.equal(articleFor('yaourt', 'm'), '');
  assert.equal(articleFor('week-end', 'm'), '');
});

test('a noun that is either gender shows both articles, each its own colour', () => {
  const { article, rest } = splitArticle('le/la enfant');
  assert.equal(article, 'le/la');
  assert.equal(rest, 'enfant');
  assert.deepEqual(articlePieces(article), [
    { text: 'le', kind: 'm' }, { text: '/', kind: '' }, { text: 'la', kind: 'f' },
  ]);
  assert.deepEqual(articlePieces('un/une'), [
    { text: 'un', kind: 'm' }, { text: '/', kind: '' }, { text: 'une', kind: 'f' },
  ]);
});

test('a plain article is one piece', () => {
  assert.deepEqual(articlePieces('les'), [{ text: 'les', kind: 'pl' }]);
  assert.deepEqual(articlePieces("l'", 'f'), [{ text: "l'", kind: 'f' }]);
  assert.deepEqual(articlePieces(''), []);
});

test('a word taught in the plural is shown with les', () => {
  assert.equal(withDefiniteArticle('gens', 'noun', 'm', 'pl'), 'les gens');
  assert.equal(withDefiniteArticle('les vacances', 'noun', 'f', 'pl'), 'les vacances');
  assert.equal(withDefiniteArticle('la vacance', 'noun', 'f', 'pl'), 'les vacance',
    'the plural article wins over the one you typed');
  assert.equal(withDefiniteArticle('gens', 'noun', 'm'), 'le gens', 'singular unless asked');
});

test('by default a word is drawn exactly as it always was', () => {
  const d = describeWord('la source', { gender: 'f' });
  assert.deepEqual(d.pieces, [{ text: 'la', kind: 'f', colour: 'var(--fem)', under: '', underStyle: '' }]);
  assert.equal(d.rest, 'source');
  assert.equal(d.gap, true);
  assert.equal(d.mark, '');
});

test('an elided article leaves no gap, and carries the stored gender', () => {
  const d = describeWord("l'eau", { gender: 'f' });
  assert.equal(d.gap, false);
  assert.equal(d.pieces[0]?.colour, 'var(--fem)');
});

test('your own colours replace the theme’s', () => {
  const d = describeWord('le train', { gender: 'm' }, { colourMasc: '#0f0' });
  assert.equal(d.pieces[0]?.colour, '#0f0');
});

test('colouring can be switched off entirely', () => {
  const d = describeWord('le train', { gender: 'm' }, { genderColour: false });
  assert.equal(d.pieces[0]?.colour, '');
  assert.equal(d.pieces[0]?.kind, 'm', 'the gender is still known, only unpainted');
});

test('a shape cue can be drawn under the article, for a colour-blind eye', () => {
  const m = describeWord('le train', { gender: 'm' }, { genderPattern: 'underline' });
  const f = describeWord('la source', { gender: 'f' }, { genderPattern: 'underline' });
  assert.equal(m.pieces[0]?.underStyle, 'solid');
  assert.equal(f.pieces[0]?.underStyle, 'dotted');
  assert.equal(f.pieces[0]?.under, 'var(--fem)');
});

test('the letter beside the word says the same thing without colour', () => {
  const letters = { genderMark: 'letter' as const };
  assert.equal(describeWord('le train', { gender: 'm' }, letters).mark, '(m)');
  assert.equal(describeWord('la source', { gender: 'f' }, letters).mark, '(f)');
  assert.equal(describeWord('le/la ministre', { gender: 'mf' }, letters).mark, '(m/f)');
  assert.equal(describeWord('les gens', { gender: 'm' }, letters).mark, '(pl m)');
  assert.equal(describeWord("l'accès", {}, letters).mark, '', 'nothing known, nothing claimed');
  assert.equal(describeWord('être', {}, letters).mark, '');
});

test('a plural keeps its own colour, its gender’s, or both', () => {
  const gens = { gender: 'm' as const };
  assert.equal(describeWord('les gens', gens).pieces[0]?.colour, 'var(--plur)');
  assert.equal(describeWord('les gens', gens, { pluralStyle: 'gender' }).pieces[0]?.colour,
    'var(--masc)');
  const both = describeWord('les gens', gens, { pluralStyle: 'both' }).pieces[0];
  assert.ok(both);
  assert.equal(both.colour, 'var(--plur)', 'plural fills');
  assert.equal(both.under, 'var(--masc)', 'gender underlines');
  assert.equal(both.underStyle, 'solid');
});

test('a plural whose gender is unknown stays plural however it is styled', () => {
  for (const pluralStyle of ['plural', 'gender', 'both'] as const) {
    const d = describeWord('les vacances', {}, { pluralStyle });
    assert.equal(d.pieces[0]?.colour, 'var(--plur)');
    assert.equal(d.pieces[0]?.under, '');
  }
});

test('an either-gender noun whose article elides still shows both', () => {
  /* "le/la ministre" has an article for each gender to colour; "l'ami" has one
     for both, so it takes the masculine and wears the feminine underneath. */
  const d = describeWord("l'ami", { gender: 'mf' });
  assert.equal(d.pieces[0]?.kind, 'mf');
  assert.equal(d.pieces[0]?.colour, 'var(--masc)');
  assert.equal(d.pieces[0]?.under, 'var(--fem)');
  assert.equal(describeWord("l'ami", { gender: 'mf' }, { genderMark: 'letter' }).mark, '(m/f)');
  assert.equal(describeWord("l'ami", { gender: 'mf' }, { genderColour: false }).pieces[0]?.colour, '',
    'and none of it when colour is off');
});

test('an article that says the gender itself is untouched by mf', () => {
  assert.equal(describeWord('le train', { gender: 'm' }).pieces[0]?.under, '');
  assert.deepEqual(describeWord('le/la ministre', { gender: 'mf' }).pieces.map((p) => p.kind),
    ['m', '', 'f']);
});
