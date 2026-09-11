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
import { METERED, UNKNOWN, UNMETERED } from './network';
import type { ConnectionState } from './network';
import type { TransferPolicy } from './types';

/** The three policies, in the order the settings screen lists them. */
export const POLICIES = [
  'off',
  'unmetered',
  'always',
] as const satisfies readonly TransferPolicy[];

/** Sync: small and frequent, so it runs on any connection unless asked not to. */
export const DEFAULT_POLICY: TransferPolicy = 'always';

/** Audio: large and occasional, so it waits for a connection known to be free. */
export const DEFAULT_BULK_POLICY: TransferPolicy = 'unmetered';

/** What the automatic-sync decision is made from. */
export interface AutoSyncInput {
  /** The learner's choice. */
  policy?: TransferPolicy;
  /** What the browser says about the connection. */
  connection?: ConnectionState;
  /** Whether there is a network at all. */
  online?: boolean;
  /** Whether this device has an API address and a token. */
  configured?: boolean;
  /** Milliseconds at the last successful sync; 0 for never. */
  lastSyncAt?: number;
  /** The moment to measure the interval from. */
  now?: number;
  /** The shortest gap between two automatic syncs. */
  minIntervalMs?: number;
  /** True while a sitting is waiting to be carried on. A sync writes cards and
   *  the sitting is about to, so it stands aside. */
  busy?: boolean;
}

/** Whether to sync now, and the reason either way — which the settings screen
 *  shows verbatim, so the reason is a phrase and not a code. */
export interface AutoSyncVerdict {
  /** True only when every condition passed. */
  sync: boolean;
  /** Why, in words: "on a metered connection", "due for an automatic sync". */
  reason: string;
}

/** Pure so it can be tested without a browser. Conditions are checked in the
 *  order that makes the reason most useful: what is impossible first, then
 *  what the learner switched off, then what the connection costs, then how
 *  recently this already ran. */
export function shouldAutoSync({
  policy = DEFAULT_POLICY,
  connection = UNKNOWN,
  online = true,
  configured = false,
  lastSyncAt = 0,
  now = Date.now(),
  minIntervalMs = 15 * 60 * 1000,
  busy = false,
}: AutoSyncInput): AutoSyncVerdict {
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

/** A refusal with its reason. */
const no = (reason: string): AutoSyncVerdict => ({ sync: false, reason });

/** How a sync policy reads on the settings screen.
 *
 *  `detectable` is whether this browser can tell metered from unmetered; where
 *  it cannot, the unmetered option is labelled with the truth — that it will
 *  never fire — rather than offered as if it worked.
 */
export function policyLabel(policy: TransferPolicy, detectable: boolean): string {
  switch (policy) {
    case 'off':
      return 'Only when I press Sync';
    case 'always':
      return 'Automatically, on any connection';
    default:
      return detectable
        ? 'Automatically on wifi, otherwise only when I press Sync'
        : 'Automatically when unmetered (this browser cannot tell, so never)';
  }
}

/** What a bulk download decision is made from. */
export interface BulkDownloadInput {
  /** The learner's choice for audio. */
  policy?: TransferPolicy;
  /** What the browser says about the connection. */
  connection?: ConnectionState;
  /** Whether there is a network at all. */
  online?: boolean;
  /** Whether the learner has already allowed downloads on this device. */
  consented?: boolean;
}

/** Yes, no, or ask the learner first. */
export type Decision = 'yes' | 'no' | 'ask';

/** A decision with the reason to show alongside it. */
export interface BulkDownloadVerdict {
  /** What to do. */
  decision: Decision;
  /** Why, in words, for the panel that asks. */
  reason: string;
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
}: BulkDownloadInput): BulkDownloadVerdict {
  if (!online) return { decision: 'no', reason: 'offline' };
  if (policy === 'always') return { decision: 'yes', reason: 'downloads are always allowed' };
  if (policy === 'off') return { decision: 'no', reason: 'downloads are switched off' };
  if (consented) return { decision: 'yes', reason: 'you allowed downloads on this device' };
  if (connection === UNMETERED)
    return { decision: 'yes', reason: 'on an unmetered connection' };
  if (connection === METERED) {
    return { decision: 'ask', reason: 'this looks like a metered connection' };
  }
  return { decision: 'ask', reason: 'this browser cannot tell if the connection is metered' };
}

/** What the on-device voice decision is made from. */
export interface ModelDownloadInput {
  /** Whether the model is already on this device. */
  cached?: boolean;
  /** Whether this browser can run it at all. */
  supported?: boolean;
  /** Whether there is a network. */
  online?: boolean;
  /** The learner's audio policy, which can switch the voice off entirely. */
  policy?: TransferPolicy;
  /** What the browser says about the connection. */
  connection?: ConnectionState;
}

/** A voice decision: the same three answers, plus how loudly to ask. */
export interface ModelDownloadVerdict extends BulkDownloadVerdict {
  /** True where the connection may well be the learner's mobile data, which
   *  the screen says louder. */
  urgent?: boolean;
}

/** May we fetch the on-device voice — hundreds of megabytes, once?
 *
 *  Stricter than bulkDownloadDecision, and deliberately so. A level's audio is
 *  a couple of megabytes and the policy above can reasonably decide it alone;
 *  the voice is two orders of magnitude more, and nobody should meet that as a
 *  progress bar they never agreed to — least of all on a phone, where being on
 *  wifi is a guess the browser is often wrong about. So it is always asked for,
 *  whatever the connection claims, and the answer is not remembered: once the
 *  model is on the device there is nothing left to ask about.
 *
 *  `urgent` is the difference between "you are probably on wifi" and "this is
 *  probably your mobile data", which the screen says louder.
 */
export function modelDownloadDecision({
  cached = false,
  supported = true,
  online = true,
  policy = DEFAULT_BULK_POLICY,
  connection = UNKNOWN,
}: ModelDownloadInput = {}): ModelDownloadVerdict {
  if (cached) return { decision: 'yes', reason: 'the voice is already on this device' };
  if (!supported) return { decision: 'no', reason: 'This browser cannot run the voice.' };
  if (!online) {
    return {
      decision: 'no',
      reason: 'The voice needs one download first, and you are offline.',
    };
  }
  if (policy === 'off') {
    return { decision: 'no', reason: 'Audio downloads are switched off in settings.' };
  }
  if (connection === METERED) {
    return { decision: 'ask', urgent: true, reason: 'This looks like a metered connection' };
  }
  if (connection === UNKNOWN) {
    return {
      decision: 'ask',
      urgent: true,
      reason: 'This browser will not say whether the connection is metered',
    };
  }
  return { decision: 'ask', urgent: false, reason: 'This looks like an unmetered connection' };
}

/** How an audio policy reads on the settings screen. */
export function bulkPolicyLabel(policy: TransferPolicy): string {
  switch (policy) {
    case 'off':
      return 'Never download audio automatically';
    case 'always':
      return 'Download audio on any connection';
    default:
      return 'Download audio on wifi, ask otherwise';
  }
}
