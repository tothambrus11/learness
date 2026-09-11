/** Whether the on-device voice may run now, and what to do about it. The
 *  decision only: the asking is a panel on the screen. */

import { getSettings } from './db';
import { connectionState, isOnline } from './network';
import { modelDownloadDecision } from './syncpolicy';
import { MODEL_MB, generationState } from './tts';
import type { Settings } from './types';

/** Passed through so a screen can say what the download costs without also
 *  importing the voice itself. */
export { MODEL_MB };

/** What to do about the voice, in exactly one of three shapes: `go`, `ask` or
 *  `no` is set, and the fields below belong to the shape that names them. */
export interface VoiceDecision {
  /** Set where it may start now, either because the model is already here or
   *  because the policy allows the download outright. */
  go?: true;
  /** Set where the size has to be agreed to first. */
  ask?: true;
  /** Set where it cannot happen at all. */
  no?: true;
  /** Why, in the words the panel shows. On `ask` and `no`. */
  reason?: string;
  /** Megabytes the download costs, for the sentence and the button. On `ask`. */
  cost?: number;
  /** True where this looks like mobile data rather than wifi, which the panel
   *  says louder. On `ask`. */
  urgent?: boolean;
}

/** One of:
 *  - `{ go: true }`                       start now
 *  - `{ ask: true, reason, cost, urgent }`  ask first
 *  - `{ no: true, reason }`               not possible, and why
 */
export async function voiceDecision(): Promise<VoiceDecision> {
  const state = await generationState();
  const settings: Partial<Settings> = await getSettings().catch(() => ({}));
  const d = modelDownloadDecision({
    cached: state === 'ready',
    supported: state !== 'unsupported',
    online: state !== 'offline' && isOnline(),
    policy: settings.bulkDownload,
    connection: connectionState(),
  });
  if (d.decision === 'yes') return { go: true };
  if (d.decision === 'no') return { no: true, reason: d.reason };
  return { ask: true, reason: d.reason, cost: MODEL_MB, urgent: !!d.urgent };
}
