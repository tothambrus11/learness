/** What a word you typed still needs, and the order the list shows them in.
 *
 *  Kept apart from words.js, which reaches the catalogue and the database, so
 *  that these rules can be tested on their own.
 */

/** The fields without which a card cannot be asked.
 *
 *  A word with no English has nothing to prompt with and nothing to accept: it
 *  used to be saveable, and then appeared in a sitting as a blank card that
 *  could not be answered. Saving one is still allowed — half a word written
 *  down beats a word forgotten — but it is warned about before it is saved,
 *  listed first afterwards, and flagged wherever it is shown.
 */
export function missingFields(rec) {
  const out = [];
  if (!String(rec?.fr ?? '').trim()) out.push('French');
  const en = Array.isArray(rec?.en) ? rec.en : [rec?.en];
  if (!en.some((e) => String(e ?? '').trim())) out.push('English');
  return out;
}

export const isIncomplete = (rec) => missingFields(rec).length > 0;

/** Your list as the words screen shows it: anything unfinished first, so it
 *  can be fixed, then the newest. */
export function sortForList(words) {
  return [...words].sort((a, b) =>
    Number(isIncomplete(b)) - Number(isIncomplete(a)) || (b.addedAt ?? 0) - (a.addedAt ?? 0));
}

/** "French, English" — for saying what is missing in a sentence. */
export const listFields = (fields) =>
  fields.length < 2 ? (fields[0] ?? '') : `${fields.slice(0, -1).join(', ')} and ${fields.at(-1)}`;
