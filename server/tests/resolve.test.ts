/** What the connector does with a word before it writes it.
 *
 *  A table over the places a word can already be: the learner's own list,
 *  the catalogue, the dictionary, this very batch — and over the ways out of
 *  a collision. The first connector had none of this, keyed by the typed
 *  spelling, and made "le train|noun" beside the catalogue's "train|noun":
 *  one word, two cards, one mute.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { trustWordKey as k } from '../../app/src/lib/keys.js';
import type { DictEntry, IndexEntry, StoredCard, UserWord } from '../../app/src/lib/model.js';
import { emptyCard, State } from '../../app/src/lib/scheduler.js';
import type { Millis } from '../../app/src/lib/units.js';
import { resolveAdditions, resolveEdit } from '../src/resolve.js';
import type { Context, Outcome, Proposal } from '../src/resolve.js';

const NOW = 1_800_000_000_000 as Millis;

const entry = (key: string, fr: string, en: string[]): IndexEntry =>
  ({ k: k(key), fr, en, lvl: 1, m: 0.001 });
const CATALOGUE: IndexEntry[] = [
  entry('train|noun', 'le train', ['train']),
  entry('pont|noun', 'le pont', ['bridge']),
  entry('marche|noun', 'la marche', ['walk', 'step']),
  entry('poste|noun', 'le poste', ['position', 'set']),
  entry('poste|noun-f', 'la poste', ['post office']),
  entry('dans|prep', 'dans', ['in']),
];
const DICT: Record<string, DictEntry[]> = {
  c: [{ fr: 'la chaussette', en: ['sock'], pos: 'noun', gender: 'f', ipa: '/ʃo.sɛt/' }],
  p: [{ fr: 'plonger', en: ['to dive'], pos: 'verb', ipa: '/plɔ̃.ʒe/' },
      { fr: 'le pot', en: ['pot'], pos: 'noun', gender: 'm' }],
  m: [{ fr: 'marcher', en: ['to walk'], pos: 'verb' }],
};

const mine = ({ k: key, ...over }: Omit<Partial<UserWord>, 'k'> & { k: string; fr: string }): UserWord => ({
  en: [], pos: 'noun', source: 'app', addedAt: NOW, updatedAt: NOW, ...over, k: k(key),
});

/** A card in the state the test names: fresh, or reviewed to a stability. */
const card = (key: string, stability = 0): StoredCard => {
  const c = emptyCard(k(key), 'written', 'recognise', new Date(NOW));
  return stability ? { ...c, state: State.Review, stability, due: new Date(NOW + 864e5) } : c;
};

function ctx(over: Partial<Context> = {}): Context {
  return {
    mine: [], catalogue: CATALOGUE, cards: [], now: NOW,
    dictionary: (letter) => DICT[letter] ?? [], ...over,
  };
}

const one = (p: Partial<Proposal> & { fr: string }, c: Context = ctx()): Outcome =>
  resolveAdditions([{ en: [], ...p }], c)[0]!.outcome;

test('a word nobody knows is added as your own, keyed by its spelling', () => {
  const out = one({ fr: 'le natel', en: ['mobile phone'], pos: 'noun', gender: 'm' },
    ctx({ lesson: 'Tuesday' }));
  assert.equal(out.action, 'add');
  assert(out.action === 'add');
  assert.equal(out.record.k, 'le natel|noun');
  assert.equal(out.record.source, 'app');
  assert.equal(out.record.lesson, 'Tuesday');
  assert.equal(out.record.gender, 'm');
  assert.equal(out.record.addedAt, NOW);
});

test('a word the catalogue teaches is promoted under the catalogue\'s key', () => {
  for (const fr of ['le train', 'train', 'Train', 'un train']) {
    const out = one({ fr, en: ['the train'] });
    assert.equal(out.action, 'promote', fr);
    assert(out.action === 'promote');
    assert.equal(out.record.k, 'train|noun');
    assert.equal(out.record.fr, 'le train');
    assert.equal(out.record.source, 'catalogue');
    assert.equal(out.was, 'in the catalogue, not scheduled');
    /* The lesson's gloss leads, the catalogue's follow, nothing twice. */
    assert.deepEqual(out.record.en, ['the train', 'train']);
  }
});

test('a promoted word already being studied says so', () => {
  const out = one({ fr: 'le train' }, ctx({ cards: [card('train|noun', 40)] }));
  assert(out.action === 'promote');
  assert.equal(out.was, 'known');
});

test('the same word said again with nothing new is left alone', () => {
  const have = mine({ k: 'le natel|noun', fr: 'le natel', en: ['mobile phone'] });
  const out = one({ fr: 'le natel', en: ['mobile phone'], pos: 'noun' }, ctx({ mine: [have] }));
  assert.equal(out.action, 'unchanged');
});

