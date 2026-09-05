# French Cognate Learning Pipeline

Learn French vocabulary in the order that costs you least: words that already
look like their English translation, weighted by how often they actually appear.
The database is the source of truth; the Anki deck and the walking-mode web app
are views over it.

Built for an English speaker living in Valais, so the audio prefers Swiss French
and Helvetisms like *natel* and *septante* are flagged on the card.

## Install

```bash
python3 -m venv .venv
.venv/bin/pip install -e .
```

That puts a `frcog` command inside the virtualenv. To call it as plain `frcog`
from anywhere, link it onto your PATH once:

```bash
ln -sf "$PWD/.venv/bin/frcog" ~/.local/bin/frcog
```

Without that link, use `.venv/bin/frcog ...`, or `source .venv/bin/activate`
first. Every path the tool touches is resolved relative to the package, so it
does not matter which directory you run it from.

## Quick start

```bash
frcog all          # fetch, build, audio, export  (~25 min, mostly TTS)
```

Then import a deck into Anki and study **Level 01**:

- `data/build/french-cognates-starter.apkg` — 500 words, 7.6 MB. Start here.
- `data/build/french-cognates.apkg` — the whole thing, ~5,200 words, 67 MB.

Both share note ids, so importing the full deck later adds to the starter deck
rather than duplicating it. Build any slice with `frcog anki --max-level N`.

Day to day:

```bash
frcog stats     # how much French you can read now
frcog sync      # pull Anki progress back, unlock new directions
frcog anki      # re-export; existing cards keep their history
frcog app       # serve the walking-mode app on :8000
```

## Two things this is built around

**Low barrier.** One command produces a deck you can study tonight. Every word
starts as a single card, French to English, which for a cognate is nearly free.
Nothing else is switched on until you have earned it.

**Visible progress.** The headline number is the share of running French text you
can read, computed from the frequency mass already stored per word. It moves
after every session, and it is honest: it counts a word only once Anki calls it
mature, and it counts inflections, so learning *être* credits *est* and *sont* too.
Levels are Anki subdecks of 100 words, so the deck screen shows finished levels
at a glance.

## How a word gets its place in the queue

```
wordfreq top 20k French
  -> kaikki.org Wiktionary extract   (English glosses, IPA, gender, audio)
  -> normalise                       (strip accents, articles, reflexive se)
  -> similarity                      (Levenshtein + Jaro-Winkler, suffix rules)
  -> rank = zipf x similarity x tech boost
  -> levels                          (core high-frequency words interleaved)
  -> SQLite -> Anki deck, audio, web app
```

`rank = zipf x similarity` alone produces a deck you cannot read a sentence
with, because *faire*, *voir* and *lire* score near zero on similarity. Each
level therefore reserves 15% of its slots for the most frequent words
regardless of how they score, and core words are rescued before the ranking is
truncated.

Suffix correspondences are applied as rewrite rules in both directions, so
*rapidement*/*rapidly* and *qualité*/*quality* score as the near-identities they
are. Similarity is only ever computed between true translation pairs, so a false
friend like *actuellement* is never compared to *actually*.

## The five directions

| Direction | Where | Unlocks after |
|---|---|---|
| Read FR to EN | Anki, app | always open |
| Recall EN to FR (typed) | Anki, app | reading is mature |
| Listen and write FR | Anki, app | recall is mature |
| Listen for meaning | Anki, app | reading is mature |
| Speak while walking | app only | always open |

Each direction is a separate card, scheduled separately. Cognates make reading
almost free while listening stays hard, and one shared ease per word would hide
that.

Anki generates a card only when its front template renders something, so the
later directions are gated behind fields that `frcog sync` fills in once the
prerequisite matures. Re-export and the new cards appear.

## Walking mode

Open the app on a phone with earbuds. It speaks an English word, listens for
your French, and answers out loud. Chrome, Edge, or Chrome on Android; Safari
has no speech recognition.

Speech-to-text is biased toward real words and quietly corrects a mispronounced
one, so this checks *what you said*, not *how you said it*. It reads every
alternative the recogniser offers and accepts a close match. Treat it as recall
practice with a pronunciation model attached, not as a pronunciation score.

Progress made in the app lives in the browser. Press **Export** and run
`python -m frcog import-app <file>` to merge it back into the database.

## Commands

| Command | Does |
|---|---|
| `frcog fetch` | download the 578 MB Wiktionary extract |
| `frcog build` | build the ranking into SQLite |
| `frcog audio` | Swiss TTS prompts, plus native recordings |
| `frcog anki` | write the `.apkg` (`--max-level N` for a smaller deck, `--no-native`) |
| `frcog sync` | read Anki progress, unlock directions |
| `frcog stats` | progress summary |
| `frcog top -n 40` | print the head of the ranking |
| `frcog app` | export JSON and serve the app |
| `frcog import-app` | merge web-app reviews back |
| `frcog all` | everything, from nothing to a deck |

## Re-running is safe

`frcog build` upserts. Words that drop out of a new ranking are marked inactive
and keep their history; audio files, per-direction scheduling and the review log
are never deleted. Anki note GUIDs are derived from (lemma, part of speech) and
the note type id is a constant, so re-importing updates the existing notes and
your reviews survive.

## Swiss French

Corpora are dominated by France French, so *natel* and *septante* fall far below
any frequency cut. A short list of Helvetisms is force-included by headword;
their glosses, gender, IPA and audio still come from Wiktionary, so nothing is
hand-written dictionary content.

For a word tagged Swiss, the Swiss sense is promoted to the front of the card.
Wiktionary orders by the France French meaning, which would teach *linge* as
"linen" when in Valais it is a towel, and *cornet* as "cone" when it is a
carrier bag. Cards carrying a Swiss meaning are tagged `swiss` in Anki.

## Audio

Every card gets a Swiss French TTS recording (`fr-CH-ArianeNeural`) of the exact
phrase you have to type, article included, so the listening prompt and the
expected answer never disagree. That covers 100% of the deck.

Where Wiktionary has a native human recording it is attached to the back as a
pronunciation reference, preferring Switzerland, then France; Quebec recordings
are never used. Wikimedia rate-limits hard, answering a burst of about five
requests with HTTP 429, so this pass is deliberately slow and fully resumable.
Run `frcog audio --native-only` whenever you like and it picks up where it
stopped. Nothing depends on it.

## Known limits

- Wiktionary glosses are uneven. A minor sense is discounted by position, which
  keeps false friends like *rester* / "to rest" out of the easy end of the deck,
  but the gloss text itself is sometimes terse or oddly capitalised.
- Two parts of speech that share a spelling are separated by the frequency of
  their inflected forms. That is a good signal, not a perfect one.
- The web app schedules with SM-2, not FSRS. Anki runs real FSRS for the
  directions it owns; the app exists for the one Anki cannot do.
- Grammatical words are deliberately excluded. You will not find *le*, *pas* or
  *dans* here. They are learned from sentences, and their Wiktionary lemma entry
  is usually a rare homograph noun.

## Layout

```
frcog/          pipeline package
  config.py     every tunable
  normalize.py  accent, article and gloss normalisation
  similarity.py cognate scoring with suffix rules
  freq.py       wordfreq access and inflection roll-up
  kaikki.py     Wiktionary extract reader
  stoplist.py   grammatical words to leave out
  build.py      ranking and levels
  audio.py      TTS and native recordings
  anki_export.py
  stats.py      Anki sync, unlocks, coverage
  webexport.py  JSON for the app
  cli.py
app/            walking-mode PWA
tests/          pytest + node
data/           database, media, build output (not in git)
```
