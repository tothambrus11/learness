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
  'G.others': {
    name: 'Never, no longer: ne … jamais, ne … plus',
    use: 'The other negations sit where pas sits. jamais is never, plus is no longer or no more, rien is nothing, personne is nobody.',
    formation: 'Keep ne before the verb and put the word after it in place of pas: je ne fume jamais, il ne travaille plus. Only one of them at a time, and never pas beside them.',
    example: 'Nous parlons français. → Nous ne parlons jamais français. · Il parle trop vite. → Il ne parle plus trop vite.',
    note: 'plus is heard without its s when it means no longer (je ne veux plus, /ply/), and with it when it means more (je veux plus, /plys/).',
    unit: 'sentence',
  },
};

/** The question lesson keeps the negation lessons company: both are a
 *  sentence to rewrite. */
export const QUESTION_LESSONS: Readonly<Partial<Record<RuleId, Lesson>>> = {
  'Q.yes-no': {
    name: 'Asking, with est-ce que',
    use: 'A yes-or-no question is a statement with a question in front of it. Speech often just raises the voice; writing and careful speech put est-ce que first; inversion (parlez-vous ?) is the formal third way.',
    formation: 'Put Est-ce que before the statement, change nothing in it, and end with a question mark. Before a vowel, est-ce qu\': Est-ce qu\'il parle ? A capital letter at the start of the statement becomes small, unless it is a name.',
    example: 'Nous parlons français. → Est-ce que nous parlons français ? · Il parle trop vite. → Est-ce qu\'il parle trop vite ?',
    unit: 'sentence',
  },
};
