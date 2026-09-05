/** Grading what the learner typed or said.
 *
 *  Deliberately forgiving in specific ways: a missing accent or a dropped
 *  article is a note, not a failure, because the point is recall rather than
 *  transcription. Speech is looser still, since recognisers drop articles and
 *  mangle endings on their own.
 */
const LIG = { œ: 'oe', æ: 'ae', ß: 'ss', '’': "'", '‘': "'" };

export function norm(s) {
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

const ARTICLES = /^(le|la|les|l'|un|une|des|du|de la|se|s')\s*/;
export const stripArticle = (s) => s.replace(ARTICLES, '').trim();
const stripEnglish = (s) => s.replace(/^(to|a|an|the)\s+/, '');

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

const tolerance = (s) => (s.length > 7 ? 2 : 1);

/** Verdicts: ok | accent | article | close | no */
export function checkFrench(input, word) {
  const got = norm(input);
  if (!got) return { verdict: 'no' };
  const want = norm(word.answer);
  if (got === want) {
    const exact = input.trim().toLowerCase() === word.answer.toLowerCase();
    return exact ? { verdict: 'ok' } : { verdict: 'accent' };
  }
  if (stripArticle(got) === stripArticle(want)) return { verdict: 'article' };
  const bare = norm(word.lemma || '');
  if (bare && (got === bare || stripArticle(got) === bare)) return { verdict: 'article' };
  if (levenshtein(got, want) <= tolerance(want)) return { verdict: 'close' };
  return { verdict: 'no' };
}

export function checkEnglish(input, word) {
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

/** Speech recognition returns several guesses; any of them counts, and the
 *  article is ignored because recognisers routinely drop it. */
export function checkSpoken(alternatives, word) {
  const targets = [norm(word.answer), norm(word.lemma || ''), stripArticle(norm(word.answer))]
    .filter(Boolean);
  let best = { verdict: 'no', score: 0 };
  for (const alt of alternatives || []) {
    const got = stripArticle(norm(alt));
    if (!got) continue;
    for (const want of targets) {
      const bare = stripArticle(want);
      if (!bare) continue;
      if (got === bare || got === want) return { verdict: 'ok', heard: alt };
      const d = levenshtein(got, bare);
      const score = 1 - d / Math.max(got.length, bare.length, 1);
      if (score > best.score) {
        best = { verdict: score >= 0.75 ? 'close' : 'no', score, heard: alt };
      }
    }
  }
  return best;
}

/** Rating for a verdict, on the 1-4 scale FSRS uses. */
export function ratingFor(verdict) {
  switch (verdict) {
    case 'ok': return 3;
    case 'accent':
    case 'article': return 3;
    case 'close': return 2;
    default: return 1;
  }
}
