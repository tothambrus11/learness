/** The lessons behind the pattern drills (see verbs.ts for the shape). */
import type { RuleId } from '../rules.js';
import type { Lesson } from './verbs.js';

export const PATTERN_LESSONS: Readonly<Partial<Record<RuleId, Lesson>>> = {
  'V.pc-vs-imp': {
    name: 'Passé composé or imparfait?',
    use: 'Both are the past, and French chooses between them by what kind of past it is: the event against the scene. Il a plu (it rained, once, done) against il pleuvait (it was raining, the weather that day).',
    formation: 'The passé composé for what happened: an event, once, over, that moves the story on. The imparfait for what was going on, used to happen, or was the case: the background, a habit, a state. A few verbs shift meaning with the choice: je savais (I knew) against j\'ai su (I found out), je devais (I was supposed to) against j\'ai dû (I had to).',
    example: 'Elle a parlé au directeur. → it happened · Il parlait doucement. → it was going on · Quand j\'étais petit, je jouais dehors ; un jour, je suis tombé.',
    unit: 'sentence',
  },
  'G.pas-infinitive': {
    name: 'Not wanting to: the negation with an infinitive',
    use: 'Je ne veux pas partir, je ne peux pas venir: the modal takes the negation and the infinitive follows untouched. And when there is no modal, both halves go together before the infinitive: ne pas fumer.',
    formation: 'Around the conjugated verb, as always: je ne veux pas + infinitive, je ne peux pas + infinitive, je ne dois pas + infinitive. Before a bare infinitive — on a sign, after a verb like préférer — the two halves stay together: ne pas fumer, je préfère ne pas savoir.',
    example: 'je ne veux pas partir · je ne peux pas venir · je ne dois pas rester · prière de ne pas fumer',
    unit: 'sentence',
  },
  'G.pas-compound': {
    name: 'Not in the past: the negation around the auxiliary',
    use: 'In the passé composé the verb is two words, and the negation goes around the first of them: je n\'ai pas vu, elle n\'est pas venue.',
    formation: 'ne before the auxiliary, pas after it, the participle last: je n\'ai pas parlé, tu n\'es pas parti. The other negations sit in the same place — je n\'ai jamais vu, je n\'ai plus faim — except personne, which goes after the participle: je n\'ai vu personne.',
    example: 'je n\'ai pas parlé · je ne suis pas parti · elle n\'a jamais vu ça · je n\'ai vu personne',
    unit: 'sentence',
  },
  'P.verb-endings': {
    name: 'What the endings sound like',
    use: 'Most of a verb table is spelling. Of the six présent forms of parler, four sound exactly the same, and knowing which is what lets you hear a verb without seeing it.',
    formation: '-e, -es and -ent are silent: parle, parles, parlent are all /paʁl/. Only -ons and -ez are heard. So il parle and ils parlent differ on the page and not in the ear, and the pronoun does the work. Likewise -er, -ez, -é and -ai are all /e/ (parler, parlez, parlé, parlerai), and -ais, -ait, -aient are all /ɛ/.',
    example: 'je parle = tu parles = il parle = ils parlent · nous parlons ≠ vous parlez · il parle / il parlait / il parlera',
    unit: 'verb',
  },
  'D.gender-endings': {
    name: 'Guessing a gender from the ending',
    use: 'The article is learned with the word, but for a word you meet cold, the ending is a good bet: -tion is feminine every time, -age masculine nearly every time.',
    formation: 'Feminine: -tion, -sion, -té, -ette, -ance, -ence, -ure, -ie, -ade. Masculine: -age, -ment, -eau, -isme, -oir, -et, -al. The exceptions are famous because they break it: la page, la plage, l\'eau, la peau, le silence, le musée, le lycée.',
    example: 'la nation, la santé, la voiture, la vie · le fromage, le moment, le bateau, le soir',
    unit: 'ending',
  },
  'N.french-tens': {
    name: 'The French seventies, eighties and nineties',
    use: 'What France and every timetable say for seventy to ninety-nine. Whatever you write, these you have to read and hear: quatre-vingt-dix-neuf is ninety-nine.',
    formation: 'Seventy is sixty plus a teen: soixante-dix, soixante et onze, soixante-douze … soixante-dix-neuf. Eighty is four twenties: quatre-vingts, with an s only when nothing follows; then quatre-vingt-un (no et), quatre-vingt-dix, quatre-vingt-dix-neuf.',
    example: '70 soixante-dix · 71 soixante et onze · 80 quatre-vingts · 81 quatre-vingt-un · 90 quatre-vingt-dix · 99 quatre-vingt-dix-neuf',
    unit: 'number',
  },
};
