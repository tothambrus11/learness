/** Every lesson, by rule id: what the Grammar screen reads for a drill. */
import type { RuleId } from '../rules.js';
import { DETERMINER_LESSONS } from './determiners.js';
import { NEGATION_LESSONS } from './negation.js';
import { NUMBER_LESSONS } from './numbers.js';
import { TENSE_LESSONS } from './tenses.js';
import { VERB_LESSONS } from './verbs.js';
import type { Lesson } from './verbs.js';

export type { Lesson };

export const LESSONS: Readonly<Partial<Record<RuleId, Lesson>>> =
  { ...VERB_LESSONS, ...TENSE_LESSONS, ...NEGATION_LESSONS, ...DETERMINER_LESSONS, ...NUMBER_LESSONS };
