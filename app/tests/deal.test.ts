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

test('a number drill needs no verb, follows the numerals setting, and comes back from its id', async () => {
  const { instanceForId } = await import('../src/lib/grammar/deal.js');
  const dealt = dealRules({ due: ['N.et-un'], verbs: [], cards: [], attempts: [], limit: 3 });
  assert.equal(dealt[0]?.instance.face, 'spell');
  assert.match(dealt[0]?.instance.id ?? '', /^number:\d1$/);
  const fr = dealRules({ due: ['N.tens'], verbs: [], cards: [], attempts: [], limit: 3, dialect: 'fr' });
  assert.match(fr[0]?.instance.id ?? '', /^number:\d0:fr$/);
  assert.equal(instanceForId('number:281', null)?.cells[0]?.expected, 'deux cent huitante et un');
  assert.equal(instanceForId('number:281:fr', null, 'fr')?.cells[0]?.expected, 'deux cent quatre-vingt-un');
  assert.equal(instanceForId('number:7777', null), null, 'a number no pool drills');
  assert.equal(instanceForId('table:x|verb:pres', null), null, 'a verb that is gone');
  const read = dealRules({ due: ['N.french-tens'], verbs: [], cards: [], attempts: [], limit: 3 });
  assert.equal(read[0]?.instance.face, 'which', 'the Swiss learner reads those, never writes them');
  const both = dealRules({ due: ['N.french-tens'], verbs: [], cards: [], attempts: [], limit: 3, dialect: 'fr' });
  assert.ok(both[0], 'a learner who writes them reads them too');
});

test('a determiner drill is dealt on the learner’s nouns, and comes back from its id', async () => {
  const { instanceForId } = await import('../src/lib/grammar/deal.js');
  const jour = word({ k: 'jour|noun', fr: 'le jour', gender: 'm', en: ['day'] });
  const dealt = dealRules({ due: ['D.contract', 'V.pres-er'], verbs: [], nouns: [jour], cards: [], attempts: [], limit: 3 });
  assert.deepEqual(dealt.map((d) => d.instance.id), ['det:jour|noun:D.contract'], 'no verb for the table');
  assert.equal(instanceForId('det:jour|noun:D.possessive', jour)?.cells[0]?.expected, 'mon jour');
  assert.equal(instanceForId('det:jour|noun:D.possessive', null), null);
});

test('a passed rule is dealt one form at a time, never a whole table again', () => {
  const dealt = dealRules({ due: ['V.pres-er'], verbs, cards: [], attempts: [], limit: 3, passed: new Set(['V.pres-er']) });
  assert.match(dealt[0]?.instance.id ?? '', /^form:[a-z]+\|verb:pres:[1-6]$/);
  assert.equal(dealt[0]?.instance.cells.length, 1);
  const table = dealRules({ due: ['V.pres-er'], verbs, cards: [], attempts: [], limit: 3 });
  assert.match(table[0]?.instance.id ?? '', /^table:/);
});

test('an ordinal and a time are dealt from nothing, and come back from their ids', async () => {
  const { instanceForId, madeFrom } = await import('../src/lib/grammar/deal.js');
  const dealt = dealRules({ due: ['N.ordinal', 'N.time'], verbs: [], cards: [], attempts: [], limit: 3 });
  assert.deepEqual(dealt.map((d) => d.instance.rule), ['N.ordinal', 'N.time']);
  assert.equal(madeFrom('N.time'), 'nothing');
  assert.equal(instanceForId('ordinal:5', null)?.cells[0]?.expected, 'cinquième');
  assert.equal(instanceForId('time:12:30', null)?.cells[0]?.expected, 'il est midi et demi');
});

test('a date is dealt from nothing and comes back from its id, weekday and year included', async () => {
  const { instanceForId } = await import('../src/lib/grammar/deal.js');
  const dealt = dealRules({ due: ['N.date'], verbs: [], cards: [], attempts: [], limit: 3 });
  assert.equal(dealt[0]?.instance.rule, 'N.date');
  assert.equal(instanceForId('date:3.9:w4', null)?.cells[0]?.expected, 'jeudi trois septembre');
  assert.equal(instanceForId('date:11.11:1918', null)?.cells[1]?.expected, 'en mille neuf cent dix-huit');
  assert.equal(instanceForId('date:9.9', null), null, 'not in the pool');
});

