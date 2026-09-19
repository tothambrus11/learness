# Working on Learness

The database is the source of truth, the pipeline builds the catalogue, and the
web app is a view over it. `README.md` explains what the thing is and how to
run the pipeline; `DESIGN.md` explains why the learning model is what it is.
This file is how the code is written.

## The stack

Everything in the browser and on the edge is TypeScript, built and tested on
the oxc/rolldown toolchain:

| | |
|---|---|
| bundler, dev server | **rolldown-vite** (`vite` is aliased to it in `app/package.json`) |
| linter | **oxlint**, type-aware (`oxlint-tsgolint`) |
| tests | **Vitest**, on the same pipeline the app is built with |
| typechecker | **svelte-check** for the app (it reads `.svelte` too), `tsc` for the Worker |
| language | **TypeScript 6**, `strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |

Two packages, two runtimes, so two configurations: `app/` is the browser, and
`server/` is workerd — with `server/tsconfig.node.json` for the two pieces of it
that are neither (the tests and the break-glass token minter).

```bash
npm run install:all      # every package, from the repository root
npm run check            # lint, typecheck, unit tests: what CI runs
npm --prefix app run dev # the app and its API together, on one origin
npm --prefix app run test:e2e   # the browser suite; needs a build and a Chromium
```

## Everything is TypeScript, and the types say what the code means

A new file is `.ts` or `.svelte` with `lang="ts"`. There is no `allowJs`. The
compiler is not there to catch typos; it is there to make a class of bug
impossible to write, so the types carry meaning rather than shape:

* **Units are in the type.** `Millis` and `Seconds` are distinct branded
  numbers (`app/src/lib/units.ts`). The app speaks milliseconds, the review log
  speaks seconds, and they are a thousand apart — a value in the wrong unit
  does not crash, it silently means a different moment. That is exactly how the
  week window came to be asked for in milliseconds against an index of seconds:
  a cutoff fifty-six thousand years out, an empty result on every screen, and no
  error anywhere. The only way between them is `msOf`/`secOf`, cutoffs are built
  with `agoMs`, and `reviewsSince` checks the unit at runtime as well, for the
  callers a type cannot reach.
* **Ids that look alike are different types.** A `WordKey` ("bug|noun") and a
  `CardId` ("bug|noun|written|say") are both bar-separated strings and mean
  different things; `getCard(card.key)` is a compile error.
* **A set of rungs lives in `keys.ts`, never in a screen.** `TYPED`,
  `HANDS_FREE`, `HEARD_FIRST`, `SAY_ALOUD`: adding a rung is one file, and
  `tests/keys.test.ts` asserts the sets stay consistent with each other.
* Where a value genuinely arrives untyped — a row out of IndexedDB, a catalogue
  file, a request body — it is trusted in **one** place, named so it can be
  grepped (`trustMs`, `trustWordKey`, `field`), never at each reader.

`any` does not appear. `unknown` at a boundary, narrowed immediately, does.

## Contract documentation

Every exported function, type and field says what it promises, in a `/** */`
block, in prose. Not what the code does — what a caller may rely on and what it
must not: which unit, whether null means absent or unknown, what happens on
failure, and why the awkward thing is the way it is. The tone throughout this
repository is plain English about the learner, not about the machine; a comment
that explains *why* earns its place, one that repeats the next line does not.

Where a decision was a mistake once, the comment says so. The bugs are the
documentation people actually read.

## Everything is tested

`app/tests/` is the unit suite: every module in `app/src/lib` has a test file of
its own, and the ones with no test are the ones with nothing but constants in
them (`tenses.ts`) or nothing but a browser (`tts/supertonic.worker.ts`).

* **Fixtures are complete records**, built by `tests/make.ts` — `card()`,
  `review()`, `word()`, `settings()`. An object literal standing in for a card
  is how a test comes to assert against a shape the app never stores.
* **The database is real.** `tests/harness.ts` gives a fresh `fake-indexeddb`
  and a fresh module graph, and the session, words, sync and db tests drive the
  actual code against it. That is the layer the day's bug lived in: every piece
  was individually right and the query between them asked for the wrong thing.
* **`app/tests/e2e/` drives the built app in a browser** — the numbers on the
  home screen moving after a sitting, the audio at the flip, the tab row not
  shifting under a tap. Each of those was a bug, and each was invisible to
  everything below that line. It serves its own small catalogue, so it runs
  anywhere the app has been built.
* A test's name is a sentence about the app, not about the function. A bug
  fixed gets a test that states the rule it broke, and a comment saying what
  the failure looked like.

`server/tests/` drives the Worker itself: `tests/d1.ts` is D1 over Node's own
SQLite with the real migrations applied, `tests/env.ts` serves the fixture
catalogue through a fake assets binding, and the OAuth flow and every MCP tool
are exercised through `worker.fetch` against them. The login rules stay plain
functions. What is left for deploying is workerd itself.

`tests/` at the root is the pipeline's, in pytest, on the same principle: the
rules that decide what a word is worth are tested against real corpora and a
temporary SQLite, and `test_webexport.py` pins the catalogue shape the
TypeScript app parses — the contract between the two languages, which nothing
else would notice breaking. What is left uncovered there is the network: the
Wiktionary fetch and the text-to-speech calls.

## Where things live

```
app/src/lib/      the domain: scheduling, the ladder, the day, storage, sync
app/src/routes/   the screens; they hold no rules, only what is on them
server/src/       the Worker: the sync API, the login flow, and the connector
server/src/mcp/   the MCP endpoint Claude speaks to; resolve.ts decides what a
                  word Claude offers already is, with the app's own rules
