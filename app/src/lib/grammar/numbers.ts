/** The number grammar: any integer written in words, token by token, with
 *  the rule that produced each token (GRAMMAR.md, N — Numbers).
 *
 *  The same function writes the answer key and the lessons' examples, so
 *  the two cannot disagree. The Swiss forms — *septante, huitante,
 *  nonante* — are what the learner produces unless the numerals setting
 *  says France's; the French compounds are then produced instead and are
 *  the *N.french-tens* rule's. Both spellings are accepted on input: the
 *  traditional one with spaces (*vingt et un, deux cent un*), which is what
 *  is produced, and the 1990 one with hyphens throughout.
 *
 *  Pure and shared: no `$app`, no database.
 */
import type { Instance } from './instance.js';
import type { RuleId } from './rules.js';

export type Dialect = 'ch' | 'fr';

/** One word of a number, and the rules that put it there. */
export interface NumberToken {
  text: string;
  of: RuleId[];
}

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS: Record<number, string> = { 20: 'vingt', 30: 'trente', 40: 'quarante', 50: 'cinquante',
  60: 'soixante', 70: 'septante', 80: 'huitante', 90: 'nonante' };

/** The largest number this writes: a thousand millions, which is as far as
 *  *million* goes before *milliard*. */
export const MAX_NUMBER = 999_999_999;

const tok = (text: string, ...of: RuleId[]): NumberToken => ({ text, of });

/** A number under a hundred, as tokens. `final` says nothing follows in
 *  the number but a noun (*millions*), which is when *quatre-vingts* keeps
 *  its s: *quatre-vingts*, *quatre-vingt mille*, *quatre-vingts millions*. */
function underHundred(n: number, dialect: Dialect, final = true): NumberToken[] {
  if (n <= 16) return [tok(UNITS[n]!, 'N.units')];
  if (n < 20) return [tok('dix', 'N.teens'), tok(UNITS[n - 10]!, 'N.teens', 'N.units')];
  if (dialect === 'fr' && n >= 70) {
    /* Sixty plus a teen, eighty plus a number under twenty: the French
       compounds, every token of which is the compound's rule. */
    if (n < 80) {
      const rest = n - 60;
      const tail = rest === 11
        ? [tok('et', 'N.french-tens'), tok('onze', 'N.french-tens', 'N.units')]
        : underHundred(rest, dialect, final).map((t) => tok(t.text, 'N.french-tens', ...t.of.filter((r) => r === 'N.units')));
      return [tok('soixante', 'N.french-tens'), ...tail];
    }
    const rest = n - 80;
    const head = [tok('quatre', 'N.french-tens'), tok(rest === 0 && final ? 'vingts' : 'vingt', 'N.french-tens')];
    if (rest === 0) return head;
    return [...head, ...underHundred(rest, dialect).map((t) => tok(t.text, 'N.french-tens', ...t.of.filter((r) => r === 'N.units')))];
  }
  const ten = Math.floor(n / 10) * 10;
  const unit = n % 10;
  if (unit === 0) return [tok(TENS[ten]!, 'N.tens')];
  if (unit === 1) return [tok(TENS[ten]!, 'N.tens', 'N.et-un'), tok('et', 'N.et-un'), tok('un', 'N.et-un', 'N.units')];
  return [tok(TENS[ten]!, 'N.tens', 'N.tens-units'), tok(UNITS[unit]!, 'N.tens-units', 'N.units')];
}

/** A number under a thousand; `final` as for `underHundred`. */
function underThousand(n: number, dialect: Dialect, final = true): NumberToken[] {
  if (n < 100) return underHundred(n, dialect, final);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const out: NumberToken[] = [];
  if (hundreds > 1) out.push(tok(UNITS[hundreds]!, 'N.cent', 'N.units'));
  /* *cent* takes its s only when multiplied and ending the number: *deux
     cents*, *deux cent un*, *deux cent mille* — but *deux cents millions*,
     since *millions* is a noun and the number ends before it. */
  out.push(tok(hundreds > 1 && rest === 0 && final ? 'cents' : 'cent', 'N.cent'));
  if (rest) out.push(...underHundred(rest, dialect, final));
  return out;
}

