import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  PERSONS, VERBS, diff, worthMarking, dropPronoun, isRight, nearest, perfect, phrasesOfVerb, spokenLine, tidy,
  withPronoun,
} from '../src/lib/verbs18.js';
import type { Verb } from '../src/lib/verbs18.js';

const verb = (inf: string): Verb => {
  const v = VERBS.find((x) => x.inf === inf);
  if (!v) throw new Error(`no ${inf} on the sheet`);
  return v;
};

test('the sheet has the eighteen verbs, each with six present forms and a participle', () => {
  assert.equal(VERBS.length, 18);
  assert.equal(new Set(VERBS.map((v) => v.inf)).size, 18);
  for (const v of VERBS) {
    assert.equal(v.present.length, PERSONS.length, v.inf);
    assert.ok(v.present.every((f) => f.trim()), `${v.inf} has an empty form`);
    assert.ok(v.pp && v.en, v.inf);
  }
});

test('the regular -er verbs are built right, manger keeping its soft g', () => {
  assert.deepEqual(verb('parler').present, ['parle', 'parles', 'parle', 'parlons', 'parlez', 'parlent']);
  assert.equal(verb('parler').pp, 'parlé');
  assert.equal(verb('manger').present[3], 'mangeons');
  assert.equal(verb('étudier').present[5], 'étudient');
  assert.equal(verb('étudier').pp, 'étudié');
});

test('the irregular ones are written out as French has them', () => {
  assert.deepEqual(verb('être').present, ['suis', 'es', 'est', 'sommes', 'êtes', 'sont']);
  assert.deepEqual(verb('boire').present, ['bois', 'bois', 'boit', 'buvons', 'buvez', 'boivent']);
  assert.equal(verb('prendre').present[5], 'prennent');
  assert.equal(verb('faire').present[4], 'faites');
  assert.deepEqual(VERBS.map((v) => v.pp).slice(0, 4), ['été', 'eu', 'allé', 'fait']);
});

test('je elides before a vowel and a mute h, and nowhere else', () => {
  assert.equal(withPronoun(0, 'ai'), "j'ai");
  assert.equal(withPronoun(0, 'habite'), "j'habite");
  assert.equal(withPronoun(0, 'étudie'), "j'étudie");
  assert.equal(withPronoun(0, 'suis'), 'je suis');
  assert.equal(withPronoun(5, 'ont'), 'ils/elles ont');
});

test('the passé composé takes être for aller and sortir, avoir for the rest', () => {
  assert.equal(perfect(verb('aller')), 'je suis allé(e)');
  assert.equal(perfect(verb('sortir')), 'je suis sorti(e)');
  assert.equal(perfect(verb('manger')), "j'ai mangé");
  assert.equal(VERBS.filter((v) => v.aux === 'être').length, 2);
});

test('what is heard says il and ils, not the slash the table is written with', () => {
  assert.equal(spokenLine(2, 'est'), 'il est');
  assert.equal(spokenLine(5, 'sont'), 'ils sont');
  const p = phrasesOfVerb(verb('avoir'));
  assert.deepEqual(p.present.map((x) => x.text), ["j'ai", 'tu as', 'il a', 'nous avons', 'vous avez', 'ils ont']);
  assert.equal(p.pp.text, "j'ai eu");
  assert.equal(phrasesOfVerb(verb('aller')).pp.text, 'je suis allé', 'the (e) is written, not said');
});

test('every line on the sheet has a clip slot of its own', () => {
  const ids = new Set<string>();
  let count = 0;
  for (const v of VERBS) {
    const p = phrasesOfVerb(v);
    for (const x of [p.inf, ...p.present, p.pp]) { ids.add(`${x.key}#${x.slot}`); count += 1; }
  }
  assert.equal(ids.size, count);
});

test('a missing accent is a wrong answer: the sheet is there to learn the spelling', () => {
  assert.equal(isRight('etes', ['êtes']), false);
  assert.equal(isRight('ete', ['été']), false);
  assert.equal(isRight('êtes', ['êtes']), true);
  assert.equal(isRight('prend', ['prends']), false, 'a one-letter slip is the ending, and wrong');
});

test('case, spacing, the kind of apostrophe and the closing mark are not the spelling', () => {
  assert.equal(isRight('Été', ['été']), true);
  assert.equal(isRight("J’ai un chat", ["J'ai un chat."]), true);
  assert.equal(isRight('tu es  fatigué?', ['Tu es fatigué ?']), true);
  assert.equal(isRight('', ['été']), false);
  assert.equal(tidy('  Vous êtes français ? '), 'vous êtes français');
});

test('a pronoun in front of a form can be taken off', () => {
  assert.equal(dropPronoun("j'ai"), 'ai');
  assert.equal(dropPronoun('nous buvons'), 'buvons');
  assert.equal(dropPronoun('buvons'), 'buvons');
});

test('the difference is marked letter by letter, on both sides', () => {
  const d = diff('etes', 'êtes');
  assert.deepEqual(d.typed, [{ text: 'e', same: false }, { text: 'tes', same: true }]);
  assert.deepEqual(d.want, [{ text: 'ê', same: false }, { text: 'tes', same: true }]);
  const ending = diff('prend', 'prends');
  assert.deepEqual(ending.typed, [{ text: 'prend', same: true }]);
  assert.deepEqual(ending.want, [{ text: 'prend', same: true }, { text: 's', same: false }]);
  assert.deepEqual(diff('e\u0302tes', 'êtes').typed, [{ text: 'êtes', same: true }],
    'an accent typed as a separate mark is the same letter');
  assert.equal(isRight('e\u0302tes', ['êtes']), true);
  assert.deepEqual(diff('Prends', 'prends').typed, [{ text: 'Prends', same: true }], 'a capital is not the mistake');
});

test('both sides of a difference read back as what they came from', () => {
  for (const [a, b] of [['buvont', 'buvons'], ['boivons', 'buvons'], ['', 'été'], ['xyz', '']] as const) {
    const d = diff(a, b);
    assert.equal(d.typed.map((s) => s.text).join(''), a);
    assert.equal(d.want.map((s) => s.text).join(''), b);
  }
});

test('a wrong translation is compared with the wording it was nearest', () => {
  assert.equal(nearest('ou habites-tu', ['Tu habites où ?', 'Où habites-tu ?']), 'Où habites-tu ?');
  assert.equal(nearest('tu habite ou', ['Tu habites où ?', 'Où habites-tu ?']), 'Tu habites où ?');
});

test('a difference is marked where it is a slip, not where it is another sentence', () => {
  assert.equal(worthMarking('etes', 'êtes'), true);
  assert.equal(worthMarking('elle travail le samedi', 'Elle travaille le samedi.'), true);
  assert.equal(worthMarking('je suis etudiant', 'Elle travaille le samedi.'), false);
});
