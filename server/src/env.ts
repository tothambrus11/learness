/* The split between a var and a secret matters when reading a failure: a
   missing var is a deploy that was never configured, whereas a missing secret is
   a `wrangler secret put` that was never run, and the code says which of the two
   it is rather than throwing a bare undefined.

   A required binding is declared required so that leaving it out of
   `wrangler.jsonc` is a type error at the call site rather than a 500 in
   production. */
/** What the Worker is handed at runtime: every binding and variable in
 *  `wrangler.jsonc`, plus the two secrets that are deliberately not in it.
 *  Optional means the Worker copes when the value is absent, never that someone
 *  forgot to declare it. */
export interface Env {
  /** The D1 database holding every account, device, word, card, review and
   *  lesson. Required: there is no path through the API that does not read or
   *  write it. */
  DB: D1Database;

  /* Which is what makes the API testable without a build of the app beside
     it. */
  /** The built app, served for every path that is not `/v1/*`. Optional: a
   *  deploy can run the API alone, and `serveAsset()` answers 404 when this is
   *  absent rather than crashing. */
  ASSETS?: Fetcher;

  /* The fallback is what a local `wrangler dev` on a random port needs. */
  /** The single origin allowed to call the API from a browser, e.g.
   *  `https://learness.org`. Required by `wrangler.jsonc`; empty falls back to
   *  `*`. */
  ALLOWED_ORIGIN: string;

  /* Silently not sending would tell a caller a code was on its way and leave
     them with no way in. */
  /** Which mail path `sendLoginCode()` takes: `resend`, `brevo`, or `console`
   *  for local development. Required, and empty is an error rather than a
   *  default. */
  EMAIL_PROVIDER: string;

  /** The From address on a login code, which must be on a domain the provider
   *  has verified. Required for `resend` and `brevo`; unused by `console`. */
  EMAIL_FROM: string;

  /* A sign-in then fails loudly instead of pretending to have sent. */
  /** The mail provider's API key. A secret, so it is absent until
   *  `wrangler secret put EMAIL_API_KEY` has been run. Unused by `console`. */
  EMAIL_API_KEY?: string;

  /* Reading the `login_codes` table out of a database backup then does not let
     anyone rebuild a live code by hashing all million of them. */
  /** Mixed into every one-time-code hash. A secret; treated as `''` when unset,
   *  which is weaker but still works. */
  CODE_PEPPER?: string;

  /* A credential made on one domain will not work on another, so this is pinned
     rather than taken from the request. */
  /** The domain passkeys are bound to, e.g. `learness.org`. Falls back to the
   *  request's hostname. */
  WEBAUTHN_RP_ID: string;

  /** The origin a passkey assertion must claim to come from. Falls back to the
   *  request's origin. */
  WEBAUTHN_ORIGIN: string;

  /** The name the authenticator shows the user when saving a passkey. Falls
   *  back to `Learness`. */
  WEBAUTHN_RP_NAME: string;

  /* Disabled is the default because Access is free only to 50 seats and the
     email code is not. */
  /** The Cloudflare Access team domain, e.g. `example.cloudflareaccess.com`.
   *  Empty disables the Access login path entirely. */
  ACCESS_TEAM_DOMAIN: string;

  /** The AUD tag of the Access application, tying a token to this app rather
   *  than to any other app on the same team. Empty skips the audience check;
   *  set it on any deployment that turns Access on. */
  ACCESS_AUD: string;
}
