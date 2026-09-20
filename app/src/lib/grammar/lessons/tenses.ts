/** The lessons behind the tense tables: the tense notes (tenses.ts) are
 *  the prose, read on the Grammar screen's tense rows already; this pairs
 *  each drilled tense with a worked verb, in the lesson's shape.
 */
import { TENSE_NOTES } from '../../tenses.js';
import type { RuleId } from '../rules.js';
import type { Lesson } from './verbs.js';

const EXAMPLE: Record<string, string> = {
  pc: "parler → avoir + parlé: j'ai parlé, tu as parlé, il a parlé, nous avons parlé, vous avez parlé, ils ont parlé.",
  imp: 'finir → nous finissons → finiss-: je finissais, tu finissais, il finissait, nous finissions, vous finissiez, ils finissaient.',
  fut: 'parler → parler-: je parlerai, tu parleras, il parlera, nous parlerons, vous parlerez, ils parleront · vendre → vendr-: je vendrai.',
  cond: 'parler → parler-: je parlerais, tu parlerais, il parlerait, nous parlerions, vous parleriez, ils parleraient.',
};

/** The tense that each drilled rule is the bit of. */
const TENSE_OF: Partial<Record<RuleId, string>> =
  { 'V.pc': 'pc', 'V.imparfait': 'imp', 'V.futur': 'fut', 'V.conditionnel': 'cond' };

export const TENSE_LESSONS: Readonly<Partial<Record<RuleId, Lesson>>> = Object.fromEntries(
  Object.entries(TENSE_OF).flatMap(([rule, tense]) => {
    const note = TENSE_NOTES[tense];
    if (!note) return [];
    return [[rule, { name: note.name, use: note.use, formation: note.formation, example: EXAMPLE[tense] ?? '', unit: 'verb' }]];
  }),
);