/** The number in words, as tokens with their rules. Zero to MAX_NUMBER. */
export function spell(n: number, dialect: Dialect = 'ch'): NumberToken[] {
  if (!Number.isInteger(n) || n < 0 || n > MAX_NUMBER) throw new Error(`spell: ${n} is not a number this writes`);
  if (n < 1000) return underThousand(n, dialect);
  const out: NumberToken[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (millions) {
    /* A noun: it takes *un*, and an s. */
    out.push(...underThousand(millions, dialect).map((t) => tok(t.text, 'N.million', ...t.of)));
    out.push(tok(millions > 1 ? 'millions' : 'million', 'N.million'));
  }
  if (thousands) {
    /* Never *un mille*, never *milles*. */
    if (thousands > 1) out.push(...underThousand(thousands, dialect, false).map((t) => tok(t.text, 'N.mille', ...t.of)));
    out.push(tok('mille', 'N.mille'));
  }
  if (rest) out.push(...underThousand(rest, dialect));
  return out;
}

/** Where the words join: a hyphen inside a number under a hundred, a space
 *  everywhere else (the traditional spelling); *et* stands between spaces. */
function joiner(a: NumberToken, b: NumberToken): string {
  if (a.text === 'et' || b.text === 'et') return ' ';
  const small = (t: NumberToken): boolean =>
    t.of.some((r) => r === 'N.teens' || r === 'N.tens-units' || r === 'N.french-tens');
  return small(a) && small(b) ? '-' : ' ';
}

/** The number in words, traditional spelling. */
export function words(n: number, dialect: Dialect = 'ch'): string {
  const tokens = spell(n, dialect);
  return tokens.map((t, i) => (i ? joiner(tokens[i - 1]!, t) : '') + t.text).join('');
}

/** Every spelling accepted: the traditional one and the 1990 one with
 *  hyphens throughout, where they differ. */
export function spellings(n: number, dialect: Dialect = 'ch'): string[] {
  const traditional = words(n, dialect);
  const reformed = traditional.replace(/ /g, '-');
  return reformed === traditional ? [traditional] : [traditional, reformed];
}

/** The rules a number is an instance of, each once, in the order met. */
export function rulesOf(n: number, dialect: Dialect = 'ch'): RuleId[] {
  const seen: RuleId[] = [];
  for (const t of spell(n, dialect)) for (const r of t.of) if (!seen.includes(r)) seen.push(r);
  return seen;
}

/** The digits as French writes them: groups of three, a thin space between. */
export const digits = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** The analyser's version, on every attempt it labels. */
export const NUMBER_GENV = 1;

/** The numbers each rule is drilled on: enough to meet every case the rule
 *  has, none that another rule in the set would make harder than the bit
 *  being learned. A rule's pool is what its lesson shows, too. */
export const NUMBER_POOLS: Readonly<Partial<Record<RuleId, readonly number[]>>> = {
  'N.units': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  'N.teens': [17, 18, 19],
  'N.tens': [20, 30, 40, 50, 60, 70, 80, 90],
  'N.tens-units': [22, 25, 33, 38, 44, 47, 56, 59, 62, 67, 73, 78, 84, 86, 92, 99],
  'N.et-un': [21, 31, 41, 51, 61, 71, 81, 91],
  'N.french-tens': [70, 71, 72, 75, 79, 80, 81, 85, 90, 91, 95, 99],
  'N.cent': [100, 101, 110, 180, 200, 201, 281, 300, 555, 700, 999],
  'N.mille': [1000, 1001, 1100, 2000, 2026, 3500, 10_000, 12_345, 100_000, 999_999],
  'N.million': [1_000_000, 1_000_001, 2_000_000, 1_500_000, 2_300_000, 250_000_000],
};

/** The identity of a number as an exercise, for breadth: the number, in
 *  the dialect asked for. */
export const numberId = (n: number, dialect: Dialect): string => `number:${n}${dialect === 'fr' ? ':fr' : ''}`;

/** The rules with a number generator: every pool above, save the French
 *  compounds' when the learner produces the Swiss forms, since those are
 *  then read and never written. */
export function numberRules(dialect: Dialect): RuleId[] {
  return (Object.keys(NUMBER_POOLS) as RuleId[]).filter((r) => r !== 'N.french-tens' || dialect === 'fr');
}

/** One number to write in words, for the rule it is dealt for: one cell,
 *  the digits before it, judged on the words — each rule the number uses
 *  is right when every word it produced is among the words typed. */
export function numberFor(n: number, rule: RuleId, dialect: Dialect = 'ch'): Instance {
  const tokens = spell(n, dialect);
  const [expected, ...also] = spellings(n, dialect);
  return {
    id: numberId(n, dialect), gen: 'number', face: 'spell', spec: { n, dialect }, genv: NUMBER_GENV,
    rule, title: digits(n), hint: `in words${dialect === 'fr' ? ', as France writes it' : ''}`,
    cells: [{
      prompt: '', expected: expected!, ...(also.length ? { also } : {}),
      tokens: tokens.map((t) => ({ text: t.text, of: t.of })),
      obs: rulesOf(n, dialect).map((of) => ({ of, on: 'token' as const })),
    }],
  };
}

/** Every number the rule is drilled on, as exercises. */
export const numbersFor = (rule: RuleId, dialect: Dialect = 'ch'): Instance[] =>
  (NUMBER_POOLS[rule] ?? []).map((n) => numberFor(n, rule, dialect));
