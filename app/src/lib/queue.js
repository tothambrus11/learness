/** A sitting that survives a reload.
 *
 *  A session used to be assembled fresh on every mount, so refreshing the page
 *  mid-sitting dealt a different card: the queue is shuffled, the allowance is
 *  recomputed, and nothing remembered where you were. On a phone that happens
 *  by accident — the browser reclaims a backgrounded tab — and it costs the
 *  card you were in the middle of thinking about.
 *
 *  So the queue is written down: card ids, the position in them, and what has
 *  been answered so far. Ids, not words: the word behind an id is looked up
 *  again on every load, which is why correcting a word's English now shows on
 *  the very next card rather than the next sitting.
 *
 *  Everything here is pure. session.js does the storing.
 */

/** A card id is "<lemma>|<pos>|<channel>|<rung>", and the key itself contains
 *  a bar, so it is read from the right. */
export function parseCardId(id) {
  const parts = String(id ?? '').split('|');
  if (parts.length < 4) return null;
  const rung = parts.pop();
  const channel = parts.pop();
  return { key: parts.join('|'), channel, rung };
}

/** How long a queue nobody has answered a card from is still worth carrying
 *  on with. A dealt queue is a snapshot of what was due when it was built, and
 *  cards fall due all day; after a couple of hours away, one you never started
 *  is better rebuilt than resumed. Once it has been started it is yours until
 *  it is finished, however long the interruption. */
export const UNTOUCHED_FOR = 2 * 3600 * 1000;

/** Is a written-down sitting still the one to carry on with?
 *
 *  The same day, since the scheduler's day has turned over and yesterday's due
 *  pile is not today's. A queue written down by the walk — a mode that no
 *  longer exists — is not resumed either: it was built with the typed rungs
 *  taken out.
 */
export function resumable(saved, { dayStart = 0, now = Date.now() } = {}) {
  if (!saved || !Array.isArray(saved.ids) || !saved.ids.length) return false;
  if (saved.walk) return false;
  if (!saved.day || saved.day !== dayStart) return false;
  if (saved.i >= saved.ids.length) return false;
  return saved.i > 0 || now - (saved.at ?? 0) < UNTOUCHED_FOR;
}

/** What the study screen writes down after every answer. Kept small: the
 *  queue is ids, and history is what was typed, not the card. */
export function snapshot({ items, i, day, done, history }) {
  return {
    ids: items.map((it) => it.card.id),
    i,
    day,
    done: { ...done },
    history: history.map((h) => ({ id: h.item.card.id, rating: h.rating, typed: h.typed,
      verdict: h.verdict })),
    at: Date.now(),
  };
}

/** The other direction: history rows back into the items they refer to.
 *
 *  A card can appear twice in one queue — an "Again" puts it back — so a row is
 *  matched against the item at its own position first, and only then by id.
 */
export function restoreHistory(rows = [], items = []) {
  const out = [];
  rows.forEach((row, at) => {
    const item = items[at]?.card.id === row.id
      ? items[at] : items.find((it) => it.card.id === row.id);
    if (item) out.push({ item, rating: row.rating, typed: row.typed ?? '', verdict: row.verdict ?? null });
  });
  return out;
}

/** Cards that belong at the front of a queue already dealt: your own words,
 *  added since it was written down. They go in at the current position, so
 *  the next card is one of them, and nothing already answered moves. */
export function topUp(items, i, extra) {
  if (!extra.length) return items;
  const queued = new Set(items.map((it) => it.card.id));
  const fresh = extra.filter((it) => !queued.has(it.card.id));
  if (!fresh.length) return items;
  return [...items.slice(0, i), ...fresh, ...items.slice(i)];
}
