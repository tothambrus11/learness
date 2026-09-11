/** What we can and cannot know about the connection: three states, and never
 *  a guess. */

/* There is no reliable "is this metered" signal on the web. `connection.type`
   is specified but Chrome withholds it on most platforms for fingerprinting
   reasons, and Firefox and Safari expose no Network Information API at all.
   `effectiveType` describes speed, not cost: 5G is fast and metered, hotel
   wifi is slow and free, so using it here would be wrong.

   Unknown therefore means unknown, and the sync policy treats unknown as "ask
   me", because spending someone's mobile data without consent is the worse
   error. */

/** The connection costs nothing to use: wifi or ethernet, and the browser
 *  said so rather than us guessing. */
export const UNMETERED = 'unmetered';

/** The connection is paid for by the byte, or the learner has asked the
 *  browser to save data. */
export const METERED = 'metered';

/** The browser will not say. Never treated as permission to spend. */
export const UNKNOWN = 'unknown';

/** The three answers, and the only values `connectionState()` returns. */
export type ConnectionState = typeof UNMETERED | typeof METERED | typeof UNKNOWN;

/* Declared rather than imported: it is not in the DOM library, it is absent on
   most browsers, and every field is optional even where it exists. */
/** The Network Information API, as much of it as is read here. */
interface NetworkInformation extends EventTarget {
  /** The transport, where the browser admits it: `wifi`, `cellular`,
   *  `ethernet`, `none`. Undefined on every browser that withholds it. */
  readonly type?: string;
  /** True when the learner has switched on the browser's data saver. */
  readonly saveData?: boolean;
}

/** The navigator, with the vendor-prefixed spellings of the connection
 *  property that older engines still use. */
interface NavigatorWithConnection extends Navigator {
  /** The standard spelling. */
  readonly connection?: NetworkInformation;
  /** Firefox's old spelling. */
  readonly mozConnection?: NetworkInformation;
  /** Chromium's old spelling. */
  readonly webkitConnection?: NetworkInformation;
}

/** Transports that are paid for by the byte. */
const CELLULAR: ReadonlySet<string> = new Set(['cellular', 'wimax']);

/** Transports that are not. */
const FIXED: ReadonlySet<string> = new Set(['wifi', 'ethernet']);

/** The connection object this browser exposes, or null where there is none —
 *  which is most of them, and is not an error. */
function connection(): NetworkInformation | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as NavigatorWithConnection;
  return nav.connection || nav.mozConnection || nav.webkitConnection || null;
}

/** Is there a network at all? True where there is no navigator to ask. */
export function isOnline(): boolean {
  /* Optimistic without a navigator: a server-side render must not decide the
     app is offline. */
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/** One of unmetered | metered | unknown. Never guesses: anything the browser
 *  does not state outright comes back unknown. */
export function connectionState(
  conn: NetworkInformation | null = connection(),
): ConnectionState {
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

/** True when the browser can actually distinguish metered from unmetered. */
export function canDetectMetering(conn: NetworkInformation | null = connection()): boolean {
  /* So the settings screen can say so rather than offering a policy that will
     never fire. */
  return !!conn && (conn.saveData === true || typeof conn.type === 'string');
}

/** The connection state as a phrase that can be dropped into a sentence. */
export function describeConnection(state: ConnectionState = connectionState()): string {
  switch (state) {
    case UNMETERED:
      return 'on an unmetered connection';
    case METERED:
      return 'on a metered connection';
    default:
      return 'unable to tell if this connection is metered';
  }
}

/** Calls `handler` with the new state whenever the connection changes. Returns
 *  the unsubscribe function; calling it twice is harmless. */
export function onConnectionChange(handler: (state: ConnectionState) => void): () => void {
  /* So a policy decision can be retaken the moment you walk onto wifi. */
  const conn = connection();
  const fire = (): void => handler(connectionState(conn));
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
