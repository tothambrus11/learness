/** The one number the app and the Worker compare before they exchange a record.
 *
 *  Both are built from the same commit and deployed together, so the Worker
 *  knows what the app should be; it says so in every sync reply, and the app
 *  looks before it writes anything. Above the app: the app is stale — a
 *  deploy in flight, a cached worker script — and it takes the new build
 *  first. Below the app: the Worker is behind, and the app waits rather than
 *  push a kind the Worker would drop and mark as sent. Either way no record
 *  is written by code that does not know its shape, which is what lets an
 *  older phone and a newer laptop share one account without a version on
 *  every write. The whole reasoning is in GRAMMAR.md, "An older app in the
 *  loop".
 *
 *  Bump it in the commit that changes what a synced record means or adds a
 *  kind, and say why here:
 *
 *  1 — the number itself, before any kind changed.
 */
export const SCHEMA = 1;
