# French Cognate Learning Pipeline

Learn French vocabulary in the order that costs you least: words that already
look like their English translation, weighted by how often they actually appear.
The database is the source of truth; the web app is a view over it.

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

Then open the app and study **Level 01**. Day to day:

```bash
frcog app        # export the catalogue and serve the app
frcog stats      # how much French you can read now
frcog import-app # merge reviews exported from the app back into the database
```

The app is a PWA under `app/`; `npm run dev` there serves it beside its sync
Worker. Progress lives in the browser and syncs between your devices once you
sign in; the database only sees it when you export.

## Two things this is built around

**Low barrier.** One command produces a deck you can study tonight. Every word
starts as a single card, French to English, which for a cognate is nearly free.
Nothing else is switched on until you have earned it.

**Visible progress.** The headline number is the share of running French text you
can read, computed from the frequency mass already stored per word. It moves
after every session, and it is honest: it counts a word only once the scheduler
calls it mature, and it counts inflections, so learning *être* credits *est* and
*sont* too. Levels are 100 words each, so the home screen shows finished levels
at a glance.

## How a word gets its place in the queue

```
wordfreq top 20k French
  -> kaikki.org Wiktionary extract   (English glosses, IPA, gender, audio)
  -> normalise                       (strip accents, articles, reflexive se)
  -> similarity                      (Levenshtein + Jaro-Winkler, suffix rules)
  -> rank = zipf x similarity x tech boost
  -> levels                          (core high-frequency words interleaved)
  -> SQLite -> audio, web app
```

`rank = zipf x similarity` alone produces a deck you cannot read a sentence
with, because *faire*, *voir* and *lire* score near zero on similarity. Each
level therefore reserves 15% of its slots for the most frequent words
regardless of how they score, and core words are rescued before the ranking is
truncated.

One card per spelling means choosing a part of speech where Wiktionary has
several — *vidéo* the adjective (*jeu vidéo*) or *la vidéo*. The frequency of
the inflected forms settles most pairs (*lire* the verb carries *lit*, *lisent*,
*lu*; the Italian lira carries only *lires*), with one correction the verb
tables supply: an adjective that is a verb's past participle (*fait*, *mort*,
*passé*) inflects exactly as the participle does, and those spellings are the
verb's, so they do not count for it. A remaining tie goes to the noun when the
Tatoeba corpus shows the word standing where nouns stand — a determiner before
it and no noun after it, so *la vidéo est* counts and *un petit garçon* does
not. That rule is scored on the words Wiktionary gives only one part of speech
and the build prints it: it calls 85% of noun-only words nouns and 97% of
adjective-only words not, which is why it is trusted in one direction only. A
low share is no evidence against a noun (*faire attention*), and the rank score
decides then.

Suffix correspondences are applied as rewrite rules in both directions, so
*rapidement*/*rapidly* and *qualité*/*quality* score as the near-identities they
are. Similarity is only ever computed between true translation pairs, so a false
friend like *actuellement* is never compared to *actually*.

## Two channels, each a ladder

A word gets one scheduled card per channel, and the card's exercise gets
harder as the word gets stronger. The ladder is climbed, not drilled in
parallel: five cards per word became two.

| Channel | Rungs, in order |
|---|---|
| Written | recognise it (FR → EN) → say it, then check → write it → use it in a sentence |
| Heard | listen for the meaning → write down what was said |

Where a word *enters* each ladder is decided by two scores the pipeline
computes, because for this deck they disagree: `looks` is the spelling
similarity that ranked the word, `sounds` is how much its French pronunciation
resembles the English one (from Wiktionary's IPA against the CMU Pronouncing
Dictionary — `phonetics.py`). *La nation* scores 1.0 and 0.33. A word that
reads as English skips the recognition rung, since that card would be passed at
100% on first sight; a word that sounds like English skips listening for
meaning and goes straight to dictation. 86% of the deck reads as English;
2,650 words read as English and sound nothing like it, and for those the heard
channel is the whole point of studying the word.

The top rung of the written channel is a real sentence with the word taken out
— *Tous ___ heureux.* — typed back in the form that stands there. The sentences
come from Tatoeba, one or two per word, found by the word as spelt (or a noun's
plain plural) and never invented; `frcog sentences` gathers them, and the rung
opens only for the 4,715 words that have one. It is the only exercise in the
deck where the word is met in language rather than on its own.

A word moves up when its rung is **mature** — FSRS's own estimate that recall
over three weeks is comfortably above the 85% band where practice pays. A
promotion is a fresh card on the next rung, due now, because the next rung tests
a different memory with an unknown share carried over, and a new card's first
rating is exactly the measurement of that share. The old rung retires and keeps
its history. There is no demotion rule: an Again on the new card is ordinary
relearning. The heard channel opens the first time the word is said and known.

