# Sync API

One user, several devices, plus an authenticated Claude session that may touch
your hand-added word list and nothing else. A single Cloudflare Worker over a D1
database, which is SQLite, so it mirrors the pipeline's own storage.

Sync is always something you press, never automatic. The phone's local database
stays the working copy, so a session with no signal behaves exactly like one at
home and nothing is ever half-uploaded mid-review.

## How merging works

Three shapes, three rules, chosen so two devices offline for a week both survive:

- **Reviews** are append-only with a unique id each, so merging is a set union.
  Pushing the same batch twice changes nothing.
- **Card scheduling** is derived and cannot be replayed exactly, because FSRS
  adds fuzz. Last write wins, judged by when the card was last *answered*, not
  when it was last uploaded.
- **Your words** are last write wins on edit time, with a tombstone so a
  deletion travels rather than being resurrected by the other device.

Pulls use a server-assigned sequence number rather than timestamps, so the two
clocks never have to agree.

## Accounts and login

Login is an email one-time code, implemented here. Cloudflare Access was the
obvious choice and is still supported, but its free tier stops at 50 seats;
this costs nothing per user and has no ceiling.

It stays cheap because of an architectural detail: a device token is long-lived,
so a code is needed when you add a device, not every time you open the app. That
is a handful of emails per person for the life of an account, which fits inside
a free email tier indefinitely.

    POST /v1/auth/request  { email }                  sends a six-digit code
    POST /v1/auth/verify   { email, code, name }      returns a device token

## Passkeys

The pleasant way in on a phone: a face or fingerprint check instead of fetching
a code out of your email. Email codes stay, because you need one to register
your first passkey and one to get back in if every device is lost.

    POST /v1/auth/passkey/login/options               public
    POST /v1/auth/passkey/login/verify                returns a device token
    POST /v1/auth/passkey/register/options            device token required
    POST /v1/auth/passkey/register/verify             device token required
    GET  /v1/auth/passkeys                            list
    DELETE /v1/auth/passkeys/:id                      remove

Registering is deliberately gated on already holding a token. Anything looser
would let a stranger attach their own passkey to your account, which would be a
far worse hole than a guessable code.

Credentials are discoverable, so signing in needs nothing typed first: the
authenticator offers whichever passkey it holds for the site and the user handle
identifies the account. Challenges live on the server for five minutes and are
destroyed the moment they are used, so a replay finds nothing.

A counter that fails to advance can mean a cloned authenticator, and is refused
&mdash; but only when both the stored and incoming counters are non-zero, since
plenty of real passkeys report zero forever.

**Passkeys are bound to a domain.** One created on a `workers.dev` URL will not
work on `learness.org`, so `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` must be pinned
to the domain people actually use. They also need a secure context, so passkeys
are unavailable over plain http on a LAN address.

A six-digit code is only a million possibilities, so hashing it is not what
makes this safe. What does: it lasts ten minutes, dies after five wrong
attempts, is destroyed the moment it is used, and one address may request three
codes per fifteen minutes. Hashing means reading the table does not reveal live
codes, and the hash is bound to the address so a code cannot be replayed against
someone else. Comparison is length-independent. The request endpoint answers the
same either way, so it cannot be used to find out who has an account.

It then issues a long-lived **device token**. Every ordinary request carries
that token rather than a cookie, which keeps the phone's sync free of login
redirects and lets it work the moment it is back online.

Every row belongs to exactly one account and every query is scoped to the
account on the presented token. There is no path that reads across accounts;
two people can hold the same word key without colliding.

Verified locally with two accounts: each sees only its own words, deleting a key
in one account leaves the other untouched, sync pulls and cursors are separate,
and revoking a token takes effect on the next request.

### Email

**Resend, not Brevo.** Brevo's API requires listing authorized IP addresses, and
a Worker egresses from Cloudflare's entire edge network, so there is no stable
address to authorize. The Brevo code is still there for anyone running this
somewhere with a fixed IP, but it cannot work from a Worker.

Resend's free plan is 3,000 emails a month and 100 a day, permanent and with no
card required. Since a device token is long-lived, a code is needed when adding
a device rather than on every visit, so this is roughly a hundred new device
registrations a day, which this will not approach.