test('an age and a price are dealt from nothing and come back from their ids', async () => {
  const { instanceForId } = await import('../src/lib/grammar/deal.js');
  const dealt = dealRules({ due: ['N.age-duration', 'N.prices'], verbs: [], cards: [], attempts: [], limit: 3 });
  assert.deepEqual(dealt.map((d) => d.instance.rule), ['N.age-duration', 'N.prices']);
  assert.equal(instanceForId('age:elle:21', null)?.cells[0]?.expected, 'elle a vingt et un ans');
  assert.equal(instanceForId('price:1.20:euro', null)?.cells[0]?.expected, 'un euro vingt');
  assert.equal(instanceForId('price:9.99:euro', null), null);
});

test('the pattern drills are dealt and come back from their ids, the verb’s and the rule’s own alike', async () => {
  const { instanceForId } = await import('../src/lib/grammar/deal.js');
  const pc = { id: 'pc', label: 'Passé composé', aux: 'avoir', aux_key: 'pres', aux_form: 'ai', participle: 'parlé',
    example: '', why: '', agrees: false };
  const parler = word({ k: 'parler|verb', en: ['to speak'], conj: { ...er('parler'), compound: [pc],
    examples: { pc: [{ fr: 'Elle a parlé.', f: 'a parlé', en: '', id: 5 }] } } });
  const dealt = dealRules({ due: ['V.pc-vs-imp', 'G.pas-compound', 'P.verb-endings', 'D.gender-endings', 'N.french-tens'],
    verbs: [parler], cards: [], attempts: [], limit: 5 });
  assert.deepEqual(dealt.map((d) => d.instance.face), ['which', 'order', 'mark', 'which', 'which']);
  assert.equal(instanceForId('order:parler|verb:G.pas-compound', parler)?.cells[0]?.expected, "je n'ai pas parlé");
  assert.equal(instanceForId('mark:parler|verb:P.verb-endings', parler)?.face, 'mark');
  assert.equal(instanceForId('ending:tion', null)?.cells[0]?.expected, 'feminine');
  assert.equal(instanceForId('french:81', null)?.cells[0]?.expected, '81');
});

test('a rule with two generators is one drill: the list has no rule twice', async () => {
  /* The French compounds are read by everyone and written by some, and
     listing the rule from both generators put two rows with one key on the
     Grammar screen, which the browser refused to draw. */
  const { DRILL_RULE_IDS } = await import('../src/lib/grammar/deal.js');
  assert.equal(new Set(DRILL_RULE_IDS).size, DRILL_RULE_IDS.length);
  assert.ok(DRILL_RULE_IDS.includes('N.french-tens'));
});

test('a rule that is said and heard is dealt three ways, the heard way only where the device has a voice', async () => {
  const { candidatesFor, instanceForId } = await import('../src/lib/grammar/deal.js');
  const faces = (hear: boolean) => new Set(candidatesFor('N.units', [], 'ch', [], false, hear).map((i) => i.face));
  assert.deepEqual([...faces(true)].sort(), ['hear', 'say', 'spell']);
  assert.deepEqual([...faces(false)].sort(), ['say', 'spell'], 'no voice, nothing heard');
  assert.deepEqual([...new Set(candidatesFor('N.cent', [], 'ch').map((i) => i.face))], ['spell'], 'hundreds are written only');
  assert.equal(instanceForId('say:number:41', null)?.face, 'say');
  assert.equal(instanceForId('hear:number:41', null)?.face, 'hear');
  const said = candidatesFor('V.pres-er', verbs, 'ch', [], true).filter((i) => i.face === 'say');
  assert.equal(said.length, 18, 'six forms of three verbs, said, once the rule is passed');
  assert.equal(said[0]?.speech?.text, 'je parle');
  assert.equal(instanceForId('say:form:parler|verb:pres:4', verbs[0]!)?.speech?.text, 'nous parlons');
});