## Walking mode

The same session with the keyboard taken away. Open `Study` with `?walk=1`
(the Walk button on the home screen) and only the rungs you can answer by
speaking and tapping are served, the English cue is read aloud, and the targets
are larger. When little is due, mature words are added to keep the walk useful.

Nothing listens to you. A speech recogniser is biased toward real words and
quietly corrects a mispronounced one, and it drops the article — which is the
gender, which is what the card is there to teach — so it could only ever grade
the part of the word that was not the point. If the word came out wrong, there
is a flag for that beside the grade; it is recorded but never changes the
schedule, because knowing a word and pronouncing it are two different memories.

## Two coverage numbers

**Can read** is the headline: the share of running French text you would
understand. A word that reads as English counts from its first answered review
— never from mere introduction, so piling up new cards moves nothing — and a
word that does not counts only when its written card is mature. **Can use** is
what the ladder is for: the written card mature at *write it* or above. It lags,
as it should.

## When the day is done

The Today page shows two bars, and the day is finished when both are full: the
cards that were due, capped at the number of reviews you said you were happy to
do, and the new words there was room for. Neither is a clock and neither is a
quota you chose — both are computed from what the material needs today. That is
deliberate: a time target charges you for getting faster, and a review count
can only be reached on a light day by borrowing tomorrow's new words. The
contract pays you for improving in the right direction instead: better recall
means fewer cards due, which means more room for new ones.

## Commands

| Command | Does |
|---|---|
| `frcog fetch` | download the 578 MB Wiktionary extract and the Tatoeba sentence exports |
| `frcog build` | build the ranking into SQLite, then the verb tables and their examples |
| `frcog sentences` | redo just the verb tables and example sentences, without re-ranking |
| `frcog audio` | Swiss TTS prompts, native recordings, and Kokoro English cues for the walk |
| `frcog stats` | progress summary |
| `frcog top -n 40` | print the head of the ranking |
| `frcog app` | export JSON and serve the app |
| `frcog import-app` | merge web-app reviews back |
| `frcog all` | everything, from nothing to a deck |

## Re-running is safe

`frcog build` upserts. Words that drop out of a new ranking are marked inactive
and keep their history; audio files, per-direction scheduling and the review log
are never deleted. Progress in the app is keyed on (lemma, part of speech),
never on a row id, so a rebuilt catalogue cannot detach a word from its history.

## Swiss French

Corpora are dominated by France French, so *natel* and *septante* fall far below
any frequency cut. A short list of Helvetisms is force-included by headword;
their glosses, gender, IPA and audio still come from Wiktionary, so nothing is
hand-written dictionary content.

For a word tagged Swiss, the Swiss sense is promoted to the front of the card.
Wiktionary orders by the France French meaning, which would teach *linge* as
"linen" when in Valais it is a towel, and *cornet* as "cone" when it is a
carrier bag. Cards carrying a Swiss meaning are flagged in the app.

## Articles, and the h that is not silent

Every noun is taught with its definite article, one convention throughout:
*le train*, *la source*, *l'eau*. That needs one fact per word that neither the
spelling nor a transcription can supply. *Héros* and *hôpital* are the same
shape and the same first phoneme, and one takes *le* while the other takes *l'*,
because h aspiré is not a sound but a memory of one. Guessing it from the
letters is what produced *le/la enfant* and *le œil* in an earlier deck.

So `elision.py` decides it from sources, in this order, and never from a rule of
thumb: the first phoneme of the IPA the entry already carries; English
Wiktionary's *aspirated h* / *mute h* categories, which are in the extract
already on disk and also cover *onze*, *huit* and *yaourt*; French Wiktionary's
equivalent categories over the API, cached; and, last, how the Tatoeba corpus
actually writes the word, counting *l'X* and *cet X* against *le X* and *ce X*
among the determiners that alternate — *cette* is evidence of nothing, since it
is the feminine form either way.

The corpus rule is the only inference in that chain, so the build scores it
against the words the two dictionaries settle and prints the result:

```
elision:  corpus agrees with the dictionaries on 87/87
```

A word no source can settle is dropped from the deck rather than guessed at,
and named in the build log; there are 18, all of them h-, w- or y-initial.
Nothing downstream re-derives the answer: one `article()` function composes the
card, the typed answer and the spoken clip, and it raises rather
than invent an article for a word whose elision is unknown.

