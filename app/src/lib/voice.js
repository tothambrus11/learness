/** Whether the on-device voice may run now, and what to do about it.
 *
 *  The voice is a 380 MB download the first time, which is a real amount of
 *  someone's mobile data, so it is never fetched without an answer: the bulk
 *  download policy decides, and where the browser cannot say whether the
 *  connection is metered, the screen asks and the answer is remembered. Once
 *  the model is on the device nothing is asked again.
 *
 *  This is the decision only. The asking is a panel on the screen — a browser
 *  confirm() box is a poor thing to meet on a phone, and it cannot show what
 *  the download costs.
 */
import { getSettings, setSetting } from './db.js';
import { connectionState, isOnline } from './network.js';
import { bulkDownloadDecision } from './syncpolicy.js';
import { MODEL_MB, generationState } from './tts.js';

export { MODEL_MB };

/** One of:
 *  - `{ go: true }`                       start now
 *  - `{ ask: true, reason, cost }`        ask first; `consent()` remembers a yes
 *  - `{ no: true, reason }`               not possible, and why
 */
export async function voiceDecision() {
  const state = await generationState();
  if (state === 'ready') return { go: true };
  if (state === 'unsupported') {
    return { no: true, reason: 'This browser cannot run the voice.' };
  }
  if (state === 'offline') {
    return { no: true, reason: 'The voice needs one download first, and you are offline.' };
  }
  const settings = await getSettings();
  const d = bulkDownloadDecision({
    policy: settings.bulkDownload, connection: connectionState(),
    online: isOnline(), consented: settings.bulkConsent,
  });
  if (d.decision === 'yes') return { go: true };
  if (d.decision === 'no') return { no: true, reason: `Audio downloads are off (${d.reason}).` };
  return { ask: true, reason: d.reason, cost: MODEL_MB };
}

/** Yes, on this connection, and stop asking on this device. */
export const consent = () => setSetting('bulkConsent', true);
