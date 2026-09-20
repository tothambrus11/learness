/** What the Worker is given by its deployment.
 *
 *  Everything here is declared in wrangler.jsonc except the two secrets, which
 *  are set with `wrangler secret put` and are absent in local development —
 *  hence optional, and hence the code that checks for them by hand and fails
 *  loudly rather than pretending to send an email nobody will receive.
 */
import type { SyncKind } from '../../app/src/lib/kinds.js';

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

/** A colour theme the learner made or edited, as it travels between devices.
 *
 *  Unlike the records above, this one is spelled out: the app and the server
 *  agreed on it at the same time (#66), and a field named here is a field a
 *  test can pin. The server still stores the record whole and reads only
 *  `id`, `updatedAt` and `deleted`; a field the app adds later travels
 *  without a deployment.
 */
export interface WireTheme extends WireRecord {
  /** Stable identity: a built-in's id when the theme is an edit of one, else
   *  a uuid. Two devices editing the same built-in are editing one theme. */
  id: string;
  name: string;
  mode: 'light' | 'dark';
  /** Token name to CSS colour, and only the tokens the learner set; the rest
   *  fall through to whatever the theme is based on. */
  colours: Record<string, string>;
  /** The built-in this was copied or edited from, if any. */
  basedOn?: string;
  /** Milliseconds since the epoch. The later write wins, whichever device
   *  sent it first. */
  updatedAt: number;
  /** A tombstone: the theme was deleted and the deletion must reach every
   *  device, rather than the theme coming back from the one that missed it. */
  deleted?: boolean;
}

/** The record of each kind, as it travels. A kind added to SYNC_KINDS
 *  without a row here does not compile, which is the point. */
export interface Wire {
  words: WireWord;
  cards: WireCard;
  reviews: WireReview;
  lessons: WireLesson;
  /** Absent from a device that has no theme changes, and from an app older
   *  than themes; either pulls what the others made. */
  themes: WireTheme;
}

/** Every field optional: a device pushes only the kinds it has changes in,
 *  and an older app does not know the newer ones. */
export type Push = { [K in SyncKind]?: Wire[K][] };

export interface SyncBody {
  /** The cursor the last reply handed the device: the counter as it stood,
   *  or, when that reply was one page of more, the row to carry on from.
   *  Everything at or past it comes back, at most a page of each table. */
  since?: number;
  /** The schema the app was built with (app/src/lib/schema.ts). A push from
   *  an app ahead of this Worker is refused whole, with the Worker's own
   *  number, rather than stored with the kinds it does not know left out.
   *  Absent from an app older than the number, which is taken as behind. */
  schema?: number;
  push?: Push;
}