test('the same key with a different gloss is a decision, and force merges it', () => {
  const have = mine({ k: 'le natel|noun', fr: 'le natel', en: ['mobile phone'] });
  const c = ctx({ mine: [have], cards: [card('le natel|noun', 3)] });
  const out = one({ fr: 'le natel', en: ['cell phone'], pos: 'noun' }, c);
  assert(out.action === 'conflict');
  assert.deepEqual(out.candidates.map((x) => [x.source, x.key, x.relation, x.status]),
    [['mine', 'le natel|noun', 'same key', 'learning']]);
  const forced = one({ fr: 'le natel', en: ['cell phone'], pos: 'noun', resolve: { force: true } }, c);
  assert(forced.action === 'update');
  /* The existing gloss stays first: the card's cue does not change under you. */
  assert.deepEqual(forced.record.en, ['mobile phone', 'cell phone']);
  assert.deepEqual(forced.changed, ['en']);
  assert.equal(forced.record.k, 'le natel|noun', 'the key is the word\'s identity');
});

test('your list holding the word under another key is never silently doubled', () => {
  /* What the first connector left behind: the catalogue's word keyed by
     the typed spelling. Adding "train" must not make a third. */
  const old = mine({ k: 'le train|noun', fr: 'le train', en: ['train'] });
  const c = ctx({ mine: [old], cards: [card('le train|noun')] });
  const out = one({ fr: 'train', en: ['train'] }, c);
  assert(out.action === 'conflict');
  assert.deepEqual(out.candidates.map((x) => [x.source, x.key, x.relation, x.status]), [
    ['mine', 'le train|noun', 'same word', 'up next'],
    ['catalogue', 'train|noun', 'same word', 'in the catalogue, not scheduled'],
  ]);
  /* Use the catalogue's: promoted under its key, the old copy untouched here
     (removing it is a separate, visible step). */
  const used = one({ fr: 'train', en: ['railway train'], resolve: { use: 'train|noun' } }, c);
  assert(used.action === 'promote');
  assert.equal(used.record.k, 'train|noun');
  /* Or use your own: updated in place. */
  const kept = one({ fr: 'train', en: ['railway train'], resolve: { use: 'le train|noun' } }, c);
  assert(kept.action === 'update');
  assert.deepEqual(kept.record.en, ['train', 'railway train']);
});

test('a word only the dictionary knows arrives filled in from it', () => {
  const out = one({ fr: 'chaussette', en: ['sock'] });
  assert(out.action === 'add');
  assert.equal(out.from, 'dictionary');
  assert.equal(out.record.k, 'la chaussette|noun');
  assert.equal(out.record.fr, 'la chaussette');
  assert.equal(out.record.gender, 'f');
  assert.equal(out.record.ipa, '/ʃo.sɛt/');
  assert.equal(out.record.pos, 'noun');
});

test('the catalogue having the word as another part of speech is a question', () => {
  const out = one({ fr: 'marche', en: ['walk (imperative)'], pos: 'verb' });
  assert(out.action === 'conflict');
  assert.deepEqual(out.candidates.map((x) => [x.source, x.key, x.relation]),
    [['catalogue', 'marche|noun', 'same word, different part of speech']]);
  const forced = one({ fr: 'marche', en: ['walk!'], pos: 'verb', resolve: { force: true } });
  assert(forced.action === 'add');
  assert.equal(forced.record.k, 'marche|verb');
});

test('a spelling the catalogue holds twice is settled by gender, or asked', () => {
  const asked = one({ fr: 'poste', en: ['post office'] });
  assert(asked.action === 'conflict');
  assert.deepEqual(asked.candidates.map((x) => x.key), ['poste|noun', 'poste|noun-f']);
  const she = one({ fr: 'poste', en: ['post office'], gender: 'f' });
  assert(she.action === 'promote');
  assert.equal(she.record.k, 'poste|noun-f');
  const article = one({ fr: 'le poste', en: ['job'] });
  assert(article.action === 'promote');
  assert.equal(article.record.k, 'poste|noun');
});

