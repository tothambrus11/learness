# Keeping Learness maintainable

*Written 2026-09-13, after reading every issue filed so far (#1–#35) and the
five pull requests that closed them. This is the plan for the maintenance
work that follows, spread over about ten sessions. Each session updates the
checklist at the bottom; the reasoning above it is meant to outlive the
checklist.*

`README.md` is what the thing is, `DESIGN.md` is why the learning model is
what it is, `CLAUDE.md` is how the code is written. This file is what the
bugs taught about the code, and what is being done about it.

## What the issues were about

Thirty-three issues in three days of use, most of them from a phone. Read
together they are not thirty-three problems; they are five, and the same five
came back in different clothes.

### 1. The card showed less than it should — 7 issues

#5, #7, #16, #22, #27, #28, #30. The English was missing; a correction did
not reach the card; the previous card lost its verb table; a listening card
had no way to hear its own answer.

Every one of these was *what is on the card* being decided somewhere that
could not see the whole card: inside the study screen's template, inside the
branch that draws the grading buttons, in a resolver that looked the word up
in the catalogue and stopped. The fix so far — `StudyCard.svelte` and
`cardface.ts` — moved the card out of the sitting. But `StudyCard` is still a
six-way branch on the rung, and each branch decides for itself what to print.
Nothing checks that every revealed back shows the French, the IPA and the
English; the day #28 was filed, dictation showed the spelling and not the
meaning, and only a person noticed.

### 2. Audio did the wrong thing, or nothing, quietly — 8 issues

#9, #14, #21, #25, #28, #29, #31, #34. The sentence was read by the wrong
voice; the French did not play after a flip; the sound button did nothing and
said nothing (the file was a 404 dressed as a 200); "Making it…" shows while
a cached sentence plays (#34, open).

There are three copies of "play this, or say it, or give up" — in the study
screen (`play`, `playModel`, `playSrc`, stamps, `speaking`, `trouble`), in
`Conjugation.svelte` (its own `seq`, `sounding`, `saying`) and in the words
screen (`new Audio(src).play()`, errors dropped). Each has its own idea of
what "busy" means, which is why #34 exists: `speaking` is set before anyone
has looked whether the clip is on the device. The state of the sound is not
written down anywhere as a state.

### 3. A shortcut and its hint disagreed — 3 issues

#14, #28, #35. The listening card had no visible way to replay; the speaker
said `s` while the cursor sat in a box where `s` is a letter; there was no
way to reach the letters while typing (#35, open).

The handler was an `if` chain, and every `<kbd>` was typed by hand next to
the button it stood for. Two lists of the same facts, kept by hand, drifted.

### 4. The wrong record, or the wrong unit, silently — 3 issues

#6, #7, #23. A reload dealt a different card; a stored copy of the word was
stale; a week of reviews was asked for in milliseconds against an index of
seconds.

These are fixed at the type level (`units.ts`, `keys.ts`) and by the rule
"write down ids, look up records". They are here because the rules deserve a
line in `CLAUDE.md`, which they now have.

### 5. Layout drift — 6 issues

#12, #13, #17, #19, #20, #26. Buttons off-centre, native controls in the
wrong colour, a title that changed, a row that shifted when tapped.

`button`, `.chip`, `.panel`, `kbd`, `.muted`, `.small` are each declared in
four to six components with slightly different numbers. There is one browser
test for one of these bugs. Nothing else would notice a regression.

### What the process says

* The fixes were good and the tests written with them are exactly the tests
  that would have caught each bug. The gap was never the fix; it was that
  each fix touched a screen that owns too much. `study/+page.svelte` is 600
  lines and owns the queue, the clock, the sound, the grading, the keyboard
  and the history. It is the file most issues touched, and the file with the
  fewest tests, because a Svelte page cannot be unit tested.
* Every pull request closed between three and nine issues in one go, with
  the refactor in the same diff. That was right for a day of triage. It is
  not how the next bug should be fixed: one issue, one commit, with the test
  that names it, so that `git log -S` on a screen finds the reason.
* Four of the five clusters would have been caught by a test below the
  browser: a pure "face of the card" function, a player state machine, a
  shortcut table, a CSS primitive. The browser suite is the right last line
  and the wrong first one — it is slow, and it needs a Chromium the deploy
  builder does not have.

## The rules that come out of it

Added to `CLAUDE.md` under *What the issues taught*. In short:

1. What a screen shows is computed once, as data, in `lib`, and tested as a
   table over every state it can be in.
2. One player. Nothing outside `player.ts` constructs an `Audio` or calls
   `speechSynthesis`.
3. A shortcut and its hint are one row of one table.
4. Store identities; resolve records when they are read.
5. Nothing fails silently. A missing file, voice or clip is a sentence on
   the screen, and the module that found it out is the module that says so.
6. Shared CSS is a primitive, not a paragraph copied between components.
7. A screen's state with more than a couple of booleans is a module of its
   own, in `lib`, with tests.
8. One issue, one commit, one test.

## The work, in order

Ordered by how many issues each item would have prevented, then by how much
it unblocks the rest. Each is one session or less; the estimate is in
brackets.

### 1. Shortcuts as a table  — done, this session  *(closes #35)*

`lib/shortcuts.ts`: one table of `{ id, key, when }`; `resolve(press, ctx)`
reads a keypress against it, `hint(id, ctx)` reads the same row back as the
keys to draw. Inside the answer box every letter needs Alt and the hint says
so. `Kbd.svelte` draws hints from the table and nowhere else. The round-trip
test presses every hint in every card state and checks it lands.

### 2. One player  — done  *(closes #34)*

`lib/player.ts`: a state machine — `idle | fetching | making | playing`, plus
`trouble` — over a *source list*: `[{ file }, { clip }, { say, lang }]`, tried
in order, the first that sounds wins. The stamp that ties a sound to the card
that asked for it lives inside. `making` is entered only when the voice queue
reports the clip is not on the device, which is #34. Study screen,
`Conjugation.svelte` and the words screen all play through it;
`grep -rn "new Audio"` outside it is a lint failure. Tested with a fake
`Audio` and a fake `say`: fallback order, stamps, the busy flag, the
sentence on screen when nothing sounds.

### 3. The card as data  — done

`cardface.ts` grows `face(item, revealed): Face` — prompt, hint, answer
lines, IPA, alternatives, whether there is a box, what the box asks. The
template becomes one shape rendered from it. The test is a table over
`rungs × revealed` asserting the invariants that were each once a bug: every
turned card shows the French, its IPA and the English; no card shows the
gender before the French is revealed; a heard card has a way to replay
before the flip; a typed card has a box before and a verdict after. Then
`StudyCard` is rendered with `svelte/server` in vitest for each rung, so a
template branch that drops something fails a unit test, not a person.

### 4. The sitting as a state machine  — done

Out of `study/+page.svelte` into `lib/sitting.svelte.ts` (or a pure reducer
in `lib/sitting.ts`): the queue, the position, reveal, grade, the again
requeue, history and looking back, the tally, resume. The screen keeps the
DOM, the focus and the wiring. (Done as `lib/sitting.svelte.ts`, a class
with rune state; the page went from 616 lines to 450, the rest being the
sound wiring, the template and the CSS that item 5 takes.) Tests drive it against the real database
through `tests/harness.ts`: grade twice quickly and one review is written;
look back and nothing changes; Again puts the card at the end; a reload comes
back to the same card with the same history. The page should end up under
250 lines.

### 5. UI primitives and layout guards  — done

`lib/components/ui.css` (or `Panel`, `Chip`, `Button` components): one
declaration of each. Delete the copies. A browser test that walks every
route at 400px and 1100px and asserts: nothing wider than the viewport, the
bar's children vertically centred, no native-coloured control. Cheap, and it
is the whole of cluster 5.

### 6. The words screen  — done

`words/+page.svelte` is 480 lines with its own resolver cache (`shown`),
three forms and a search. Split the row into `WordRow.svelte`, the forms into
`WordForm.svelte`, and the "as the card sees it" resolution into
`lib/wordsview.ts` where it can be tested — #22 was exactly this map going
stale.

### 7. Storage and sync  — done

A migration test: open a database written at version 1 (a fixture of real
rows), let it upgrade to the current version, assert every card landed on a
rung and nothing was lost. Property tests for `merge.ts`: a pull applied
twice is a pull applied once; push then pull round-trips. (Done:
`tests/migration.test.ts` opens databases written at versions 1 and 3; the
merge gets the two-device commutation test. The wire turned out to be
covered already — `tests/sync.test.ts` drives `sync()` against a fake
fetch — so nothing was added there.)

### 8. The contract with the pipeline  — done

`test_webexport.py` pins the catalogue from the Python side and
`tests/e2e/serve.ts` serves a fixture from the TypeScript side, but nothing
checks the two fixtures against each other. Write the fixture once, in JSON,
checked into `tests/fixtures/catalogue/`, read by both. A drift then fails
both suites with the same file in the message.

### 9. Diagnostics on the screen  — done

Issue #31 took a console to diagnose, and the learner had no console. A
`lib/diagnostics.ts` that keeps the last few things that went wrong —
a 404, a voice that would not load, a sync that failed — and a settings
section that shows them. The bug button in the bar pre-fills the issue with
them. Every "nothing happened" report after this comes with its cause.

### 10. Docs, dead code, dependencies  — done

`DESIGN.md` gets a third "what the app learned" round; this file's
checklist is closed out or carried forward; `oxlint` rules that were turned
off for convenience are tried on again; the two `tsconfig`s are compared.

## Checklist

- [x] 1. Shortcuts as a table (`shortcuts.ts`, `Kbd.svelte`) — closes #35
- [x] 2. One player (`player.ts`) — closes #34
- [x] 3. The card as data (`face()`, server-rendered card tests)
- [x] 4. The sitting as a state machine (`sitting.svelte.ts`)
- [x] 5. UI primitives and layout guards (`lib/ui.css`, the two-width walk)
- [x] 6. The words screen (`wordsview.ts`, `WordRow`, `WordForm`)
- [x] 7. Storage and sync tests (`migration.test.ts`)
- [x] 8. One catalogue fixture for both languages (`tests/fixtures/catalogue/`)
- [x] 9. Diagnostics on the screen (`diagnostics.ts`, the bug button pre-fills)
- [x] 10. Docs, dead code, dependencies

## Where things stand

*Closed out 2026-09-13, the same day, in nine commits — the sessions ran
back to back.*

| | before | after |
|---|---|---|
| app unit tests | 257 | 318, in 39 files |
| browser tests | 7 | 9, one of them a walk over every screen at two widths |
| pipeline tests | 226 | 227, one comparing the export to the checked-in catalogue |
| `study/+page.svelte` | 616 lines | 440, with the sitting, the sound and the keys out of it |
| `words/+page.svelte` | 484 lines | 330, with the row, the form and the resolver out of it |
| `new Audio` in the tree | 3 | 1, and a test that keeps it so |
| open issues | 2 (#34, #35) | 0 |

Both open issues closed through the abstractions rather than beside them:
#35 is the shortcut table and #34 is the player's `making` state, and each
would have been a one-line patch in the old screen that left the next one
to be found by a person.

## For the next round

Things looked at and left, in the order they are worth picking up.

* **The open sitting.** `queue.ts` no longer stores a queue; `plan.ts`
  derives it — the likeliest forgotten first, one new card every few, your
  own words never cut, returns placed by pace, the day in minutes — and
  `tests/plan.test.ts` is the table. `sessionLimit` is the cap on one open;
  `targetReviews` is out of the rules and kept only as a field for an old
  row to land in. What is not yet measured is the pace *by kind of card*: a
  "use it" answer takes twice a "say it", and one median covers both.
* **Dependencies with a major behind them.** TypeScript 7, `@sveltejs/vite-
  plugin-svelte` 7, `@cloudflare/workers-types` 5, `@types/node` 26 and
  `onnxruntime-web` 1.29. None was taken on this round: each is a
  toolchain step that wants a session of its own with the browser suite
  run after it, and the voice's runtime in particular has a pinned dev
  build for a reason that should be rediscovered before it moves.
* **The assertion lint rule.** `typescript/no-unsafe-type-assertion` stays
  off; what it would flag is mostly the named trust points. If a run of it
  ever shows a cast outside `units.ts`, `keys.ts` and a `trust*` or `field`
  helper, that cast is the bug.
* **The two big screens.** `study/+page.svelte` is 440 lines and
  `settings/+page.svelte` 427. The study screen's remainder is the sound
  wiring and the template; if the sound wiring grows again, it is a
  `sounds.svelte.ts` beside `sitting.svelte.ts`. Settings is long because it
  is a list, and a list is allowed to be long.
* **`Conjugation.svelte`** still holds its own hover timer and "saying"
  state beside the player; fine at 260 lines, worth a look if a third
  voice-driven component appears.
