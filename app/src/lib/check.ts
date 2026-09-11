/** Grading what the learner typed: the French side, the English side, and a
 *  blank in a sentence. */

import type { Grade } from 'ts-fsrs';

import type { CheckResult, Verdict } from './types';

/** The characters that stand for two others, and the two apostrophes that are
 *  one apostrophe, folded before anything is compared. */
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
 *  substitutions turn one into the other. */
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

/** Above this many characters a second wrong letter is likelier to be a slip
 *  than a guess. */
const LONG_WORD = 7;

/** How far a typo may be from the answer and still count as close: one letter,
 *  or two for a word longer than `LONG_WORD`. */
const tolerance = (s: string): number => (s.length > LONG_WORD ? 2 : 1);

/** The pair form a noun of either gender is stored as, "le/la ministre",
 *  captured as the two articles and the noun. Either article is right, since
 *  French says either one. */
const PAIR = /^(le|la|un|une)\/(le|la|un|une)\s+(.*)$/i;

/** Both spellings of a pair form, or the answer on its own. Never empty: an
 *  answer that is missing comes back as one empty string, which matches
 *  nothing but cannot throw. */
export function acceptedAnswers(answer: string | null | undefined): string[] {
  const m = PAIR.exec(answer || '');
  return m ? [`${m[1]} ${m[3]}`, `${m[2]} ${m[3]}`] : [answer || ''];
}

/** Whether two spellings are the same word, ignoring articles — for matching
 *  what was typed against what is stored, not for grading. */
export function sameWord(a: string | null | undefined, b: string | null | undefined): boolean {
  /** Every spelling that counts as this word: both halves of a pair form,
   *  each normalised and stripped of its article, so that "le/la bus",
   *  "le bus" and "bus" all come out the same. */
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