frcog/            the Python pipeline that builds the catalogue
tests/fixtures/catalogue/   one catalogue, exported by the pipeline, read by both
                            (including the dictionary shards the words screen
                            fetches a letter at a time)
```

Three tests read the tree rather than a module: `app/tests/rules.test.ts`
greps for the things a type cannot say (one `new Audio`, one `speechSynthesis`,
one `<kbd>`); `app/tests/contract.test.ts` drives the app's readers over the
pipeline's own export; `app/tests/studycard.test.ts` renders the card with
`svelte/server` for every rung both ways up. A rule that can be stated as a
grep or a table gets one of these rather than a paragraph in this file.

The server imports the app's pure rules — `check.ts`, `wordsearch.ts`,
`gender.ts`, `keys.ts`, `ladder.ts` — rather than copying them, so the
connector and the words screen make the same decision about the same word.
A module the server may import has no `$app` import and reaches no database;
moving a rule into one of those is how it becomes shared.

The pipeline is Python and stays Python — it is where the corpora and the
dictionaries are. Its contract with the app is the catalogue JSON, and that
shape is pinned from both sides: `tests/test_webexport.py` writes it,
`app/tests/e2e/serve.ts` serves it.

The one file that is not TypeScript by choice is `app/svelte.config.js`:
SvelteKit loads it before any of this exists. It carries `// @ts-check` and a
JSDoc type, so it is checked like everything else.

A rule that decides something about learning goes in `app/src/lib`, is pure
where it can be, and is tested there. A screen reads it. If a screen is making
a decision, that decision is in the wrong file.

## What the issues taught

Thirty-odd issues from the first days of use came down to five causes;
`MAINTENANCE.md` has the reading and the plan. The rules that fell out of it:

* **What a screen shows is computed once, as data, in `lib`.** The card's
  face, the words list's rows, the bar's title: a pure function of the record
  and the state, tested as a table over every state it can be in. Seven
  issues were the card showing less than it should because the template
  decided, branch by branch (#5, #28, #30).
* **One player.** Nothing outside `player.ts` constructs an `Audio` or talks
  to `speechSynthesis`. Three copies of "play it, or say it, or give up" each
  had their own idea of busy, which is how a cached sentence came to say
  "Making it…" while it played (#34).
* **A shortcut and its hint are one row.** `shortcuts.ts` is the only place
  a key is named; `Kbd.svelte` draws hints from it. A hint typed by hand next
  to a button said `s` while the cursor was in a box where `s` is a letter
  (#28, #35).
* **Store identities, resolve records when they are read.** A day's answers
  are card ids; the word behind each is looked up on every load, which is why
  a correction shows on the next card and not the next day (#6, #7, #22). The
  queue itself is not stored at all: it is derived, the same way every time,
  from the cards and the day's log (`plan.ts`), so a word added mid-sitting is
  the next card and a reload lands where it left off.
* **Nothing fails silently.** A recording that 404s, a voice that will not
  load, a sync that fails: a sentence on the screen, from the module that
  found out. The console is not a place the learner looks (#31).
* **Shared CSS is a primitive, not a paragraph.** `button`, `.chip`,
  `.panel`, `kbd` declared in six files with six sets of numbers is six
  places for a row to shift (#12, #20, #26).
* **A screen's state is a module once it is more than a couple of booleans.**
  A Svelte page cannot be unit tested; `sitting.ts` can.
* **One issue, one commit, with the test that names it.** A day of triage
  may close nine at once; a bug fixed later should be findable with
  `git log -S`.
* **Anything that fails writes it down.** `report(where, what)` in
  `diagnostics.ts`, from the module that found out; settings shows the notes
  and the bug button carries them. A `catch` that swallows is a report that
  will say "the button did nothing".

## Before you push

`npm run check` — lint, typecheck, tests. CI runs the same thing plus the
browser suite and the Python pipeline tests, on the merge result, and `main`
is protected: a red check cannot be merged, and nothing lands without a pull
request. That is what keeps a broken commit out of production.

The deploy itself is Cloudflare's Workers Builds, on every push to `main`. It
runs `npm run build`, which typechecks and tests the app again, and then
`npm run deploy`, which is `npm run migrate && wrangler deploy` — the D1
migrations before the Worker that reads them. Adding a table is therefore a
migration file under `server/migrations` and nothing else; never a
`d1 execute` by hand, which is how a deploy once went out ahead of its schema
and answered `no such table: themes` on the first sync. `server/README.md`
has the Workers Builds settings and the branch protection.
