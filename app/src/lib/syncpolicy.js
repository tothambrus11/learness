/** When may the app act on its own?
 *
 *  Two different transfers, two different policies, because they differ by two
 *  orders of magnitude:
 *
 *  * Syncing is a day of reviews and card states, roughly 30 kB. Guarding that
 *    against mobile data is not worth the complexity, so it defaults to
 *    automatic and metering only stops it if you ask it to.
 *  * Downloading a level's audio is about 2 MB, and downloading the whole
 *    catalogue is far more. That is where metering actually matters, so it
 *    defaults to unmetered-only and asks before spending your data.
 *
 *  No browser reports metering reliably, so where the answer is unknown the
 *  bulk policy asks once and remembers, rather than silently refusing forever.
 */
import { METERED, UNKNOWN, UNMETERED } from './network.js';

export const POLICIES = ['off', 'unmetered', 'always'];
export const DEFAULT_POLICY = 'always';        // sync: small and frequent
export const DEFAULT_BULK_POLICY = 'unmetered'; // audio: large and occasional

/** Pure so it can be tested without a browser. Returns {sync, reason}. */
export function shouldAutoSync({
  policy = DEFAULT_POLICY,
  connection = UNKNOWN,
  online = true,
  configured = false,
  lastSyncAt = 0,
  now = Date.now(),
  minIntervalMs = 15 * 60 * 1000,
  busy = false,
}) {
  if (!configured) return no('sync is not set up');
  if (!online) return no('offline');
  if (busy) return no('a session is in progress');
  if (policy === 'off') return no('automatic sync is switched off');

  if (policy === 'unmetered') {
    if (connection === METERED) return no('on a metered connection');
    if (connection === UNKNOWN) {
      return no('this browser cannot confirm the connection is unmetered');
    }
    if (connection !== UNMETERED) return no('connection state is not unmetered');
  }

  const since = now - lastSyncAt;
  if (lastSyncAt && since < minIntervalMs) {
    return no(`synced ${Math.round(since / 60000)} min ago`);
  }
  return { sync: true, reason: 'due for an automatic sync' };
}

const no = (reason) => ({ sync: false, reason });

export function policyLabel(policy, detectable) {
  switch (policy) {
    case 'off': return 'Only when I press Sync';
    case 'always': return 'Automatically, on any connection';
    default:
      return detectable
        ? 'Automatically on wifi, otherwise only when I press Sync'
        : 'Automatically when unmetered (this browser cannot tell, so never)';
  }
}


/** May we pull a few megabytes of audio right now?
 *
 *  Returns one of: 'yes' | 'no' | 'ask'. The 'ask' case is the honest answer
 *  where the browser will not say whether the connection is metered: prompt
 *  once, remember the answer, and stop asking.
 */
export function bulkDownloadDecision({
  policy = DEFAULT_BULK_POLICY,
  connection = UNKNOWN,
  online = true,
  consented = false,
}) {
  if (!online) return { decision: 'no', reason: 'offline' };
  if (policy === 'always') return { decision: 'yes', reason: 'downloads are always allowed' };
  if (policy === 'off') return { decision: 'no', reason: 'downloads are switched off' };
  if (consented) return { decision: 'yes', reason: 'you allowed downloads on this device' };
  if (connection === UNMETERED) return { decision: 'yes', reason: 'on an unmetered connection' };
  if (connection === METERED) {
    return { decision: 'ask', reason: 'this looks like a metered connection' };
  }
  return { decision: 'ask', reason: 'this browser cannot tell if the connection is metered' };
}

export function bulkPolicyLabel(policy) {
  switch (policy) {
    case 'off': return 'Never download audio automatically';
    case 'always': return 'Download audio on any connection';
    default: return 'Download audio on wifi, ask otherwise';
  }
}
