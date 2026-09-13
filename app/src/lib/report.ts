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
  };
}
