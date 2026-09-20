# Sync API and connector

One user, several devices, plus a Claude session that may touch your hand-added
word list and nothing else. A single Cloudflare Worker over a D1 database, which
is SQLite, so it mirrors the pipeline's own storage. The same Worker is an MCP
server, at `/mcp`, which is how a Claude conversation adds the words from a
lesson; see [Connecting Claude](#connecting-claude).

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
npx wrangler d1 create frcog              # paste the id into wrangler.jsonc
npx wrangler d1 migrations apply frcog --remote
npx wrangler deploy
```

`migrations apply` keeps a ledger in the database (`d1_migrations`, one row
per file) and runs each file in `server/migrations` once, in order. That is
the only way a migration is applied, by hand or by the pipeline. Never
`d1 execute` a migration file against a database that has data: `0002`
drops and recreates the tables, which was fine on the day it was written
and would empty the account today. A database migrated by hand before the
ledger existed is brought under it by creating the ledger and naming the
files already applied:

```sql
CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_init.sql'), ('0002_accounts.sql'), …;
```

A migration written from now on is additive — a new table, a new column,
an index — and never assumes an empty table; `tests/migrations.test.ts`
refuses one that drops anything.

## Deploying

A push to `main` deploys, and Cloudflare's Workers Builds does it: it
watches the repository, runs the build command, then the deploy command.

| Setting in Workers Builds | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| API token | needs **D1: Edit** added to it |

`npm run deploy` is `npm run migrate && wrangler deploy` — the schema
before the code, which is the whole point. A Worker that reads a table its
database has not got yet is an outage: the first sync after the themes
went out answered `no such table: themes`, because the migrations were a
loop in this README that nobody had run. Deploying by hand is the same two
commands, after a build: `npm run build && npm run deploy`.

The token Workers Builds generates for itself covers Workers Scripts,
Workers Routes, KV and R2, but **not D1**, so the migration step fails
until D1: Edit is added to it under My Profile → API Tokens.

What stops a broken deploy is not the deploy: it is the pull request. The
checks run on the merge result, and `main` is protected:

- Require a pull request before merging.
- Require status checks to pass: `app` and `pipeline`.
- Require branches to be up to date before merging, so a pull request
  whose base has moved is re-tested against what it will actually become.
- Do not allow bypassing the above.
Tokens normally come from the login flow above, or from the OAuth flow below
for an MCP client. `mint-token.ts` remains for the cases neither covers: a
script that wants a token without a browser, recovering from a misconfigured
login, or seeding the first account.

```bash
node mint-token.ts you@example.com "pixel phone"
node mint-token.ts you@example.com "claude" words
```

It derives the account id the same way the Worker does, so a token minted here
and a later browser login land on the same account.

## Scopes

| Scope | Can do | Cannot do |
|---|---|---|
| `full` | sync words, cards, reviews, lessons, themes | — |
| `words` | read and write your word list; read where each word stands (its cards' state); read counts | read the review log; write a card, a review, a lesson or a theme; sync |

The split is the point of having two. A Claude session can curate vocabulary
from your lessons; it cannot read your review history or corrupt your progress.
The worst a mistake there can do is a bad word list edit, which you can see and
undo. Reading the cards' state is the one widening the connector asked for: it
is how it can say "you already know this one" instead of adding it again.

## Connecting Claude

The Worker is a remote MCP server. claude.ai (Settings → Connectors → add a
custom connector) and Claude Code (`claude mcp add --transport http learness
https://learness.org/mcp`, then `/mcp` to sign in) both connect to
`https://learness.org/mcp` and are let in by OAuth: the client discovers the
two well-known documents, registers itself, and sends your browser to
`/connect/` in the app, where you sign in if you are not and press Allow. What
comes out the other end is an ordinary device token with the `words` scope,
named after the client, listed under Devices and revoked from there like a
lost phone. There is no refresh token because the token does not expire; it is
a device.

The pieces, all in `src/`:

| File | Does |
|---|---|
| `oauth.ts` | registration, authorise (→ `/connect/`), approve, token; PKCE S256 only; the well-known documents |
| `mcp/protocol.ts` | JSON-RPC and the MCP lifecycle over plain POST, stateless: no session, no event stream |
| `mcp/tools.ts` | the six tools |
| `mcp/args.ts` | where a tool's arguments stop being JSON |
| `resolve.ts` | what a word Claude offers already is, and what to do about it |
| `catalogue.ts` | the shipped catalogue, read through the assets binding |
| `wordstore.ts` | the account's words and cards over D1 |

### The tools

| Tool | Does |
|---|---|
| `search_words` | one query across your list, the catalogue and the dictionary, each hit saying where it is and where it stands |
| `list_words` | your own words with their keys and status; by lesson, with or without the removed ones |
| `add_words` | a list of words, each decided and answered on its own; `dryRun` decides without writing |
| `update_words` | corrections by key; the key never changes, so cards and history stay |
| `remove_words` | tombstones by key; the removal travels to your devices |
| `get_progress` | counts only |

Additions, corrections and removals are separate tools rather than one call
with three lists: they differ in what can go wrong (only an addition can be a
duplicate, only a removal is destructive), and a removal buried among thirty
additions is a mistake nobody sees. Within a tool the words come as a list, so
a lesson is one call and one sequence of writes.

### Duplicates

The first connector keyed a word by its typed spelling, so "le train" became
`le train|noun` beside the catalogue's `train|noun`: one word, two cards, one
of them mute. Now every word offered is decided against three places before
anything is written, with the app's own rules (`sameWord`, `nearMiss`,
`userKey`, `statusOf`, imported rather than copied):