Two ways to set the sending address:

- **Straight away, no DNS.** Send from `onboarding@resend.dev`. Resend allows
  this without verifying anything, but only delivers to the address that owns
  the Resend account. Good enough to sign in on your own devices.
- **Properly.** Verify `learness.org` in Resend and send from
  `login@learness.org`. Resend supplies DKIM and return-path records; the zone
  is already on Cloudflare, so adding them is a few clicks. Required before
  anyone else can sign in.

Then store the key and deploy:

```bash
npx wrangler secret put EMAIL_API_KEY
npx wrangler secret put CODE_PEPPER     # any long random string
```

Without a key, a sign-in fails with a message saying so. That is deliberate: the
earlier default printed the code to the log, which in production meant the
request answered "sent" while the code went nowhere.

Local development overrides the provider with `console` in `.dev.vars`, which
prints the code to the terminal and sends nothing.

### Setting up Access (optional, and capped at 50 users)

In the Zero Trust dashboard, create a **self-hosted application**:

| Field | Value |
|---|---|
| Path | `learness.org/v1/auth` |
| Policy | Allow, emails you choose |
| Identity | One-time PIN is enough; Google or GitHub also work |

Only `/v1/auth` goes behind Access. The app itself is public static code with
nothing secret in it, and the rest of the API is guarded by device tokens. That
split matters: putting the whole site behind Access would make the service
worker cache login interstitials and break offline use.

Then copy the application's **AUD tag** and your team domain into `wrangler.toml`:

```toml
ACCESS_TEAM_DOMAIN = "yourteam.cloudflareaccess.com"
ACCESS_AUD = "the AUD tag from the application"
```

`ACCESS_AUD` is not optional in practice. Without it, a token minted for any
other application on the same team would be accepted here.

### Logging in on a device

Open `https://learness.org/v1/auth/start?redirect=/&name=phone`. Access asks for
your email, sends a code, and on success the Worker issues a token and redirects
back to the app with it in the URL fragment. Fragments are never sent to servers
and do not appear in logs.

The app lists its devices at `/v1/auth/devices` and revokes one with a DELETE,
so a lost phone is one action rather than a password change.

## Setting it up

```bash
cd server
npx wrangler d1 create frcog              # paste the id into wrangler.toml
npx wrangler d1 execute frcog --remote --file migrations/0001_init.sql
npx wrangler deploy
```

Apply both migrations, in order:

```bash
npx wrangler d1 execute frcog --remote --file migrations/0001_init.sql
npx wrangler d1 execute frcog --remote --file migrations/0002_accounts.sql
```

Tokens normally come from the login flow above. `mint-token.js` remains for the
cases that flow cannot cover: setting up MCP, recovering from a misconfigured
Access application, or seeding the first account.

```bash
node mint-token.js you@example.com "pixel phone"
node mint-token.js you@example.com "claude" words
```

It derives the account id the same way the Worker does, so a token minted here
and a later browser login land on the same account.

## Scopes

| Scope | Can do | Cannot do |
|---|---|---|
| `full` | sync words, cards, reviews, lessons | — |
| `words` | read and write your word list and lessons, read counts | read the review log, write scheduling state |

The split is the point of having two. A Claude session can curate vocabulary
from your lessons; it cannot read your review history or corrupt your progress.
The worst a mistake there can do is a bad word list edit, which you can see and
undo.

## Endpoints

| Method | Path | Guarded by |
|---|---|---|
| GET | `/v1/auth/session` | Cloudflare Access |
| GET | `/v1/auth/start` | Cloudflare Access |
| POST | `/v1/auth/device` | Cloudflare Access |
| GET | `/v1/auth/devices` | device token |
| DELETE | `/v1/auth/devices/:id` | device token |
| POST | `/v1/sync` | device token, full scope |
| GET | `/v1/words` | device token |
| POST | `/v1/words` | device token |
| DELETE | `/v1/words/:key` | device token |
| GET | `/v1/progress` | device token |
| GET | `/v1/health` | nothing |
