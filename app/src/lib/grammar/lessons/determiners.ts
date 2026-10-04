/** The lessons behind the determiner drills (see verbs.ts for the shape). */
import type { RuleId } from '../rules.js';
import type { Lesson } from './verbs.js';

export const DETERMINER_LESSONS: Readonly<Partial<Record<RuleId, Lesson>>> = {
  'D.gender': {
    name: 'le or la: every noun has a gender',
    use: 'Every French noun is masculine or feminine, and the article carries it: le jour, la nuit. Nothing else in the sentence agrees right until this is known, so the article is learned with the word, never after it.',
    formation: 'le before a masculine noun, la before a feminine one; l\' before a vowel or a mute h for both, which is when un / une says it instead. The ending is a hint, not a rule: -tion, -té, -ette, -ance are feminine, -age, -ment, -eau are masculine, and the famous exceptions are famous because they break it.',
    example: 'le jour · la nuit · l\'enfant (un enfant) · l\'école (une école) · le problème · la page',
    unit: 'noun',
  },
  'D.art-indef': {
    name: 'du, de la, des: some of',
    use: 'English can say I eat bread, with nothing before the noun. French cannot: a noun almost always has a little word before it, and for some of a thing — bread, water, apples, luck — that word is du, de la, de l\' or des. Je mange du pain is I am eating (some) bread.',
    formation: 'du before a masculine noun (du pain), de la before a feminine one (de la soupe), de l\' before a vowel or a mute h whatever the gender (de l\'eau, de l\'argent), des before any plural (des pommes). It is the same choice as le / la / l\' / les, with de in front: de + le fuses into du and de + les into des, as they do everywhere. For the thing in general — what you like, love or hate — it is le / la / les instead: j\'aime le café, je bois du café.',
    example: 'du pain · de la soupe · de l\'eau · des pommes · J\'aime le café. → Je bois du café. · Elle adore les chats. → Elle a des chats.',
    note: 'du and des also mean of the: le prix du pain, la porte des voisins (that is de + le and de + les, the contraction bit). And in two places all four shrink to plain de: after a negation (je n\'ai pas de pain) and after a quantity (beaucoup de pain).',
    unit: 'sentence',
  },
  'D.de-quantity': {
    name: 'beaucoup de: de alone after a quantity',
    use: 'A lot of, a little, a kilo of, too much, enough, how many: after a word that says how much, French uses de alone, never du, de la or des. Je bois du café, but je bois beaucoup de café.',
    formation: 'quantity + de + noun, whatever its gender or number: beaucoup de, un peu de, trop de, assez de, combien de, plus de, moins de, and the containers and weights — un kilo de, une bouteille de, un verre de, une tasse de. d\' before a vowel: beaucoup d\'amis. The one to learn apart is la plupart (most), which takes des: la plupart des gens.',
    example: 'du café → beaucoup de café · de la patience → un peu de patience · des amis → beaucoup d\'amis · de l\'eau → une bouteille d\'eau · la plupart des gens',
    note: 'So there are three ways to say some-or-none with de: du / de la / des for some of (je mange de la salade), de alone after a quantity (beaucoup de salade), and de alone after a negation (je ne mange pas de salade). The exercises mix all three.',
    unit: 'sentence',
  },
  'D.contract': {
    name: 'au, aux, du, des',
    use: 'à and de are the two prepositions you use most, and before le and les they fuse into one word. Je vais au marché, not à le marché.',
    formation: 'à + le → au, à + les → aux; de + le → du, de + les → des. Before la and l\' nothing changes: à la gare, de l\'école.',
    example: 'à + le marché → au marché · à + les enfants → aux enfants · de + le pain → du pain · de + la ville → de la ville · de + l\'hôtel → de l\'hôtel',
    unit: 'noun',
  },
  'D.possessive': {
    name: 'mon, ma, mes',
    use: 'My, your, his and her agree with the thing owned, not the owner: son livre is his book or her book alike.',
    formation: 'mon / ma / mes, ton / ta / tes, son / sa / ses: the first before a masculine noun, the second before a feminine one, the third before a plural. Before a feminine noun that begins with a vowel the masculine form is used, for the sound: mon amie, ton école, son histoire.',
    example: 'mon père, ma mère, mes parents · ton frère, ta sœur, tes amis · son ami, son amie (not sa amie), ses amies',
    unit: 'noun',
  },
  'D.de-negative': {
    name: 'pas de: no article after a negation',
    use: 'After ne … pas, un, une, du and des shrink to de: I have a car is j\'ai une voiture; I have no car is je n\'ai pas de voiture.',
    formation: 'Negate the sentence as usual, then replace un / une / du / des after the verb with de (d\' before a vowel). Not after être: ce n\'est pas une voiture keeps its article, and so do le, la, les.',
    example: 'Il a une voiture. → Il n\'a pas de voiture. · Nous mangeons du pain. → Nous ne mangeons pas de pain. · Elle a des amis. → Elle n\'a pas d\'amis.',
    unit: 'sentence',
  },
  'D.demonstrative': {
    name: 'ce, cet, cette, ces',
    use: 'This and that are one word in French, and it agrees with the noun.',
    formation: 'ce before a masculine noun, cet before a masculine noun that begins with a vowel or a mute h, cette before a feminine noun, ces before any plural. To tell this from that, add -ci or -là: ce livre-ci, ce livre-là.',
    example: 'ce jour · cet enfant · cet homme · cette ville · ces gens',
    unit: 'noun',
  },
};