Words that sound vowel-initial and still refuse to elide are flagged `aspire`
in the exported catalogue. That is the property worth teaching: it also governs
*ce héros* against *cet homme*, *un beau héros* against *un bel homme*, *ma
haine* against *mon amie*, and the missing liaison in *les héros*.

## Verb tables and their examples

A verb's forms are read off Wiktionary, never generated: the extract lists
every cell of every tense, and `conjugation.py` only sorts them into tables
and marks what a learner should notice (the shared stem, the cell that departs
from it, two cells spelt alike). Checked against Verbiste's independent tables
(`scripts/verbiste_check.py`) for the 613 catalogue verbs it knows, the two
agree on 99.6% of cells. The rest are the 1990 spelling reform (*protègerai*
beside *protégerai*, both kept), imperative variants Wiktionary lists and
Verbiste does not (*veux* beside *veuille*), tenses Verbiste lacks for
*foutre*, and one cell that looks like a Wiktionary slip (*vaus* for *valoir*).

Each tense then gets up to three sentences from Tatoeba, with their English,
so the table says what the tense is for and not only how it is spelt. Nothing
is written by hand: a sentence is used because it contains the verb form. The
catch is that French spells tenses alike (*mange* is présent, subjonctif and
impératif; *paie* is also a paycheque), so a spelling that Wiktionary lists
for any other word or tense is accepted only in a context that settles it,
and the build measures those context rules on the forms that need none:

```
sentences:  'pronoun + form' accepts 11547/33943 occurrences of its own tenses and 42/2282 of other tenses'
sentences:  'trigger + que + pronoun + form' accepts 214/1881 occurrences of its own tenses and 0/34344 of other tenses'
sentences:  'form first' accepts 367/401 occurrences of its own tenses and 93/35824 of other tenses'
```

The words that govern the subjonctif (*faut*, *veux*, *avant*, *bien*, …) are
learned from the corpus in the same run, on half the verbs, and scored on the
other half. An example found by context is marked as such all the way to the
screen, and a tense the corpus cannot settle says so instead of guessing.

## Audio

Every card gets a Swiss French TTS recording (`fr-CH-ArianeNeural`) of the exact
phrase you have to type, article included, so the listening prompt and the
expected answer never disagree. That covers 100% of the deck. Each clip records
the text it was made from, so a rebuild that changes what a card teaches
regenerates the clip instead of leaving it saying the old thing.

Where Wiktionary has a native human recording it is attached to the back as a
pronunciation reference, preferring Switzerland, then France; Quebec recordings
are never used. Wikimedia rate-limits hard, answering a burst of about five
requests with HTTP 429, so this pass is deliberately slow and fully resumable.
Run `frcog audio --native-only` whenever you like and it picks up where it
stopped. Nothing depends on it.

The walk's English cue ("to have", then you say *avoir*) is synthesised once
per word with [Kokoro](https://github.com/hexgrad/kokoro), which sounds like a
person where the browser's own voices sound like a satnav. Kokoro needs torch,
so it is an optional extra: `pip install -e '.[english]'`, then `frcog audio
--english-only`. Without it the app falls back to the browser voice.

Words you add in the app yourself are not in that build, so the app makes their
audio on the device with
[Supertonic 3](https://github.com/supertone-inc/supertonic), a 99M-parameter
model with French among its 31 languages, run through ONNX Runtime on WebGPU
where the phone has it and WebAssembly where it does not. Its weights are a
one-time 380 MB download, unquantised. Each clip records how long it took to
make, and the words screen reports the median per word and how that compares to
the length of the speech it produced.

Kokoro-82M held that job first and the two ran side by side for a while, which
is how the choice was settled: its one French voice, trained on under eleven
hours of speech, was the weaker of the two to listen to and about twice as slow
to run. Only the pipeline's English cues are still Kokoro's, made once on a
machine with torch rather than on the phone.

## Known limits

- Wiktionary glosses are uneven. A minor sense is discounted by position, which
  keeps false friends like *rester* / "to rest" out of the easy end of the deck,
  but the gloss text itself is sometimes terse or oddly capitalised.
- Two parts of speech that share a spelling are separated by the frequency of
  their inflected forms. That is a good signal, not a perfect one.
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
  conjugation.py verb tables, sorted from what Wiktionary lists
  sentences.py  Tatoeba examples for every tense, with the context rules and their score
  elision.py    "le héros" or "l'héros", decided from sources only
  stoplist.py   grammatical words to leave out
  build.py      ranking and levels
  audio.py      TTS and native recordings
  english.py    Kokoro English cues for the walk
  stats.py      progress summary and coverage
  webexport.py  JSON for the app
  cli.py
app/            the study PWA and its sync Worker
tests/          pytest + node
data/           database, media, build output (not in git)
```
