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

## Setting it up

```bash
cd server
npx wrangler d1 create frcog              # paste the id into wrangler.toml
npx wrangler d1 execute frcog --remote --file migrations/0001_init.sql
npx wrangler deploy
```

Then mint a token per device. The token is shown once and only its hash is
stored, so a database leak does not hand anyone a working key.

```bash
node mint-token.js "pixel phone"          # full access, for the study app
node mint-token.js "claude" words         # word list only, for MCP
```

Each prints the `wrangler d1 execute` line that registers it.

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

| Method | Path | Scope |
|---|---|---|
| POST | `/v1/sync` | full |
| GET | `/v1/words` | words, full |
| POST | `/v1/words` | words, full |
| DELETE | `/v1/words/:key` | words, full |
| GET | `/v1/progress` | words, full |
| GET | `/v1/health` | none |
