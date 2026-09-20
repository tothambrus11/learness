/** What the Grammar screen shows, and the two acts it offers, away from the
 *  screen: which verb a lesson is shown on, what the home line says, and
 *  that opening and closing a bit is written down and told.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { State } from 'ts-fsrs';
import { candidateVerbs, formsLine, hasTense } from '../src/lib/grammar/screen.js';
import { freshApp } from './harness.js';
import { card, entry } from './make.js';
import type { Conjugation } from '../src/lib/model.js';

const index = [
  entry({ k: 'parler|verb', fr: 'parler' }), entry({ k: 'finir|verb', fr: 'finir' }),
  entry({ k: 'partir|verb', fr: 'partir' }), entry({ k: 'bug|noun' }),
];

test('the verb a lesson is shown on is the best known: mature first, then the strongest', () => {
  const cards = [
    card('bug|noun', 'written', 'write', { stability: 90, state: State.Review }),
    card('parler|verb', 'written', 'write', { stability: 3, state: State.Review }),
    card('finir|verb', 'written', 'recognise', { stability: 40, state: State.Review }),
    card('partir|verb', 'written', 'write', { stability: 25, state: State.Review }),
    card('partir|verb', 'form', 'voice', { stability: 99, state: State.Review }),
  ];
  assert.deepEqual(candidateVerbs(cards, index), ['finir|verb', 'partir|verb', 'parler|verb'],
    'the noun is not a verb, and a form card is not how well the verb is known');
  assert.deepEqual(candidateVerbs([], index), [], 'no verb known, no example');
});

test('a table has a tense to show when a group has a form in it, or a compound is there', () => {
  const conj: Conjugation = {
    lemma: 'parler', aux: 'avoir', shape: '', links: [], impersonal: [], examples: {},
    groups: [
      { id: 'pres', mood: '', tense: 'Présent', stem: 'parl', irregular: false, note: '',
        rows: [{ p: 'je', s: 'parl', e: 'e', f: 'parle' }] },
      { id: 'hist', mood: '', tense: 'Passé simple', stem: '', irregular: false, note: '',
        rows: [{ p: 'je', s: '', e: '', f: '' }] },
    ],
    compound: [{ id: 'pc', label: 'Passé composé', aux: 'avoir', aux_key: 'pres', aux_form: 'ai',
      participle: 'parlé', example: "j'ai parlé", why: '', agrees: false }],
  };
  assert.equal(hasTense(conj, 'pres'), true);
  assert.equal(hasTense(conj, 'pc'), true, 'a compound tense is in the compounds');
  assert.equal(hasTense(conj, 'hist'), false, 'a group with no form in it is nothing to show');
  assert.equal(hasTense(conj, 'imp'), false);
  assert.equal(hasTense(null, 'pres'), false);
});

test('the home line says where the verb forms stand, in a sentence', () => {
  assert.equal(formsLine(0, 'Présent'), 'Verb forms: pick a tense to start');
  assert.equal(formsLine(1, 'Passé composé'), 'Verb forms: 1 tense open · next: Passé composé');
  assert.equal(formsLine(3, 'Futur simple'), 'Verb forms: 3 tenses open · next: Futur simple');
  assert.equal(formsLine(12, null), 'Verb forms: 12 tenses open, every one');
});

test('opening a bit is written down and told; closing it is a tombstone that keeps the first opening', async () => {
  const app = await freshApp();
  const bits = await import('../src/lib/grammar/bits.js');
  const told: string[] = [];
  const stop = bits.onBitsChanged((id) => { told.push(id); });

  await bits.openBit('V.pres-er');
  const [opened] = await app.db.openBits();
  assert.equal(opened?.id, 'V.pres-er');
  assert.ok(opened?.openedAt, 'when it was started');
  assert.deepEqual(told, ['V.pres-er']);

  await bits.openBit('V.pres-er');
  assert.equal((await app.db.openBits())[0]?.openedAt, opened?.openedAt, 'started once, whatever is tapped');

  await bits.closeBit('V.pres-er');
  assert.deepEqual(await app.db.openBits(), [], 'closed is not open');
  const [closed] = await app.db.allBits();
  assert.equal(closed?.deleted, true, 'and is a record the sync carries');
  assert.equal(closed?.openedAt, opened?.openedAt, 'the first opening is kept with it');
  assert.deepEqual(told, ['V.pres-er', 'V.pres-er', 'V.pres-er']);
  stop();
});
