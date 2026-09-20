/** What the Grammar screen shows, decided away from the screen.
 *
 *  The rows are `tenseRows` (gate.ts). What this adds is the worked example
 *  beside a lesson: the learner's own best-known verb whose table has the
 *  tense, so the formation paragraph is read against forms they can already
 *  produce rather than against *parler*. Which verb that is comes from the
 *  cards; whether its table has the tense comes from the word, which the
 *  screen loads for the candidates in turn until one does.
 */
import type { Conjugation, IndexEntry, StoredCard } from '../model.js';
import type { WordKey } from '../keys.js';
import { isMature } from '../scheduler.js';

/** The learner's verbs, best known first: every verb of the catalogue with a
 *  written card, ordered by the card's stability, the mature ones first.
 *  The screen tries them in this order for a table that has the tense. */
export function candidateVerbs(
  cards: readonly StoredCard[], index: readonly IndexEntry[],
): WordKey[] {
  const verbs = new Set(index.filter((w) => w.k.endsWith('|verb')).map((w) => w.k));
  const best = new Map<WordKey, StoredCard>();
  for (const c of cards) {
    if (c.channel !== 'written' || c.retired || !verbs.has(c.key)) continue;
    const seen = best.get(c.key);
    if (!seen || c.stability > seen.stability) best.set(c.key, c);
  }
  return [...best.values()]
    .sort((a, b) => Number(isMature(b)) - Number(isMature(a)) || b.stability - a.stability
      || a.key.localeCompare(b.key))
    .map((c) => c.key);
}

/** Whether a verb's table has the tense to show: a simple tense is one of
 *  its groups with a form in it, a compound tense one of its compounds. */
export function hasTense(conj: Conjugation | null | undefined, tense: string): boolean {
  if (!conj) return false;
  return conj.groups.some((g) => g.id === tense && g.rows.some((r) => !!r.f))
    || conj.compound.some((c) => c.id === tense);
}

/** What the home screen says about the verb forms, in one line. */
export function formsLine(open: number, suggested: string | null): string {
  if (open === 0) return 'Verb forms: pick a tense to start';
  const tenses = `${open} tense${open === 1 ? '' : 's'} open`;
  return suggested ? `Verb forms: ${tenses} · next: ${suggested}` : `Verb forms: ${tenses}, every one`;
}
