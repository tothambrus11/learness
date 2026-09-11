/** What the Worker is handed at runtime: every binding and variable in
 *  `wrangler.jsonc`, plus the two secrets that are deliberately not in it.
 *  Optional means the Worker copes when the value is absent, never that someone
 *  forgot to declare it — a required binding is declared required so that
 *  leaving it out of `wrangler.jsonc` is a type error at the call site rather
 *  than a 500 in production. */
export interface Env {
  /** The D1 database holding every account, device, word, card, review and
   *  lesson. Required: there is no path through the API that does not read or
   *  write it. */
  DB: D1Database;

  /** The built app, served for every path that is not `/v1/*`. Optional: a
   *  deploy can run the API alone, which is what makes the API testable
   *  without a build of the app beside it, and `serveAsset()` answers 404 when
   *  this is absent rather than crashing. */
  ASSETS?: Fetcher;

  /** The single origin allowed to call the API from a browser, e.g.
   *  `https://learness.org`. Required by `wrangler.jsonc`; empty falls back to
   *  `*`, which is what a local `wrangler dev` on a random port needs. */
  ALLOWED_ORIGIN: string;

  /** Which mail path `sendLoginCode()` takes: `resend`, `brevo`, or `console`
   *  for local development. Required, and empty is an error rather than a
   *  default. */
  EMAIL_PROVIDER: string;

  /** The From address on a login code, which must be on a domain the provider
   *  has verified. Required for `resend` and `brevo`; unused by `console`. */
  EMAIL_FROM: string;

  /** The mail provider's API key. A secret, so it is absent until
   *  `wrangler secret put EMAIL_API_KEY` has been run, and a sign-in then fails
   *  loudly rather than pretending to have sent. Unused by `console`. */
  EMAIL_API_KEY?: string;

  /** Mixed into every one-time-code hash, so a `login_codes` table read out of
   *  a backup cannot be turned back into live codes. A secret; treated as `''`
   *  when unset, which is weaker but still works. */
  CODE_PEPPER?: string;

  /** The domain passkeys are bound to, e.g. `learness.org`. A credential made
   *  on one domain will not work on another, so pin it here rather than leave
   *  it to the request; unset, it falls back to the request's hostname. */
  WEBAUTHN_RP_ID: string;

  /** The origin a passkey assertion must claim to come from. Falls back to the
   *  request's origin. */
  WEBAUTHN_ORIGIN: string;

  /** The name the authenticator shows the user when saving a passkey. Falls
   *  back to `Learness`. */
  WEBAUTHN_RP_NAME: string;

  /** The Cloudflare Access team domain, e.g. `example.cloudflareaccess.com`.
   *  Empty disables the Access login path entirely. */
  ACCESS_TEAM_DOMAIN: string;

  /** The AUD tag of the Access application, tying a token to this app rather
   *  than to any other app on the same team. Empty skips the audience check;
   *  set it on any deployment that turns Access on. */
  ACCESS_AUD: string;
}
