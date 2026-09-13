/** What the Worker is given by its deployment.
 *
 *  Everything here is declared in wrangler.jsonc except the two secrets, which
 *  are set with `wrangler secret put` and are absent in local development —
 *  hence optional, and hence the code that checks for them by hand and fails
 *  loudly rather than pretending to send an email nobody will receive.
 */
export interface Env {
  /** The one database: every row belongs to exactly one account. */
  DB: D1Database;
  /** The built app, served for everything that is not /v1. */
  ASSETS: Fetcher;

  ALLOWED_ORIGIN?: string;

  /** off | console | resend | brevo. Unset is an error, not a default. */
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL_API_KEY?: string;
  /** Mixed into the hash of a login code, so the table is not a list of them. */
  CODE_PEPPER?: string;

  /* Passkeys are bound to a domain; these pin them to the one people use. */
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_ORIGIN?: string;
  WEBAUTHN_RP_NAME?: string;

  /* Cloudflare Access, if this deployment uses it. Empty disables it. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

/** One account's device, as the token on a request identifies it. */
export interface Device {
  token_hash: string;
  user_id: string;
  name: string;
  scope: string;
  email: string;
}

/* ------------------------------------------------------------------ wire -- */

/** What the app pushes and pulls.
 *
 *  The server stores each record whole and never reads inside it beyond the
 *  few fields it indexes on — the identity, the moment it was last written,
 *  and the tombstone. That is deliberate: the shape of a card is the app's
 *  business, and a deployment must not have to be updated to carry a new
 *  field. Hence the index signature, which says "there is more here".
 */
export interface WireRecord { updatedAt?: number; deleted?: boolean; [field: string]: unknown }
export interface WireWord extends WireRecord { k: string }
export interface WireCard extends WireRecord { id: string }
export interface WireReview extends WireRecord { uid: string }
export interface WireLesson extends WireRecord { id: string }

export interface Push {
  words?: WireWord[];
  cards?: WireCard[];
  reviews?: WireReview[];
  lessons?: WireLesson[];
}

export interface SyncBody {
  /** The cursor the device last saw. Everything after it comes back. */
  since?: number;
  push?: Push;
}
