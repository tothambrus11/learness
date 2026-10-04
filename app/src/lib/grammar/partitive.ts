/** The *de / du / des* drills: the little word before a thing you have
 *  some of, a lot of, or none of (GRAMMAR.md, D — *D.art-indef* and
 *  *D.de-quantity*).
 *
 *  Not made from the learner's nouns, as the article drills are: whether it
 *  is *du pain* or *le pain* or *de pain* is decided by the sentence around
 *  the noun — the verb, a quantity, a negation — and a noun alone says none
 *  of that. So each rule is its own closed list of short sentences, the gap
 *  marked, the English under them, and the key never in doubt. Pure; the
 *  dealer picks among them.
 */
import type { Example } from '../model.js';
import { speechOf } from './instance.js';
import type { Instance, Obs } from './instance.js';
import { isRuleId } from './rules.js';
import type { RuleId } from './rules.js';

/** The analyser's version, on every attempt these label. */
export const PARTITIVE_GENV = 1;

export const PARTITIVE_RULE_IDS: readonly RuleId[] = ['D.art-indef', 'D.de-quantity'];

/** Where the answer goes in a sentence of the bank. */
export const GAP = '___';

/** One sentence of a bank: the French with its gap, the English, the word
 *  that fills it, and — where it is not the drill's own rule — the rule
 *  that decided it, which a wrong answer is evidence about as well. */
export interface GapSentence {
  /** Stable for the life of the bank: the instance id is made from it, and
   *  a learner's history of the sentence is kept by it. Never reused. */
  id: string;
  fr: string;
  en: string;
  answer: string;
  /** The choices on a tapped sentence; absent where the answer is typed. */
  options?: readonly string[];
  /** The rule behind the answer, where it is another than the drill's. */
  by?: RuleId;
}

const SOME = ['du', 'de la', "de l'", 'des'] as const;

/** *du, de la, de l', des* for some of a thing; *le / la / les* for the
 *  thing in general, after *aimer* and its kind. Tapped: which of four,
 *  or of two where the question is *some* against *the*. */
export const SOME_BANK: readonly GapSentence[] = [
  { id: 'pain', fr: `Je mange ${GAP} pain.`, en: 'I am eating (some) bread.', answer: 'du', options: SOME },
  { id: 'eau', fr: `Tu veux ${GAP} eau ?`, en: 'Do you want some water?', answer: "de l'", options: SOME },
  { id: 'soupe', fr: `Il y a ${GAP} soupe.`, en: 'There is some soup.', answer: 'de la', options: SOME },
  { id: 'pommes', fr: `On achète ${GAP} pommes.`, en: 'We are buying (some) apples.', answer: 'des', options: SOME },
  { id: 'lait', fr: `Il boit ${GAP} lait.`, en: 'He drinks milk.', answer: 'du', options: SOME },
  { id: 'confiture', fr: `Je voudrais ${GAP} confiture.`, en: 'I would like some jam.', answer: 'de la', options: SOME },
  { id: 'argent', fr: `Il faut ${GAP} argent.`, en: 'You need money.', answer: "de l'", options: SOME },
  { id: 'amis', fr: `Vous avez ${GAP} amis à Paris ?`, en: 'Do you have friends in Paris?', answer: 'des', options: SOME },
  { id: 'fromage', fr: `Nous prenons ${GAP} fromage.`, en: 'We are having some cheese.', answer: 'du', options: SOME },
  { id: 'chance', fr: `Elle a ${GAP} chance.`, en: 'She is lucky (she has luck).', answer: 'de la', options: SOME },
  /* Some against the: the English says which, and the verb does too —
     aimer, adorer, détester take the thing in general. */
  { id: 'aime-cafe', fr: `J'aime ${GAP} café.`, en: 'I like coffee.', answer: 'le', options: ['du', 'le'] },
  { id: 'bois-cafe', fr: `Je bois ${GAP} café.`, en: 'I am drinking (some) coffee.', answer: 'du', options: ['du', 'le'] },
  { id: 'aime-chats', fr: `Elle adore ${GAP} chats.`, en: 'She loves cats.', answer: 'les', options: ['des', 'les'] },
  { id: 'a-chats', fr: `Elle a ${GAP} chats.`, en: 'She has cats.', answer: 'des', options: ['des', 'les'] },
  { id: 'deteste-viande', fr: `Il déteste ${GAP} viande.`, en: 'He hates meat.', answer: 'la', options: ['de la', 'la'] },
  { id: 'mange-viande', fr: `Il mange ${GAP} viande.`, en: 'He eats meat.', answer: 'de la', options: ['de la', 'la'] },
];

/** *de* alone after a quantity, mixed with the sentences where it is not:
 *  some of (*du, de la, des*), a negation (*de*), *la plupart des*. Typed,
 *  because the question is which of all of them, and a list of four to
 *  tap would answer half of it. */
