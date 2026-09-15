/** Grading what the learner typed.
 *
 *  Deliberately forgiving in specific ways: a missing accent or a dropped
 *  article is a note, not a failure, because the point is recall rather than
 *  transcription. What you *say* is never graded here: a recogniser has to
 *  drop the article to agree with you at all, and the article is the gender,
 *  which is the thing the card is there to teach. Speaking is self-judged.
 */
import { Rating } from 'ts-fsrs';
import type { Grade } from 'ts-fsrs';
import type { StudyWord } from './model.js';
/** What grading a typed answer can conclude, best first. */
export type Verdict = 'ok' | 'accent' | 'article' | 'close' | 'no';
export interface Check { verdict: Verdict }

const LIG: Record<string, string> = { œ: 'oe', æ: 'ae', ß: 'ss', '’': "'", '‘': "'" };

/** A string reduced to what is being compared: lower case, no accents, no
 *  ligatures, no brackets, no punctuation, single spaces. */
export function norm(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .replace(/[œæß’‘]/g, (c) => LIG[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARTICLES = /^(le|la|les|l'|un|une|des|du|de la|se|s')\s*/;
export const stripArticle = (s: string): string => s.replace(ARTICLES, '').trim();
const stripEnglish = (s: string): string => s.replace(/^(to|a|an|the)\s+/, '');

/** Edit distance, for spotting a typo rather than a wrong answer. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  /* Two rows of the matrix, swapped each pass. Every index below is inside
     the row it reads, which the compiler cannot see, hence the assertions. */
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let cur: number[] = Array.from({ length: n + 1 }, () => 0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}

const tolerance = (s: string): number => (s.length > 7 ? 2 : 1);

/** The forms a stored answer accepts. A noun that is either gender is stored
 *  as "le/la ministre", and French says either one, so either one is right. */
const PAIR = /^(le|la|un|une)\/(le|la|un|une)\s+(.*)$/i;
function acceptedAnswers(answer: string | null | undefined): string[] {
  const m = PAIR.exec(answer || '');
  return m ? [`${m[1]} ${m[3]}`, `${m[2]} ${m[3]}`] : [answer ?? ''];
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
  const forms = (s: string | null | undefined): string[] => acceptedAnswers(s).map((f) => stripArticle(norm(f)));
  const left = new Set(forms(a).filter(Boolean));
  return forms(b).some((f) => f && left.has(f));
}

const RANK: Record<Verdict, number> = { ok: 0, accent: 1, article: 2, close: 3, no: 4 };

function checkOne(input: string, answer: string, lemma?: string): Check {
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

/** Verdicts: ok | accent | article | close | no — the best any accepted form earns. */
export function checkFrench(input: string, word: Pick<StudyWord, 'answer' | 'lemma'>): Check {
  let best: Check = { verdict: 'no' };
  for (const answer of acceptedAnswers(word.answer)) {
    const v = checkOne(input, answer, word.lemma);
    if (RANK[v.verdict] < RANK[best.verdict]) best = v;
  }
  return best;
}

/** Forms of this many letters or fewer are graded on the letter, whatever the
 *  caller asks. *ou* and *où*, *a* and *à*, *du* and *dû* are different words,
 *  and an edit distance of one is the whole alphabet away at this length. */
export const STRICT_UNDER = 4;

/** Exactly the form, accents and all: the grading for an answer out of a
 *  closed set, where a letter is the difference between two words. Case is
 *  the one thing forgiven, since a sentence starts with a capital. */
const exactly = (input: string, form: string): boolean =>
  input.trim().toLowerCase() === form.trim().toLowerCase();

/** A blank in a sentence: the word as it stands there, inflected and bare.
 *  "Tous ___ heureux." wants "sont", not "être" and not "le/la".
 *
 *  `strict` grades on the letter — no accent forgiven, no typo tolerated —
 *  and is what a rung in STRICT asks for. It was measured before it was
 *  written: with the ordinary tolerance, *sans* for *dans* and *serai* for
 *  *serais* both came back "close", which is a pass, so a card about the
 *  ending could not fail a learner who got the ending wrong. Short forms
 *  are strict whether asked or not; see STRICT_UNDER. */
export function checkCloze(
  input: string, form: string, { strict = false }: { strict?: boolean } = {},
): Check {
  const got = norm(input);
  if (!got) return { verdict: 'no' };
  const want = norm(form);
  if (strict || want.length < STRICT_UNDER) {
    return exactly(input, form) ? { verdict: 'ok' } : { verdict: 'no' };
  }
  if (got === want) {
    return exactly(input, form) ? { verdict: 'ok' } : { verdict: 'accent' };
  }
  if (levenshtein(got, want) <= tolerance(want)) return { verdict: 'close' };
  return { verdict: 'no' };
}

/** One option tapped out of a few. Right or wrong, nothing in between: the
 *  options are whole words, and a near miss among *sur*, *sous* and *dans*
 *  is the wrong word. */
export function checkChoice(picked: string | null | undefined, answer: string): Check {
  return picked && exactly(picked, answer) ? { verdict: 'ok' } : { verdict: 'no' };
}

export function checkEnglish(input: string, word: Pick<StudyWord, 'en'>): Check {
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
    case 'accent':
    case 'article': return Rating.Good;
    case 'close': return Rating.Hard;
    default: return Rating.Again;
  }
}