| Where the word already is | What happens |
|---|---|
| your list, same key, same content | `unchanged` |
| your list, same key, different glosses | `conflict` — the list may hold a correction the lesson does not know |
| your list, another key (the old connector's) | `conflict` |
| the catalogue, one entry, same part of speech and gender | `promote`: the catalogue's key and record, the lesson's gloss first |
| the catalogue, two entries ("le poste", "la poste", no gender given) | `conflict` |
| the catalogue, a different part of speech | `conflict` |
| the dictionary only | `add`, filled in: article, gender, transcription |
| your list, a letter or two apart | `conflict` |
| the catalogue, a letter or two apart, and the dictionary has never heard of it | `conflict` — probably a typo |
| this very batch, earlier | `merged` into that row |
| nowhere | `add`, as your own, keyed by its spelling |

A `conflict` writes nothing for that row and returns the candidates — source,
key, spelling, glosses, part of speech, gender, where it stands, and how it
relates to what was offered. Rows that were clear are written even when others
conflict. Claude then sends the row again with `resolve.use` set to a
candidate's key (it is that word: an existing entry is updated in place, a
catalogue entry promoted, a dictionary entry taken) or `resolve.force` (it is
a word of its own), asking the learner when the candidates do not settle it.
An unreadable catalogue or dictionary is said in the answer, never treated as
"no such word".

A word whose English matches one of yours under a different French word is
reported beside the outcome as `related` — a synonym worth knowing about — and
never merged.

### Well-known and OAuth endpoints

| Method | Path | Guarded by |
|---|---|---|
| GET | `/.well-known/oauth-authorization-server` | nothing |
| GET | `/.well-known/oauth-protected-resource` | nothing |
| POST | `/v1/oauth/register` | nothing (RFC 7591) |
| GET | `/v1/oauth/authorize` | redirects to `/connect/` |
| POST | `/v1/oauth/approve` | device token (the learner's own, from the app) |
| POST | `/v1/oauth/token` | the code and its PKCE verifier |
| POST | `/mcp` | device token, either scope |

A request to `/mcp` without a token is answered 401 with a `WWW-Authenticate`
header naming the resource metadata, which is what makes a client start the
flow by itself.

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

`/v1/words` is the plain REST face of the list, kept for scripts; it writes the
same records through the same store as the connector, but does none of the
checking. Use `/mcp` for anything that decides.