test('a typo of a word in your list is caught; of a catalogue word only when unknown', () => {
  const have = mine({ k: 'la chaussette|noun', fr: 'la chaussette', en: ['sock'] });
  const out = one({ fr: 'la chaussete', en: ['sock'] }, ctx({ mine: [have] }));
  assert(out.action === 'conflict');
  assert.deepEqual(out.candidates.map((x) => [x.key, x.relation]),
    [['la chaussette|noun', 'a letter or two apart']]);
  /* "le pont" is a letter from "le pot", which the dictionary knows: a real
     word, not a slip, so it is simply added. */
  const real = one({ fr: 'le pot', en: ['pot'] });
  assert(real.action === 'add');
  assert.equal(real.from, 'dictionary');
  /* "le pnt" is in neither: probably "le pont". */
  const slip = one({ fr: 'le pnt', en: ['bridge'] });
  assert(slip.action === 'conflict');
  assert.deepEqual(slip.candidates.map((x) => [x.source, x.key, x.relation]),
    [['catalogue', 'pont|noun', 'a letter or two apart']]);
  /* With no dictionary to say whether it is a word, the catalogue is not
     guessed against. */
  const blind = resolveAdditions([{ fr: 'le pnt', en: ['bridge'] }],
    ctx({ dictionary: () => null }))[0]!;
  assert.equal(blind.outcome.action, 'add');
  assert.match(blind.notes.join(' '), /dictionary could not be read/);
});

test('an unreadable catalogue is said, not treated as empty', () => {
  const r = resolveAdditions([{ fr: 'le train', en: ['train'] }], ctx({ catalogue: null }))[0]!;
  assert.equal(r.outcome.action, 'add');
  assert.match(r.notes.join(' '), /catalogue could not be read/);
});

test('a word offered twice in one batch is one word with both glosses', () => {
  const rows = resolveAdditions([
    { fr: 'le natel', en: ['mobile phone'], pos: 'noun' },
    { fr: 'le train', en: ['train'] },
    { fr: 'natel', en: ['cell phone'] },
  ], ctx());
  assert.deepEqual(rows.map((r) => r.outcome.action), ['add', 'promote', 'merged']);
  const first = rows[0]!.outcome;
  assert(first.action === 'add');
  assert.deepEqual(first.record.en, ['mobile phone', 'cell phone']);
  assert.deepEqual(rows[2]!.outcome, { action: 'merged', into: 0 });
});

test('a word that means the same as one you hold is noted beside it, never merged', () => {
  const have = mine({ k: 'le portable|noun', fr: 'le portable', en: ['mobile phone'] });
  const r = resolveAdditions([{ fr: 'le natel', en: ['mobile phone'], pos: 'noun' }],
    ctx({ mine: [have] }))[0]!;
  assert.equal(r.outcome.action, 'add');
  assert.deepEqual(r.related.map((x) => [x.key, x.relation]), [['le portable|noun', 'same English']]);
});

test('a removed word offered again comes back', () => {
  const gone = mine({ k: 'le natel|noun', fr: 'le natel', en: ['mobile phone'], deleted: true });
  const out = one({ fr: 'le natel', en: ['mobile phone'], pos: 'noun' }, ctx({ mine: [gone] }));
  assert(out.action === 'add');
  assert.equal(out.restored, true);
  assert.equal(out.record.deleted, undefined);
});

test('use must name something that exists; nothing at all is invalid', () => {
  const out = one({ fr: 'le natel', en: ['phone'], resolve: { use: 'nothing|noun' } });
  assert(out.action === 'invalid');
  assert.match(out.reason, /nothing\|noun/);
  assert.equal(one({ fr: '   ' }).action, 'invalid');
});

test('a correction keeps the key and changes only what was said', () => {
  const have = mine({ k: 'natel|noun', fr: 'natel', en: ['mobile phone'], note: 'Swiss' });
  const c = ctx({ mine: [have] });
  assert.deepEqual(resolveEdit({ key: 'nothing|noun', fr: 'x' }, c), { action: 'missing', key: 'nothing|noun' });
  assert.equal(resolveEdit({ key: 'natel|noun', note: 'Swiss' }, c).action, 'unchanged');
  const out = resolveEdit({ key: 'natel|noun', fr: 'le natel', gender: 'm', en: ['mobile phone', 'cell'] }, c);
  assert(out.action === 'update');
  assert.equal(out.record.k, 'natel|noun');
  assert.equal(out.record.fr, 'le natel');
  assert.deepEqual(out.changed, ['fr', 'en', 'gender']);
  assert.equal(out.record.note, 'Swiss', 'untouched');
});

test('respelling a word onto one you hold or the catalogue teaches is refused, unless forced', () => {
  const have = mine({ k: 'le trin|noun', fr: 'le trin', en: ['train'] });
  const c = ctx({ mine: [have] });
  const out = resolveEdit({ key: 'le trin|noun', fr: 'le train' }, c);
  assert(out.action === 'conflict');
  assert.deepEqual(out.candidates.map((x) => [x.source, x.key]), [['catalogue', 'train|noun']]);
  const forced = resolveEdit({ key: 'le trin|noun', fr: 'le train', resolve: { force: true } }, c);
  assert.equal(forced.action, 'update');
  /* A different gender is a different word: "la marche" is not in the way. */
  const other = resolveEdit({ key: 'le trin|noun', fr: 'le marche', gender: 'm' }, c);
  assert.equal(other.action, 'update');
});
