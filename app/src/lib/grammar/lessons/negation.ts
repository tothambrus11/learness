/** The lessons behind the negation drills (see verbs.ts for the shape). */
import type { RuleId } from '../rules.js';
import type { Lesson } from './verbs.js';

export const NEGATION_LESSONS: Readonly<Partial<Record<RuleId, Lesson>>> = {
  'G.pas': {
    name: 'Saying no: ne … pas',
    use: 'French negation is two words around the verb, not one before it. Every "not", "don\'t" and "doesn\'t" is this pair, so it is worth getting the two halves in the right places early.',
    formation: 'Put ne before the conjugated verb and pas after it: subject + ne + verb + pas. Before a vowel or a silent h, ne becomes n\'. If je was j\' before the verb, it is je again, since ne now stands between them.',
    example: 'Nous parlons français. → Nous ne parlons pas français. · J\'aime le café. → Je n\'aime pas le café.',
    note: 'In speech the ne often drops (je sais pas), but in writing it stays. After a negation, un, une, du and des become de — je n\'ai pas de voiture — which is a bit of its own.',
    unit: 'sentence',
  },
};
