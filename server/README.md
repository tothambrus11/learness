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

Identity is Cloudflare Access's job. It runs the login (email one-time code, or
Google or GitHub if you enable them) and puts a signed assertion on the request.
The Worker verifies that signature against the team's published keys, checks the
issuer, audience and expiry, and maps the verified email to an account.

It then issues a long-lived **device token**. Every ordinary request carries
that token rather than a cookie, which keeps the phone's sync free of login
redirects and lets it work the moment it is back online.

Every row belongs to exactly one account and every query is scoped to the
account on the presented token. There is no path that reads across accounts;
two people can hold the same word key without colliding.

Verified locally with two accounts: each sees only its own words, deleting a key
in one account leaves the other untouched, sync pulls and cursors are separate,
and revoking a token takes effect on the next request.

### Setting up Access

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
