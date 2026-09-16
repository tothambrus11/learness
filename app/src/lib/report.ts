/** The bug report's surroundings: what the bar's button needs to know about
 *  this device, gathered from the modules that know it, so diagnostics.ts
 *  itself stays a notebook that anything can write in without pulling the
 *  voice, the sync and the network in behind it. */
import { version } from '$app/environment';
import { describeConnection } from './network.js';
import { isOnline } from './network.js';
import { syncConfig } from './sync.js';
import { modelCached } from './tts.js';
import type { Environment } from './diagnostics.js';

export { issueUrl, onNotes } from './diagnostics.js';

/** A query parameter that has no business in a public issue. The sync token
 *  never travels in an address — it is a header and a setting — but the
 *  connect screen's query is an OAuth request, and the rule is cheaper than
 *  the argument about which of its fields is harmless. */
const SECRET = /token|code|secret|challenge|state/i;

/** The screen a report was sent from, as the report says it: the path and
 *  the query, so a report about a word names the word, and never the origin,
 *  so a report from a test deployment reads the same as one from the real
 *  thing. Parameters named like a secret are left out. */
export function screenOf(at: { pathname: string; search: string }): string {
  const kept = [...new URLSearchParams(at.search)].filter(([name]) => !SECRET.test(name));
  const rest = new URLSearchParams(kept).toString();
  return at.pathname + (rest ? `?${rest}` : '');
}

/** This device, as the report describes it. Nothing here throws: a piece
 *  that cannot be asked is left out. */
export async function environment(): Promise<Environment> {
  const [voice, sync] = await Promise.all([
    modelCached().catch(() => false),
    syncConfig().catch(() => null),
  ]);
  return {
    version,
    agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    online: isOnline(),
    connection: describeConnection(),
    voice,
    signedIn: !!sync?.token,
    page: typeof location === 'undefined' ? '' : screenOf(location),
  };
}
