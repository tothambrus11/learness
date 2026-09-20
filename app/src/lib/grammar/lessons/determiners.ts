/** The lessons behind the determiner drills (see verbs.ts for the shape). */
import type { RuleId } from '../rules.js';
import type { Lesson } from './verbs.js';

export const DETERMINER_LESSONS: Readonly<Partial<Record<RuleId, Lesson>>> = {
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
