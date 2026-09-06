import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  articleFor, articleKind, articlePieces, splitArticle, withDefiniteArticle,
} from '../src/lib/gender.js';

const kindOf = (text, gender = '') => {
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
