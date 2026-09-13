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

/** The part of the Network Information API this app reads. Not in the DOM
 *  library, because no two browsers agree on it; every member is optional
 *  because any of them may be withheld — including the ability to be listened
 *  to, which Safari does not offer at all. */
export interface NetworkInformation {
  readonly type?: string;
  readonly saveData?: boolean;
  /** Speed, not cost, and deliberately never read: 5G is fast and metered,
   *  hotel wifi is slow and free. Declared so that ignoring it is explicit. */
  readonly effectiveType?: string;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

type MaybeConnection = Navigator & {
  connection?: NetworkInformation;
  mozConnection?: NetworkInformation;
  webkitConnection?: NetworkInformation;
};

/** Metered, unmetered, or honestly unknown. */
export type ConnectionState = 'unmetered' | 'metered' | 'unknown';

export const UNMETERED: ConnectionState = 'unmetered';
export const METERED: ConnectionState = 'metered';
export const UNKNOWN: ConnectionState = 'unknown';

const CELLULAR = new Set(['cellular', 'wimax']);
const FIXED = new Set(['wifi', 'ethernet']);

function connection(): NetworkInformation | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as MaybeConnection;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/** One of unmetered | metered | unknown. */
export function connectionState(conn: NetworkInformation | null = connection()): ConnectionState {
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
export function canDetectMetering(conn: NetworkInformation | null = connection()): boolean {
  return !!conn && (conn.saveData === true || typeof conn.type === 'string');
}

export function describeConnection(state: ConnectionState = connectionState()): string {
  switch (state) {
    case UNMETERED: return 'on an unmetered connection';
    case METERED: return 'on a metered connection';
    default: return 'unable to tell if this connection is metered';
  }
}

/** Fires whenever the connection changes, so a policy decision can be retaken
 *  the moment you walk onto wifi. */
export function onConnectionChange(handler: (state: ConnectionState) => void): () => void {
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
