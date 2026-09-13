import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isIncomplete, listFields, matchWords, missingFields, sortForList, withCorrections }
  from '../src/lib/wordform.js';
import { ms, userWord, word } from './make.js';

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
    userWord({ k: 'a|noun', fr: 'a', en: ['a'], addedAt: ms(3) }),
    userWord({ k: 'b|noun', fr: 'b', en: [], addedAt: ms(1) }),
    userWord({ k: 'c|noun', fr: 'c', en: ['c'], addedAt: ms(5) }),
    userWord({ k: 'd|noun', fr: 'd', en: [], addedAt: ms(2) }),
  ];
  assert.deepEqual(sortForList(rows).map((r) => r.k),
    ['d|noun', 'b|noun', 'c|noun', 'a|noun']);
  assert.deepEqual(rows.map((r) => r.k), ['a|noun', 'b|noun', 'c|noun', 'd|noun'],
    'the list itself is left alone');
});

test('missing fields are read out as a sentence would', () => {
  assert.equal(listFields([]), '');
  assert.equal(listFields(['English']), 'English');
  assert.equal(listFields(['French', 'English']), 'French and English');
});

test('the list answers the search box, in either language', () => {
  const mine = [
    userWord({ k: 'a|noun', fr: 'le bus', en: ['bus', 'coach'] }),
    userWord({ k: 'b|noun', fr: "l'école", en: ['school'] }),
    userWord({ k: 'c|noun', fr: 'le natel', en: ['mobile phone'] }),
  ];
  const keys = (q: string): string[] => matchWords(mine, q).map((w) => w.k);
  assert.deepEqual(keys('bus'), ['a|noun'], 'the article is not in the way');
  assert.deepEqual(keys('le bus'), ['a|noun']);
  assert.deepEqual(keys('ecole'), ['b|noun'], 'accents are not in the way either');
  assert.deepEqual(keys('école'), ['b|noun']);
  assert.deepEqual(keys('school'), ['b|noun'], 'the English side counts');
  assert.deepEqual(keys('phone'), ['c|noun'], 'and part of it is enough');
  assert.deepEqual(keys('zzz'), []);
  assert.deepEqual(keys(''), ['a|noun', 'b|noun', 'c|noun'], 'an empty box narrows nothing');
  assert.deepEqual(keys('   '), ['a|noun', 'b|noun', 'c|noun']);
});

test('matching leaves the list it was given alone', () => {
  const mine = [userWord({ k: 'a|noun', fr: 'le bus', en: ['bus'] })];
  assert.notEqual(matchWords(mine, ''), mine);
  assert.deepEqual(matchWords([], 'bus'), []);
});

test('your corrections sit on top of the catalogue word, not under it', () => {
  /* Promoting copies the catalogue's spelling into your list, so the two agree
     until you change one. Correcting the gender used to do nothing at all. */
  const ami = word({ k: 'ami|noun', fr: "l'ami", answer: "l'ami", lemma: 'ami', en: ['friend'],
    pos: 'noun', gender: 'm', ipa: '/a.mi/', audio: 'frcog-1.mp3', native: 'frcog-1-nat.mp3',
    cue: 'friend', cue_audio: 'frcog-1-en.mp3',
    ex: [{ fr: 'Mon ami.', en: 'My friend.', f: 'ami' }] });
  const promoted = userWord({ k: 'ami|noun', fr: "l'ami", en: ['friend'], pos: 'noun',
    gender: '', source: 'catalogue' });

  assert.deepEqual(withCorrections(ami, promoted), { ...ami, gender: 'm', number: '' },
    'an untouched promotion changes nothing');

  const either = withCorrections(ami, { ...promoted, gender: 'mf' });
  assert.equal(either?.gender, 'mf');
  assert.equal(either?.ipa, '/a.mi/', 'and keeps what only the catalogue has');
  assert.equal(either?.audio, 'frcog-1.mp3');
  assert.deepEqual(either?.ex, ami.ex);
});

test('a correction that changes what is said drops the recording of it', () => {
  const bus = word({ k: 'bus|noun', fr: 'le/la bus', answer: 'le/la bus', lemma: 'bus',
    en: ['bus'], pos: 'noun', gender: '', audio: 'a.mp3', native: 'b.mp3', cue: 'bus',
    cue_audio: 'c.mp3' });
  const spelled = withCorrections(bus,
    userWord({ k: 'bus|noun', fr: 'le bus', pos: 'noun', gender: 'm' }));
  assert.equal(spelled?.fr, 'le bus');
  assert.equal(spelled?.answer, 'le bus');
  assert.equal(spelled?.audio, null, 'the clip says the old spelling');
  const glossed = withCorrections(bus,
    userWord({ k: 'bus|noun', fr: 'le/la bus', en: ['coach'], pos: 'noun' }));
  assert.deepEqual(glossed?.en, ['coach']);
  assert.equal(glossed?.cue, 'coach');
  assert.equal(glossed?.cue_audio, null);
  assert.equal(glossed?.audio, 'a.mp3', 'but the French was not touched');
});

test('a word with no correction, and a deleted one, come back as they were', () => {
  const w = word({ k: 'a|noun', fr: 'le bus', answer: 'le bus', lemma: 'bus', en: ['bus'],
    pos: 'noun', gender: 'm' });
  assert.equal(withCorrections(w, null), w);
  assert.equal(withCorrections(w, userWord({ k: 'a|noun', gender: 'f', deleted: true })), w);
});
