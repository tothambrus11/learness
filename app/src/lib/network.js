/** What we can and cannot know about the connection.
 *
 *  There is no reliable "is this metered" signal on the web. `connection.type`
 *  is specified but Chrome withholds it on most platforms for fingerprinting
 *  reasons, and Firefox and Safari expose no Network Information API at all.
 *  `effectiveType` describes speed, not cost: 5G is fast and metered, hotel
 *  wifi is slow and free, so using it here would be wrong.
 *
 *  So this reports three states and never guesses. Unknown means unknown, and
 *  the sync policy treats unknown as "ask me", because spending someone's
 *  mobile data without consent is the worse error.
 */

export const UNMETERED = 'unmetered';
export const METERED = 'metered';
export const UNKNOWN = 'unknown';

const CELLULAR = new Set(['cellular', 'wimax']);
const FIXED = new Set(['wifi', 'ethernet']);

function connection() {
  if (typeof navigator === 'undefined') return null;
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
}

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/** One of unmetered | metered | unknown. */
export function connectionState(conn = connection()) {
  if (!conn) return UNKNOWN;
  /* Data Saver is the user saying "do not spend my bandwidth". Believe it. */
  if (conn.saveData === true) return METERED;
  const type = conn.type;
  if (typeof type === 'string') {
    if (CELLULAR.has(type)) return METERED;
    if (FIXED.has(type)) return UNMETERED;
    if (type === 'none') return METERED;
  }
  return UNKNOWN;
}

/** True when the browser can actually distinguish metered from unmetered, so
 *  the settings screen can say so rather than offering a policy that will never
 *  fire. */
export function canDetectMetering(conn = connection()) {
  return !!conn && (conn.saveData === true || typeof conn.type === 'string');
}

export function describeConnection(state = connectionState()) {
  switch (state) {
    case UNMETERED: return 'on an unmetered connection';
    case METERED: return 'on a metered connection';
    default: return 'unable to tell if this connection is metered';
  }
}

/** Fires whenever the connection changes, so a policy decision can be retaken
 *  the moment you walk onto wifi. */
export function onConnectionChange(handler) {
  const conn = connection();
  const fire = () => handler(connectionState(conn));
  conn?.addEventListener?.('change', fire);
  if (typeof addEventListener === 'function') {
    addEventListener('online', fire);
    addEventListener('offline', fire);
  }
  return () => {
    conn?.removeEventListener?.('change', fire);
    if (typeof removeEventListener === 'function') {
      removeEventListener('online', fire);
      removeEventListener('offline', fire);
    }
  };
}
