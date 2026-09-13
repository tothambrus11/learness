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

### 2. One player  *(1 session; closes #34)*

`lib/player.ts`: a state machine — `idle | fetching | making | playing`, plus
`trouble` — over a *source list*: `[{ file }, { clip }, { say, lang }]`, tried
in order, the first that sounds wins. The stamp that ties a sound to the card
that asked for it lives inside. `making` is entered only when the voice queue
reports the clip is not on the device, which is #34. Study screen,
`Conjugation.svelte`, the words screen and the walk all play through it;
`grep -rn "new Audio"` outside it is a lint failure. Tested with a fake
`Audio` and a fake `say`: fallback order, stamps, the busy flag, the
sentence on screen when nothing sounds.

### 3. The card as data  *(1 session)*

`cardface.ts` grows `face(item, revealed): Face` — prompt, hint, answer
lines, IPA, alternatives, whether there is a box, what the box asks. The
template becomes one shape rendered from it. The test is a table over
`rungs × revealed` asserting the invariants that were each once a bug: every
turned card shows the French, its IPA and the English; no card shows the
gender before the French is revealed; a heard card has a way to replay
before the flip; a typed card has a box before and a verdict after. Then
`StudyCard` is rendered with `svelte/server` in vitest for each rung, so a
template branch that drops something fails a unit test, not a person.

### 4. The sitting as a state machine  *(1–2 sessions)*

Out of `study/+page.svelte` into `lib/sitting.svelte.ts` (or a pure reducer
in `lib/sitting.ts`): the queue, the position, reveal, grade, the again
requeue, history and looking back, the tally, resume. The screen keeps the
DOM, the focus and the wiring. Tests drive it against the real database
through `tests/harness.ts`: grade twice quickly and one review is written;
look back and nothing changes; Again puts the card at the end; a reload comes
back to the same card with the same history. The page should end up under
250 lines.

### 5. UI primitives and layout guards  *(1 session)*

`lib/components/ui.css` (or `Panel`, `Chip`, `Button` components): one
declaration of each. Delete the copies. A browser test that walks every
route at 400px and 1100px and asserts: nothing wider than the viewport, the
bar's children vertically centred, no native-coloured control. Cheap, and it
is the whole of cluster 5.

### 6. The words screen  *(1 session)*

`words/+page.svelte` is 480 lines with its own resolver cache (`shown`),
three forms and a search. Split the row into `WordRow.svelte`, the forms into
`WordForm.svelte`, and the "as the card sees it" resolution into
`lib/wordsview.ts` where it can be tested — #22 was exactly this map going
stale.

### 7. Storage and sync  *(1 session)*

A migration test: open a database written at version 1 (a fixture of real
rows), let it upgrade to the current version, assert every card landed on a
rung and nothing was lost. Property tests for `merge.ts`: a pull applied
twice is a pull applied once; push then pull round-trips. A recorded-fetch
test of `sync.ts` against a fake Worker, since today only the merge is
tested and the wire is not.

### 8. The contract with the pipeline  *(half a session)*

`test_webexport.py` pins the catalogue from the Python side and
`tests/e2e/serve.ts` serves a fixture from the TypeScript side, but nothing
checks the two fixtures against each other. Write the fixture once, in JSON,
checked into `tests/fixtures/catalogue/`, read by both. A drift then fails
both suites with the same file in the message.

### 9. Diagnostics on the screen  *(1 session)*

Issue #31 took a console to diagnose, and the learner had no console. A
`lib/diagnostics.ts` that keeps the last few things that went wrong —
a 404, a voice that would not load, a sync that failed — and a settings
section that shows them. The bug button in the bar pre-fills the issue with
them. Every "nothing happened" report after this comes with its cause.

### 10. Docs, dead code, dependencies  *(half a session)*

`DESIGN.md` gets a third "what the app learned" round; this file's
checklist is closed out or carried forward; `oxlint` rules that were turned
off for convenience are tried on again; the two `tsconfig`s are compared.

## Checklist

- [x] 1. Shortcuts as a table (`shortcuts.ts`, `Kbd.svelte`) — closes #35
- [ ] 2. One player (`player.ts`) — closes #34
- [ ] 3. The card as data (`face()`, server-rendered card tests)
- [ ] 4. The sitting as a state machine (`sitting.ts`)
- [ ] 5. UI primitives and layout guards
- [ ] 6. The words screen
- [ ] 7. Storage and sync tests
- [ ] 8. One catalogue fixture for both languages
- [ ] 9. Diagnostics on the screen
- [ ] 10. Docs, dead code, dependencies
