import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIncomplete, listFields, matchWords, missingFields, sortForList, withCorrections }
  from '../src/lib/wordform.js';

test('a word with no English cannot be asked, and says so', () => {
  assert.deepEqual(missingFields({ fr: 'le bus', en: ['bus'] }), []);
  assert.deepEqual(missingFields({ fr: 'le bus', en: [] }), ['English']);
  assert.deepEqual(missingFields({ fr: 'le bus', en: [''] }), ['English']);
  assert.deepEqual(missingFields({ fr: 'le bus' }), ['English']);
  assert.deepEqual(missingFields({ fr: '  ', en: [] }), ['French', 'English']);
  assert.deepEqual(missingFields({ fr: 'le bus', en: 'bus' }), [], 'a plain string counts');
  assert.equal(isIncomplete({ fr: 'le bus', en: ['bus'] }), false);
  assert.equal(isIncomplete({ fr: 'le bus', en: [] }), true);
});

test('unfinished words come first, then the newest', () => {
  const rows = [
    { k: 'a', fr: 'a', en: ['a'], addedAt: 3 },
    { k: 'b', fr: 'b', en: [], addedAt: 1 },
    { k: 'c', fr: 'c', en: ['c'], addedAt: 5 },
    { k: 'd', fr: 'd', en: [], addedAt: 2 },
  ];
  assert.deepEqual(sortForList(rows).map((r) => r.k), ['d', 'b', 'c', 'a']);
  assert.deepEqual(rows.map((r) => r.k), ['a', 'b', 'c', 'd'], 'the list itself is left alone');
});

test('missing fields are read out as a sentence would', () => {
  assert.equal(listFields([]), '');
  assert.equal(listFields(['English']), 'English');
  assert.equal(listFields(['French', 'English']), 'French and English');
});

test('the list answers the search box, in either language', () => {
  const mine = [
    { k: 'a', fr: 'le bus', en: ['bus', 'coach'] },
    { k: 'b', fr: "l'école", en: ['school'] },
    { k: 'c', fr: 'le natel', en: ['mobile phone'] },
  ];
  const keys = (q) => matchWords(mine, q).map((w) => w.k);
  assert.deepEqual(keys('bus'), ['a'], 'the article is not in the way');
  assert.deepEqual(keys('le bus'), ['a']);
  assert.deepEqual(keys('ecole'), ['b'], 'accents are not in the way either');
  assert.deepEqual(keys('école'), ['b']);
  assert.deepEqual(keys('school'), ['b'], 'the English side counts');
  assert.deepEqual(keys('phone'), ['c'], 'and part of it is enough');
  assert.deepEqual(keys('zzz'), []);
  assert.deepEqual(keys(''), ['a', 'b', 'c'], 'an empty box narrows nothing');
  assert.deepEqual(keys('   '), ['a', 'b', 'c']);
});

test('matching leaves the list it was given alone', () => {
  const mine = [{ k: 'a', fr: 'le bus', en: ['bus'] }];
  assert.notEqual(matchWords(mine, ''), mine);
  assert.deepEqual(matchWords(undefined, 'bus'), []);
});

test('your corrections sit on top of the catalogue word, not under it', () => {
  /* Promoting copies the catalogue's spelling into your list, so the two agree
     until you change one. Correcting the gender used to do nothing at all. */
  const ami = { k: "ami|noun", fr: "l'ami", en: ['friend'], pos: 'noun', gender: 'm',
    ipa: '/a.mi/', audio: 'frcog-1.mp3', native: 'frcog-1-nat.mp3', cue: 'friend',
    cue_audio: 'frcog-1-en.mp3', ex: [{ fr: 'Mon ami.', f: 'ami' }] };
  const promoted = { k: 'ami|noun', fr: "l'ami", en: ['friend'], pos: 'noun', gender: '',
    source: 'catalogue' };

  assert.deepEqual(withCorrections(ami, promoted), { ...ami, gender: 'm', number: '' },
    'an untouched promotion changes nothing');

  const either = withCorrections(ami, { ...promoted, gender: 'mf' });
  assert.equal(either.gender, 'mf');
  assert.equal(either.ipa, '/a.mi/', 'and keeps what only the catalogue has');
  assert.equal(either.audio, 'frcog-1.mp3');
  assert.deepEqual(either.ex, ami.ex);
});

test('a correction that changes what is said drops the recording of it', () => {
  const bus = { k: 'bus|noun', fr: 'le/la bus', en: ['bus'], pos: 'noun', gender: '',
    audio: 'a.mp3', native: 'b.mp3', cue: 'bus', cue_audio: 'c.mp3' };
  const spelled = withCorrections(bus, { fr: 'le bus', pos: 'noun', gender: 'm' });
  assert.equal(spelled.fr, 'le bus');
  assert.equal(spelled.answer, 'le bus');
  assert.equal(spelled.audio, null, 'the clip says the old spelling');
  const glossed = withCorrections(bus, { en: ['coach'], pos: 'noun' });
  assert.deepEqual(glossed.en, ['coach']);
  assert.equal(glossed.cue, 'coach');
  assert.equal(glossed.cue_audio, null);
  assert.equal(glossed.audio, 'a.mp3', 'but the French was not touched');
});

test('a word with no correction, and a deleted one, come back as they were', () => {
  const w = { k: 'a|noun', fr: 'le bus', en: ['bus'], pos: 'noun', gender: 'm' };
  assert.equal(withCorrections(w, null), w);
  assert.equal(withCorrections(w, { gender: 'f', deleted: true }), w);
});
