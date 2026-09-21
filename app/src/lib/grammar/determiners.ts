/** The determiner drills: a noun the learner knows, and the little word
 *  before it that the rule decides — its gender's article, *au / du* for
 *  *à / de + le*, *mon / ma / mes*, *ce / cet / cette / ces* (GRAMMAR.md,
 *  D — Nouns and determiners).
 *
 *  What the rule needs is what the catalogue ships with every noun: its
 *  gender, its number where it is taught in the plural, and its article,
 *  which says whether it begins with a vowel (*l'enfant*). So an exercise
 *  is on a noun from the learner's own list, and a rule's breadth counts
 *  nouns. A noun with no article — a name, a word added without one — is
 *  no instance of any of them.
 */
import type { StudyWord } from '../model.js';
import type { Instance } from './instance.js';
import type { RuleId } from './rules.js';

/** The analyser's version, on every attempt it labels. */
export const DETERMINER_GENV = 1;

/** The rules with a determiner drill. */
export const DETERMINER_RULE_IDS: readonly RuleId[] = ['D.gender', 'D.contract', 'D.possessive', 'D.demonstrative'];

/** What a noun's article says about it: which article, and whether the
 *  noun begins with a vowel or a mute h. Null for a word with none. */
export interface NounShape {
  /** The noun without its article: *jour*, *enfant*. */
  noun: string;
  gender: 'm' | 'f';
  plural: boolean;
  /** *l'* stood before it: it begins with a vowel or a mute h. */
  vowel: boolean;
}

export function shapeOf(word: Pick<StudyWord, 'fr' | 'gender' | 'number'>): NounShape | null {
  /* The whole article, then a space — or *l'* and no space: *le* is not
     the start of *lettre*, and *les* is not *le* + *s*. */
  const m = /^(?:(les|le|la)\s+|(l['’]))(\S.*)$/i.exec(word.fr.trim());
  if (!m) return null;
  const article = (m[1] ?? m[2] ?? '').toLowerCase().replace('’', "'");
  const noun = m[3]!;
  const plural = article === 'les' || word.number === 'pl';
  const gender = word.gender === 'f' || (article === 'la') ? 'f' : word.gender === 'm' || article === 'le' ? 'm' : null;
  if (!gender) return null;
  return { noun, gender, plural, vowel: article === "l'" };
}

/** The definite article the noun takes, from its shape. */
const definite = (s: NounShape): string => (s.plural ? 'les ' : s.vowel ? "l'" : s.gender === 'f' ? 'la ' : 'le ');

/** *à* and *de* before the noun's article: fused with *le* and *les*, not
 *  with *la* and *l'*. */
export function contracted(prep: 'à' | 'de', s: NounShape): string {
  const art = definite(s);
  if (art === 'le ') return `${prep === 'à' ? 'au' : 'du'} ${s.noun}`;
  if (art === 'les ') return `${prep === 'à' ? 'aux' : 'des'} ${s.noun}`;
  return `${prep} ${art}${s.noun}`;
}

/** *mon / ma / mes* and the others: the feminine takes the masculine form
 *  before a vowel (*mon amie*). */
export function possessive(person: 'mon' | 'ton' | 'son', s: NounShape): string {
  if (s.plural) return `${person.slice(0, 1)}es ${s.noun}`;
  if (s.gender === 'f' && !s.vowel) return `${person.slice(0, 1)}a ${s.noun}`;
  return `${person} ${s.noun}`;
}

/** *ce / cet / cette / ces*: *cet* before a masculine vowel. */
export function demonstrative(s: NounShape): string {
  if (s.plural) return `ces ${s.noun}`;
  if (s.gender === 'f') return `cette ${s.noun}`;
  return `${s.vowel ? 'cet' : 'ce'} ${s.noun}`;
}

/** The exercise on this noun for the rule, or null where the noun has no
 *  article to read. One cell per form the rule decides, judged on the
 *  whole; the noun is in the prompt, so what is typed is the determiner
 *  and the noun after it, as it would be said. */
export function determinerFor(word: Pick<StudyWord, 'k' | 'en' | 'fr' | 'gender' | 'number'>, rule: RuleId): Instance | null {
  const s = shapeOf(word);
  if (!s || !DETERMINER_RULE_IDS.includes(rule)) return null;
  const cell = (prompt: string, expected: string) => ({ prompt, expected, obs: [{ of: rule, on: 'form' as const }] });
  if (rule === 'D.gender') {
    /* Which article: *le* or *la* — *un* or *une* where the definite one
       would be *l'* and say nothing. Tapped, not typed: the gender is the
       whole question. A noun taught in the plural has no gender to tap. */
    if (s.plural) return null;
    const [m, f] = s.vowel ? ['un', 'une'] : ['le', 'la'];
    return {
      id: `det:${word.k}:${rule}`, gen: 'determiner', face: 'choose',
      spec: { key: word.k, rule }, genv: DETERMINER_GENV, rule,
      title: s.noun, hint: word.en[0] ?? '',
      cells: [{ prompt: '', expected: s.gender === 'f' ? f : m, options: [m, f], obs: [{ of: rule, on: 'form' }] }],
    };
  }
  const cells = rule === 'D.contract'
    ? [cell(`à + ${definite(s)}${s.noun}`, contracted('à', s)), cell(`de + ${definite(s)}${s.noun}`, contracted('de', s))]
    : rule === 'D.possessive'
      ? [cell('my', possessive('mon', s)), cell('your (tu)', possessive('ton', s)), cell('his / her', possessive('son', s))]
      : [cell('this / that', demonstrative(s))];
  return {
    id: `det:${word.k}:${rule}`, gen: 'determiner', face: 'gap',
    spec: { key: word.k, rule }, genv: DETERMINER_GENV, rule,
    title: `${definite(s)}${s.noun}`, hint: word.en[0] ?? '',
    cells,
  };
}

/** Every determiner exercise a noun offers. */
export const determinersFor = (word: Pick<StudyWord, 'k' | 'en' | 'fr' | 'gender' | 'number'>): Instance[] =>
  DETERMINER_RULE_IDS.map((r) => determinerFor(word, r)).filter((i): i is Instance => i !== null);
