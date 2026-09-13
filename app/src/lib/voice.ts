/** Whether the on-device voice may run now, and what to do about it.
 *
 *  The voice is a 380 MB download the first time. That is never started on a
 *  guess: the screen asks, with the size in the sentence and in the button, and
 *  says what it can tell about the connection. The answer is not remembered —
 *  it does not need to be, since a voice that arrived is on the device for good,
 *  and a voice that did not is 380 MB still worth asking about.
 *
 *  This is the decision only. The asking is a panel on the screen — a browser
 *  confirm() box is a poor thing to meet on a phone, and it cannot show what
 *  the download costs.
 */
import { getSettings } from './db.js';
import type { Settings } from './model.js';
import { connectionState, isOnline } from './network.js';
import { DEFAULT_BULK_POLICY, modelDownloadDecision } from './syncpolicy.js';
import { MODEL_MB, generationState } from './tts.js';

export { MODEL_MB };

/** One of:
 *  - `{ go: true }`                       start now
 *  - `{ ask: true, reason, cost, urgent }`  ask first
 *  - `{ no: true, reason }`               not possible, and why
 */
/** The download has to be agreed to first: what it costs, and what can be
 *  said about the connection it would come over. */
export interface VoiceAsk {
  ask: true;
  reason: string;
  /** Megabytes, so the screen can put the size in the sentence. */
  cost: number;
  /** The connection is probably the learner's to pay for. */
  urgent: boolean;
}

export type VoiceDecision =
  | { go: true }
  | VoiceAsk
  | { no: true; reason: string };

export async function voiceDecision(): Promise<VoiceDecision> {
  const state = await generationState();
  const settings: Partial<Settings> = await getSettings().catch(() => ({}));
  const d = modelDownloadDecision({
    cached: state === 'ready',
    supported: state !== 'unsupported',
    online: state !== 'offline' && isOnline(),
    policy: settings.bulkDownload ?? DEFAULT_BULK_POLICY,
    connection: connectionState(),
  });
  if (d.decision === 'yes') return { go: true };
  if (d.decision === 'no') return { no: true, reason: d.reason };
  return { ask: true, reason: d.reason, cost: MODEL_MB, urgent: !!d.urgent };
}
