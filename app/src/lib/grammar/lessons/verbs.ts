/** The lessons behind the verb drills: what a rule says, in the learner's
 *  words, read on the Grammar screen before the bit is started and beside
 *  its breadth after. Typed constants, as the tense notes are (tenses.ts):
 *  a lesson is data the screen reads, never prose in a template.
 */
import type { RuleId } from '../rules.js';

export interface Lesson {
  /** The bit's name on the screen: "-er verbs in the présent". */
  name: string;
  /** What it is for and where it is met, in a sentence or two. */
  use: string;
  /** How the forms are built, as a rule the learner can apply. */
  formation: string;
  /** One verb walked through, pronoun by pronoun. */
  example: string;
  /** What to listen for, or the trap, where the rule has one. */
  note?: string;
  /** What an instance of the rule is, for counting its breadth: a table
   *  is one verb, a negation one sentence. */
  unit: 'verb' | 'sentence' | 'number' | 'noun';
}

/** The verb lessons, by rule id. A rule with a generator (grammar/deal.ts)
 *  and no lesson (lessons/index.ts) fails tests/lessons.test.ts: the screen
 *  would offer a drill it could not explain. */
export const VERB_LESSONS: Readonly<Partial<Record<RuleId, Lesson>>> = {
  'V.pres-er': {
    name: '-er verbs in the présent',
    use: 'Nine verbs in ten end in -er, and all but aller follow one pattern. This is the pattern: learn it once and you have the présent of thousands of verbs.',
    formation: 'Take the -er off the infinitive to get the stem, then add -e, -es, -e, -ons, -ez, -ent for je, tu, il/elle, nous, vous, ils/elles.',
    example: 'parler → parl-: je parle, tu parles, il parle, nous parlons, vous parlez, ils parlent.',
    note: 'Four of the six sound exactly the same: parle, parles, parle and parlent are all /paʁl/. Only nous and vous are heard as different; the rest is spelling, and the pronoun does the work.',
    unit: 'verb',
  },
  'V.pres-ir': {
    name: '-ir verbs like finir',
    use: 'The second regular group: finir, choisir, réussir, grandir, réfléchir and about three hundred others, many of them made from adjectives (rougir, vieillir).',
    formation: 'Take the -ir off to get the stem, then add -is, -is, -it, -issons, -issez, -issent. The plural forms carry -iss- before the ending.',
    example: 'finir → fin-: je finis, tu finis, il finit, nous finissons, vous finissez, ils finissent.',
    note: 'Not every -ir verb does this: partir, sortir and dormir drop a consonant instead (je pars), and are a bit of their own.',
    unit: 'verb',
  },
  'V.pres-tir': {
    name: 'partir, sortir, dormir',
    use: 'A handful of common -ir verbs that do not add -iss-: partir, sortir, dormir, servir, sentir, mentir and the verbs made from them.',
    formation: 'In the singular the stem loses its last consonant and takes -s, -s, -t: je pars, tu sors, il dort. In the plural the whole stem is back, with -ons, -ez, -ent: nous partons, vous sortez, ils dorment.',
    example: 'partir → par- / part-: je pars, tu pars, il part, nous partons, vous partez, ils partent.',
    unit: 'verb',
  },
  'V.pres-ouvrir': {
    name: 'ouvrir, offrir, souffrir',
    use: 'A few -ir verbs that behave like -er verbs in the présent: ouvrir, offrir, souffrir, découvrir, couvrir, cueillir, accueillir.',
    formation: 'Take the -ir off, then add the -er endings: -e, -es, -e, -ons, -ez, -ent.',
    example: 'ouvrir → ouvr-: j\'ouvre, tu ouvres, il ouvre, nous ouvrons, vous ouvrez, ils ouvrent.',
    unit: 'verb',
  },
  'V.pres-etre-avoir': {
    name: 'être and avoir',
    use: 'The two verbs French cannot do without: to be and to have, and the auxiliaries of every compound tense. No pattern; learned as themselves, and met so often that they stick.',
    formation: 'être: je suis, tu es, il est, nous sommes, vous êtes, ils sont. avoir: j\'ai, tu as, il a, nous avons, vous avez, ils ont. Note c\'est (it is), il y a (there is), j\'ai vingt ans (I am twenty: French has age, not is it).',
    example: 'je suis, tu es, il est, nous sommes, vous êtes, ils sont · j\'ai, tu as, il a, nous avons, vous avez, ils ont.',
    unit: 'verb',
  },
  'V.pres-aller-faire': {
    name: 'aller and faire',
    use: 'To go and to do: aller for how you are (ça va, je vais bien) and for the near future (je vais partir); faire for the weather (il fait beau), sport (faire du ski) and most of what one does.',
    formation: 'aller: je vais, tu vas, il va, nous allons, vous allez, ils vont. faire: je fais, tu fais, il fait, nous faisons, vous faites, ils font. Learned as themselves; vous faites is one of only three vous forms not in -ez.',
    example: 'je vais, tu vas, il va, nous allons, vous allez, ils vont · je fais, tu fais, il fait, nous faisons, vous faites, ils font.',
    unit: 'verb',
  },
  'V.pres-modals': {
    name: 'pouvoir, vouloir, devoir',
    use: 'Can, want and must: the three verbs that take an infinitive after them (je peux venir, je veux partir, je dois rester), and il faut, which takes one too.',
    formation: 'Each has two stems, one for the singular and ils, one for nous and vous: peux / pouvons / peuvent; veux / voulons / veulent; dois / devons / doivent. The singular ends in -x, -x, -t for pouvoir and vouloir, -s, -s, -t for devoir.',
    example: 'je peux, tu peux, il peut, nous pouvons, vous pouvez, ils peuvent · je veux, tu veux, il veut, nous voulons, vous voulez, ils veulent · je dois, tu dois, il doit, nous devons, vous devez, ils doivent.',
    unit: 'verb',
  },
  'V.pres-venir': {
    name: 'venir and tenir',
    use: 'To come and to hold, and everything made from them: devenir, revenir, obtenir, appartenir. venir de + infinitive is what you have just done: je viens de manger.',
    formation: 'Two stems: vien- / tien- for the singular and ils, with a double n in ils (viennent); ven- / ten- for nous and vous.',
    example: 'je viens, tu viens, il vient, nous venons, vous venez, ils viennent · je tiens, tu tiens, il tient, nous tenons, vous tenez, ils tiennent.',
    unit: 'verb',
  },
  'V.pres-savoir-connaitre': {
    name: 'savoir and connaître',
    use: 'Two verbs for to know: savoir a fact or a skill (je sais que…, je sais nager), connaître a person or a place (je connais Genève).',
    formation: 'savoir: je sais, tu sais, il sait, nous savons, vous savez, ils savent. connaître: je connais, tu connais, il connaît (with the circumflex before t), nous connaissons, vous connaissez, ils connaissent.',
    example: 'je sais, tu sais, il sait, nous savons, vous savez, ils savent · je connais, tu connais, il connaît, nous connaissons, vous connaissez, ils connaissent.',
    unit: 'verb',
  },
  'V.pres-re': {
    name: '-re verbs like vendre',
    use: 'The third regular group: vendre, attendre, entendre, répondre, perdre, descendre — the verbs in -dre that keep their d.',
    formation: 'Take the -re off to get the stem, then add -s, -s, nothing, -ons, -ez, -ent. The il form is the bare stem: il vend, il attend.',
    example: 'vendre → vend-: je vends, tu vends, il vend, nous vendons, vous vendez, ils vendent.',
    note: 'prendre and its family lose the d in the plural (nous prenons, ils prennent), and mettre drops a t in the singular (je mets): those are their own bits.',
    unit: 'verb',
  },
};
