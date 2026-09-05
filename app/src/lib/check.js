/** Grading what the learner typed.
 *
 *  Deliberately forgiving in specific ways: a missing accent or a dropped
 *  article is a note, not a failure, because the point is recall rather than
 *  transcription. What you *say* is never graded here: a recogniser has to
 *  drop the article to agree with you at all, and the article is the gender,
 *  which is the thing the card is there to teach. Speaking is self-judged.
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

/** The forms a stored answer accepts. A noun that is either gender is stored
 *  as "le/la ministre", and French says either one, so either one is right. */
export function acceptedAnswers(answer) {
  const m = /^le\/la\s+(.*)$/i.exec(answer || '');
  return m ? [`le ${m[1]}`, `la ${m[1]}`] : [answer];
}

const RANK = { ok: 0, accent: 1, article: 2, close: 3, no: 4 };

function checkOne(input, answer, lemma) {
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
export function checkFrench(input, word) {
  let best = { verdict: 'no' };
  for (const answer of acceptedAnswers(word.answer)) {
    const v = checkOne(input, answer, word.lemma);
    if (RANK[v.verdict] < RANK[best.verdict]) best = v;
  }
  return best;
}

/** A blank in a sentence: the word as it stands there, inflected and bare.
 *  "Tous ___ heureux." wants "sont", not "être" and not "le/la". */
export function checkCloze(input, form) {
  const got = norm(input);
  if (!got) return { verdict: 'no' };
  const want = norm(form);
  if (got === want) {
    return input.trim().toLowerCase() === form.toLowerCase()
      ? { verdict: 'ok' } : { verdict: 'accent' };
  }
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
