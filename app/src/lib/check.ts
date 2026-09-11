/** Grading what the learner typed.
 *
 *  Deliberately forgiving in specific ways: a missing accent or a dropped
 *  article is a note, not a failure, because the point is recall rather than
 *  transcription. What you *say* is never graded here: a recogniser has to
 *  drop the article to agree with you at all, and the article is the gender,
 *  which is the thing the card is there to teach. Speaking is self-judged.
 */
import type { Grade } from 'ts-fsrs';

import type { CheckResult, Verdict } from './types';

/** The characters that stand for two others, folded before anything is
 *  compared: a keyboard that cannot type "œ" must not cost a mark, and the two
 *  apostrophes are the same apostrophe. */
const LIG: Record<string, string> = { œ: 'oe', æ: 'ae', ß: 'ss', '’': "'", '‘': "'" };

/** What everything here compares: lower case, no accents, no ligatures, no
 *  bracketed asides, nothing but letters, apostrophes and single spaces.
 *  Nullish in, empty string out, so a caller need not check first. */
export function norm(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .replace(/[œæß’‘]/g, (c) => LIG[c] || c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The articles a French answer may start with, as one leading match. */
const ARTICLES = /^(le|la|les|l'|un|une|des|du|de la|se|s')\s*/;

/** The word without its article. Anything that does not start with one comes
 *  back unchanged, so this is safe on a verb or a phrase. */
export const stripArticle = (s: string): string => s.replace(ARTICLES, '').trim();

/** The English without its article or its infinitive "to", so "a cat" and
 *  "cat" are the same answer. */
const stripEnglish = (s: string): string => s.replace(/^(to|a|an|the)\s+/, '');

/** Edit distance between two strings: how many insertions, deletions and
 *  substitutions turn one into the other. Two rolling rows rather than a full
 *  matrix, since only the previous row is ever read. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** How far a typo may be from the answer and still count as close: one letter,
 *  or two once the word is long enough that a slip is likelier than a guess. */
const tolerance = (s: string): number => (s.length > 7 ? 2 : 1);

/** The forms a stored answer accepts. A noun that is either gender is stored
 *  as "le/la ministre", and French says either one, so either one is right. */
const PAIR = /^(le|la|un|une)\/(le|la|un|une)\s+(.*)$/i;

/** Both spellings of a pair form, or the answer on its own. Never empty: an
 *  answer that is missing comes back as one empty string, which matches
 *  nothing but cannot throw. */
export function acceptedAnswers(answer: string | null | undefined): string[] {
  const m = PAIR.exec(answer || '');
  return m ? [`${m[1]} ${m[3]}`, `${m[2]} ${m[3]}`] : [answer || ''];
}

/** Two spellings of the same word — for matching what was typed against what
 *  is stored, not for grading.
 *
 *  Either side may be the pair form the catalogue stores a noun of either
 *  gender under, so both are expanded before their articles come off:
 *  "le/la bus", "le bus" and "bus" are one word. Grading is stricter on
 *  purpose (the article is the gender, which is the thing being taught), which
 *  is why this is separate from checkFrench.
 */
export function sameWord(a: string | null | undefined, b: string | null | undefined): boolean {
  const forms = (s: string | null | undefined): string[] =>
    acceptedAnswers(s).map((f) => stripArticle(norm(f)));
  const left = new Set(forms(a).filter(Boolean));
  return forms(b).some((f) => f && left.has(f));
}

/** The verdicts in order of how much they please: a lower number is a better
 *  answer, which is how the best of several accepted forms is picked. */
const RANK: Record<Verdict, number> = { ok: 0, accent: 1, article: 2, close: 3, no: 4 };

/** One typed answer against one accepted spelling. `lemma` is the word without
 *  its article, so a bare answer to a noun is told apart from a wrong one. */
function checkOne(input: string, answer: string, lemma?: string): CheckResult {
  const got = norm(input);
  if (!got) return { verdict: 'no' };
  const want = norm(answer);
  if (got === want) {
    const exact = input.trim().toLowerCase() === answer.toLowerCase();
    return exact ? { verdict: 'ok' } : { verdict: 'accent' };
  }
  if (stripArticle(got) === stripArticle(want)) return { verdict: 'article' };
  const bare = norm(lemma || '');
  if (bare && (got === bare || stripArticle(got) === bare)) return { verdict: 'article' };
  if (levenshtein(got, want) <= tolerance(want)) return { verdict: 'close' };
  return { verdict: 'no' };
}

/** What the French side of a card is graded against. A `StudyWord` has both
 *  fields; so does the record a test hands in. Either may be missing, and a
 *  missing one simply accepts nothing. */
export interface FrenchAnswer {
  /** The stored form, article and all, possibly a "le/la" pair. */
  answer?: string;
  /** The same word without its article, so a bare answer earns `article`
   *  rather than `no`. */
  lemma?: string;
}

/** Verdicts: ok | accent | article | close | no — the best any accepted form earns. */
export function checkFrench(input: string, word: FrenchAnswer): CheckResult {
  let best: CheckResult = { verdict: 'no' };
  for (const answer of acceptedAnswers(word.answer)) {
    const v = checkOne(input, answer, word.lemma);
    if (RANK[v.verdict] < RANK[best.verdict]) best = v;
  }
  return best;
}

/** A blank in a sentence: the word as it stands there, inflected and bare.
 *  "Tous ___ heureux." wants "sont", not "être" and not "le/la". */
export function checkCloze(input: string, form: string): CheckResult {
  const got = norm(input);
  if (!got) return { verdict: 'no' };
  const want = norm(form);
  if (got === want) {
    return input.trim().toLowerCase() === form.toLowerCase()
      ? { verdict: 'ok' }
      : { verdict: 'accent' };
  }
  if (levenshtein(got, want) <= tolerance(want)) return { verdict: 'close' };
  return { verdict: 'no' };
}

/** What the English side of a card is graded against: every stored
 *  translation, since any of them is the word. */
export interface EnglishAnswer {
  /** Translations, best first. Any one of them is a right answer. */
  en: string[];
}

/** Any stored translation counts, with or without its article, and a typo in
 *  one of them is close rather than wrong. */
export function checkEnglish(input: string, word: EnglishAnswer): CheckResult {
  const got = norm(input);
  if (!got) return { verdict: 'no' };
  for (const t of word.en) {
    const want = norm(t);
    if (got === want || stripEnglish(got) === stripEnglish(want)) return { verdict: 'ok' };
  }
  for (const t of word.en) {
    const want = stripEnglish(norm(t));
    if (levenshtein(stripEnglish(got), want) <= tolerance(want)) return { verdict: 'close' };
  }
  return { verdict: 'no' };
}

/** Rating for a verdict, on the 1-4 scale FSRS uses. */
export function ratingFor(verdict: Verdict): Grade {
  switch (verdict) {
    case 'ok':
      return 3;
    case 'accent':
    case 'article':
      return 3;
    case 'close':
      return 2;
    default:
      return 1;
  }
}
