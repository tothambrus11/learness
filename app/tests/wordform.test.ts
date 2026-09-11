/** Words you typed: what they still need, how they are listed and searched,
 *  and how your corrections sit on the catalogue. */
import { expect, test } from 'vitest';

import type { StudyWord, UserWord } from '../src/lib/types';
import {
  isIncomplete,
  listFields,
  matchWords,
  missingFields,
  sortForList,
  withCorrections,
} from '../src/lib/wordform';
import type { WordRecord } from '../src/lib/wordform';

test('a word with no English cannot be asked, and says so', () => {
  expect(missingFields({ fr: 'le bus', en: ['bus'] })).toEqual([]);
  expect(missingFields({ fr: 'le bus', en: [] })).toEqual(['English']);
  expect(missingFields({ fr: 'le bus', en: [''] })).toEqual(['English']);
  expect(missingFields({ fr: 'le bus' })).toEqual(['English']);
  expect(missingFields({ fr: '  ', en: [] })).toEqual(['French', 'English']);
  expect(missingFields({ fr: 'le bus', en: 'bus' }), 'a plain string counts').toEqual([]);
  expect(isIncomplete({ fr: 'le bus', en: ['bus'] })).toBe(false);
  expect(isIncomplete({ fr: 'le bus', en: [] })).toBe(true);
});

test('unfinished words come first, then the newest', () => {
  /** Four saved words, two of them missing their English. */
  const rows = [
    { k: 'a', fr: 'a', en: ['a'], addedAt: 3 },
    { k: 'b', fr: 'b', en: [], addedAt: 1 },
    { k: 'c', fr: 'c', en: ['c'], addedAt: 5 },
    { k: 'd', fr: 'd', en: [], addedAt: 2 },
  ];
  expect(sortForList(rows).map((r) => r.k)).toEqual(['d', 'b', 'c', 'a']);
  expect(
    rows.map((r) => r.k),
    'the list itself is left alone',
  ).toEqual(['a', 'b', 'c', 'd']);
});

test('missing fields are read out as a sentence would', () => {
  expect(listFields([])).toBe('');
  expect(listFields(['English'])).toBe('English');
  expect(listFields(['French', 'English'])).toBe('French and English');
});

test('the list answers the search box, in either language', () => {
  /** Three of your own words, one with an article, one elided, one with a
   *  two-word English gloss. */
  const mine = [
    { k: 'a', fr: 'le bus', en: ['bus', 'coach'] },
    { k: 'b', fr: "l'école", en: ['school'] },
    { k: 'c', fr: 'le natel', en: ['mobile phone'] },
  ];
  /** The keys a query narrows the list to. */
  const keys = (q: string): string[] => matchWords(mine, q).map((w) => w.k);
  expect(keys('bus'), 'the article is not in the way').toEqual(['a']);
  expect(keys('le bus')).toEqual(['a']);
  expect(keys('ecole'), 'accents are not in the way either').toEqual(['b']);
  expect(keys('école')).toEqual(['b']);
  expect(keys('school'), 'the English side counts').toEqual(['b']);
  expect(keys('phone'), 'and part of it is enough').toEqual(['c']);
  expect(keys('zzz')).toEqual([]);
  expect(keys(''), 'an empty box narrows nothing').toEqual(['a', 'b', 'c']);
  expect(keys('   ')).toEqual(['a', 'b', 'c']);
});

test('matching leaves the list it was given alone', () => {
  const mine = [{ k: 'a', fr: 'le bus', en: ['bus'] }];
  expect(matchWords(mine, '')).not.toBe(mine);
  expect(matchWords(undefined, 'bus')).toEqual([]);
});

test('your corrections sit on top of the catalogue word, not under it', () => {
  /* Promoting copies the catalogue's spelling into your list, so the two agree
     until you change one. Correcting the gender used to do nothing at all. */
  /** The catalogue's own record, recordings and example sentence included. */
  const ami: StudyWord = {
    k: 'ami|noun',
    fr: "l'ami",
    en: ['friend'],
    pos: 'noun',
    gender: 'm',
    ipa: '/a.mi/',
    audio: 'frcog-1.mp3',
    native: 'frcog-1-nat.mp3',
    cue: 'friend',
    cue_audio: 'frcog-1-en.mp3',
    ex: [{ fr: 'Mon ami.', en: 'My friend.', f: 'ami' }],
  };
  /** The row promoting it wrote into your list: the same word, nothing
   *  corrected yet. `k` and `source` are what the store keeps beside a
   *  correction; neither is read here. */
  const promoted: WordRecord & Pick<UserWord, 'k' | 'source'> = {
    k: 'ami|noun',
    fr: "l'ami",
    en: ['friend'],
    pos: 'noun',
    gender: '',
    source: 'catalogue',
  };

  expect(withCorrections(ami, promoted), 'an untouched promotion changes nothing').toEqual({
    ...ami,
    gender: 'm',
    number: '',
  });

  const either = withCorrections(ami, { ...promoted, gender: 'mf' });
  expect(either?.gender).toBe('mf');
  expect(either?.ipa, 'and keeps what only the catalogue has').toBe('/a.mi/');
  expect(either?.audio).toBe('frcog-1.mp3');
  expect(either?.ex).toEqual(ami.ex);
});

test('a correction that changes what is said drops the recording of it', () => {
  /** A catalogue word stored under both articles, with every recording it has. */
  const bus: StudyWord = {
    k: 'bus|noun',
    fr: 'le/la bus',
    en: ['bus'],
    pos: 'noun',
    gender: '',
    audio: 'a.mp3',
    native: 'b.mp3',
    cue: 'bus',
    cue_audio: 'c.mp3',
  };
  const spelled = withCorrections(bus, { fr: 'le bus', pos: 'noun', gender: 'm' });
  expect(spelled?.fr).toBe('le bus');
  expect(spelled?.answer).toBe('le bus');
  expect(spelled?.audio, 'the clip says the old spelling').toBe(null);
  const glossed = withCorrections(bus, { en: ['coach'], pos: 'noun' });
  expect(glossed?.en).toEqual(['coach']);
  expect(glossed?.cue).toBe('coach');
  expect(glossed?.cue_audio).toBe(null);
  expect(glossed?.audio, 'but the French was not touched').toBe('a.mp3');
});

test('a word with no correction, and a deleted one, come back as they were', () => {
  const w: StudyWord = { k: 'a|noun', fr: 'le bus', en: ['bus'], pos: 'noun', gender: 'm' };
  expect(withCorrections(w, null)).toBe(w);
  expect(withCorrections(w, { gender: 'f', deleted: true })).toBe(w);
});