export const AMOUNT_BANK: readonly GapSentence[] = [
  { id: 'beaucoup-cafe', fr: `Je bois beaucoup ${GAP} café.`, en: 'I drink a lot of coffee.', answer: 'de' },
  { id: 'peu-sucre', fr: `Il y a un peu ${GAP} sucre.`, en: 'There is a little sugar.', answer: 'de' },
  { id: 'kilo-tomates', fr: `Un kilo ${GAP} tomates, s'il vous plaît.`, en: 'A kilo of tomatoes, please.', answer: 'de' },
  { id: 'trop-travail', fr: `Elle a trop ${GAP} travail.`, en: 'She has too much work.', answer: 'de' },
  { id: 'assez-temps', fr: `On a assez ${GAP} temps.`, en: 'We have enough time.', answer: 'de' },
  { id: 'beaucoup-amis', fr: `Tu as beaucoup ${GAP} amis.`, en: 'You have a lot of friends.', answer: "d'" },
  { id: 'bouteille-eau', fr: `Une bouteille ${GAP} eau, s'il vous plaît.`, en: 'A bottle of water, please.', answer: "d'" },
  { id: 'verre-vin', fr: `Un verre ${GAP} vin rouge.`, en: 'A glass of red wine.', answer: 'de' },
  { id: 'combien-enfants', fr: `Combien ${GAP} enfants avez-vous ?`, en: 'How many children do you have?', answer: "d'" },
  { id: 'plupart-gens', fr: `La plupart ${GAP} gens parlent français.`, en: 'Most people speak French.', answer: 'des' },
  /* No quantity: some of, as on the other drill. */
  { id: 'bois-cafe', fr: `Je bois ${GAP} café le matin.`, en: 'I drink coffee in the morning.', answer: 'du', by: 'D.art-indef' },
  { id: 'achete-tomates', fr: `Elle achète ${GAP} tomates.`, en: 'She is buying (some) tomatoes.', answer: 'des', by: 'D.art-indef' },
  { id: 'mange-salade', fr: `Il mange ${GAP} salade.`, en: 'He is eating (some) salad.', answer: 'de la', by: 'D.art-indef' },
  /* A negation: de, as after a quantity. */
  { id: 'pas-viande', fr: `Je ne mange pas ${GAP} viande.`, en: 'I do not eat meat.', answer: 'de', by: 'D.de-negative' },
  { id: 'plus-lait', fr: `Il n'y a plus ${GAP} lait.`, en: 'There is no more milk.', answer: 'de', by: 'D.de-negative' },
  { id: 'pas-argent', fr: `Je n'ai pas ${GAP} argent.`, en: 'I have no money.', answer: "d'", by: 'D.de-negative' },
];

/** The sentence with its gap filled: *de l'* and *d'* run into the word
 *  after them, as they are written. */
export const filled = (fr: string, answer: string): string =>
  (answer.endsWith("'") ? fr.replace(`${GAP} `, answer) : fr.replace(GAP, answer));

/** One sentence of a bank as the exercise for its rule: the sentence shown
 *  with the gap marked, the English under it, one cell, and the whole
 *  sentence said aloud once it is checked. */
export function partitiveFor(s: GapSentence, rule: RuleId): Instance {
  const id = `partitive:${rule}:${s.id}`;
  const obs: Obs[] = [{ of: rule, on: 'form' }];
  if (s.by && s.by !== rule) obs.push({ of: s.by, on: 'form' });
  const sentence: Example = { fr: s.fr, en: s.en, f: GAP };
  return {
    id, gen: 'partitive', face: s.options ? 'choose' : 'gap',
    spec: { rule, sid: s.id }, genv: PARTITIVE_GENV, rule,
    title: s.options ? 'Which goes in the gap?' : 'Type what goes in the gap', hint: s.en,
    cells: [{ prompt: '', expected: s.answer, ...(s.options ? { options: [...s.options] } : {}), obs }],
    sentence,
    speech: speechOf(id, filled(s.fr, s.answer), 'sentence'),
  };
}

const BANKS: Readonly<Partial<Record<RuleId, readonly GapSentence[]>>> = {
  'D.art-indef': SOME_BANK,
  'D.de-quantity': AMOUNT_BANK,
};

/** Every exercise of one rule: its whole bank. Empty for a rule with none. */
export const partitivesFor = (rule: RuleId): Instance[] =>
  (BANKS[rule] ?? []).map((s) => partitiveFor(s, rule));

/** The exercise behind an instance id, made again; null for one no bank
 *  has (a sentence since taken out of the bank). */
export function partitiveForId(id: string): Instance | null {
  const m = /^partitive:([^:]+):(.+)$/.exec(id);
  if (!m?.[1] || !isRuleId(m[1])) return null;
  return partitivesFor(m[1]).find((i) => i.id === id) ?? null;
}
