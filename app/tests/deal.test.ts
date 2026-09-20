/** Which exercise a sitting deals for a rule owed: on a verb not yet
 *  answered, in a seeded order, else the one answered longest ago; and
 *  nothing for a rule the learner has no verb for.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dealRules, pickInstance } from '../src/lib/grammar/deal.js';
import { tablesFor } from '../src/lib/grammar/table.js';
import type { Conjugation } from '../src/lib/model.js';
import { attempt, ruleCard, sec, word } from './make.js';

function er(lemma: string): Conjugation {
  const stem = lemma.slice(0, -2);
  const pron = ['je', 'tu', 'il', 'nous', 'vous', 'ils'];
  const ends = ['e', 'es', 'e', 'ons', 'ez', 'ent'];
  return {
    lemma, aux: 'avoir', shape: '', compound: [], impersonal: [], links: [], examples: {},
    groups: [{ id: 'pres', mood: '', tense: 'Présent', stem, irregular: false, note: '',
      rows: ends.map((e, i) => ({ p: pron[i]!, s: stem, e, f: stem + e })) }],
  };
}
const verbs = ['parler', 'aimer', 'chanter'].map((l) =>
  word({ k: `${l}|verb`, fr: l, lemma: l, pos: 'verb', en: ['to'], conj: er(l) }));
const tables = verbs.flatMap((v) => tablesFor(v));
const on = (instance: string, ts: number) => attempt({ instance, ts: sec(ts) });

test('a rule owed is dealt on a verb it has not been answered on, in a seeded order that moves on', () => {
  const first = pickInstance(tables, []);
  assert.ok(first);
  const second = pickInstance(tables, [on(first.id, 100)]);
  assert.ok(second && second.id !== first.id, 'never the same verb while another is fresh');
  assert.equal(pickInstance(tables, []), first, 'the same records deal the same verb');
});

test('once every verb has been answered, the one answered longest ago comes round', () => {
  const answered = [on('table:parler|verb:pres', 300), on('table:aimer|verb:pres', 100),
    on('table:chanter|verb:pres', 200), on('table:aimer|verb:pres', 50)];
  assert.equal(pickInstance(tables, answered)?.id, 'table:aimer|verb:pres', 'its last answer was earliest');
  assert.equal(pickInstance([], answered), null);
});

test('the sitting deals one exercise per rule owed, up to the limit, on the rule’s own card', () => {
  const card = ruleCard('V.pres-er', 'produce', { reps: 3 });
  const dealt = dealRules({ due: ['V.pres-er', 'V.pres-ir', 'G.pas'], verbs, cards: [card], attempts: [], limit: 3 });
  assert.equal(dealt.length, 1, 'no -ir verb to ask on, and negation has no generator yet');
  assert.equal(dealt[0]?.card, card, 'the card as stored');
  assert.equal(dealt[0]?.instance.rule, 'V.pres-er');
  const fresh = dealRules({ due: ['V.pres-er'], verbs, cards: [], attempts: [], limit: 3 });
  assert.equal(fresh[0]?.card.id, 'V.pres-er|produce', 'a rule never asked gets a card made on the spot');
  assert.equal(fresh[0]?.card.reps, 0);
  assert.deepEqual(dealRules({ due: ['V.pres-er'], verbs, cards: [], attempts: [], limit: 0 }), []);
});

test('negation is dealt on a verb’s présent sentences, and each sentence is an instance of its own', () => {
  const aimer = word({ k: 'aimer|verb', fr: 'aimer', lemma: 'aimer', pos: 'verb', en: ['to like'], conj: {
    ...er('aimer'),
    examples: { pres: [{ fr: "J'aime le café.", f: 'aime', en: '', id: 1 }, { fr: 'Nous aimons ça.', f: 'aimons', en: '', id: 2 }] },
  } });
  const dealt = dealRules({ due: ['G.pas', 'V.pres-er'], verbs: [aimer], cards: [], attempts: [], limit: 3 });
  const first = dealt[0]?.instance.id ?? '';
  assert.ok(/^sentence:aimer\|verb:[12]:G\.pas$/.test(first), first);
  assert.equal(dealt[1]?.instance.id, 'table:aimer|verb:pres');
  const again = dealRules({ due: ['G.pas'], verbs: [aimer], cards: [], attempts: [on(first, 5)], limit: 3 });
  assert.ok(again[0] && again[0].instance.id !== first && again[0].instance.id.startsWith('sentence:aimer|verb:'),
    'the other sentence next');
});
