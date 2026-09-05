# French Cognate Learning Pipeline — Design Notes

*Written 2026-08-05. Revised 2026-09-04, when the pipeline and app were built.*

## Goal

Learn French vocabulary and pronunciation efficiently by mining **cognates**:
rank French words by `similarity(FR, EN) × frequency`, so the easiest
high-value words come first. User is an English speaker living in **Valais,
Switzerland**, in a CS/tech environment.

Two goals sit above the ranking and decide most of the trade-offs below:

- **Low barrier to entry.** One command must produce a deck that can be studied
  the same evening. Anything that can be a later pass over an existing deck is a
  later pass.
- **Progress must be felt.** A number that moves after every session, and a deck
  that visibly fills up, not just a growing pile of due cards.

## Instructions / decisions (user)

- Start from **French** frequency lists (top ~20k), not "all English words".
- **Keep English loanwords** (*le bug, le commit*): the point is their French
  pronunciation, gender/articles and governed prepositions.
- **Strip articles and prepositions from similarity comparison**, but keep them
  on the cards. Also strip reflexive *se/s'*.
- Suffix-correspondence rules, both directions, best variant wins, optionally
  gated on the English side actually ending with the target suffix.
- Frequency weighting: log-scale (Zipf); boost for tech/professional register.
- **Multi-directional study** with **auto-checking**, not just EN→FR writing.
- Therefore a **database**, not just a deck.
- Must work in different life scenarios, notably **walking mode**: hands-free,
  hear English, say it in French, get a spoken correction. It is a practice mode
  over words already met, open from the first session rather than gated.
- **Anki export is required**, not optional.

## Architecture

**SQLite is the source of truth**; the Anki deck, the audio files and the web
app are views over it.

Tables: `words`, `translations`, `audio`, `card_state`, `reviews`, `meta`.
`card_state` and `reviews` are keyed by **(word, direction)**.

### Pipeline

```
wordfreq/Lexique top-20k FR
  → kaikki.org Wiktionary extract (glosses + IPA + gender/POS + audio refs)
  → normalise (NFD, strip diacritics, strip articles/prepositions/se)
  → rapidfuzz similarity, best over suffix-rule variants
  → rank = zipf × similarity × tech boost
  → levels, with core high-frequency words interleaved
  → audio (Swiss TTS + Lingua Libre/Commons human recordings)
  → SQLite → Anki .apkg, app JSON
```

## Key design points

- **False friends mostly filter themselves out**: similarity is only computed
  between true translation pairs, so *actuellement* is never compared to
  *actually*. This holds only as far as the dictionary is clean, and Wiktionary
  is not perfectly clean — see "sense position" below.
- **Per-direction scheduling** is required, not optional: cognates make reading
  nearly free while listening stays hard, and a shared per-word ease would mask
  listening weakness. Anki gets one card template per direction.
- **IPA on every card.** French spelling hides nasal vowels and silent letters,
  and cognates are exactly where the eye misleads.
- **Audio**: one clear primary recording per card, plus a native human recording
  as reference. Region preference CH > FR, never Quebec.
- **Swiss French**: Helvetisms are force-included by headword and their Swiss
  sense is promoted to the front of the card. The regional signal comes from
  Wiktionary's **sense tags**, not its categories: the tags are more reliable and
  more specific, tagging *huitante* as Fribourg and Valais where the categories
  never mention Switzerland at all. Matching on categories instead had flagged
  *vie*, *service* and *action* as Helvetisms, because each has one Swiss sense
  somewhere down the list.

## What changed once it was built

The original plan survived contact with the data, with seven changes. Each came
out of printing the top of the ranking and reading it.

1. **Grammatical words are excluded.** Ranking put *le*, *la*, *pas*, *si* and
   *nous* in the first level, because Wiktionary's lemma entry for a function
   word is usually a rare homograph noun: *la* became the musical note A and
   *pas* became "the pass", both with a perfect similarity score. They are
   learned from sentences instead. Content homographs of grammatical words
   (*son* = sound, *or* = gold) are kept with damped frequency.

2. **Inflection roll-up needs a guard.** Summing a lemma's conjugations is right
   in principle: *être* is rarer than *est* and *sont*. But kaikki's conjugation
   tables list the auxiliary, so *redescendre* inherited the frequency of
   *avoir* and jumped to rank 28; and a plural can collide with a common
   preposition, so *dan* borrowed from *dans* and *sou* from *sous*. A form is
   now credited only when it is not far more frequent than the lemma itself.

3. **Sense position matters.** Scoring the best gloss made *rester* look like a
   perfect cognate, because Wiktionary lists "to rest" as its fifth sense behind
   "to stay". Similarity now decays with sense position, and the card always
   prompts with the **primary** sense, never with the best-matching one.
   Prompting "to rest" and expecting *rester* would have taught the false friend.

4. **Parts of speech are separated by inflected-form mass.** The noun and verb
   *lire* share one frequency, so ranking chose the Italian lira over "to read".
   The verb's forms (*lit, lis, lisent, lu*) carry far more mass than the noun's
   (*lires*), which settles it.

5. **Core words are interleaved, and rescued before truncation.** Pure
   `similarity × frequency` drops *lire*, *voir* and *boire* entirely. Each
   level now reserves 15% of its slots for the most frequent words regardless of
   similarity. This also flattens the difficulty cliff that cognate-first
   ordering otherwise creates around word 1500.

6. **The tech-register boost is deterministic, not an LLM call.** Wiktionary
   already tags senses with topic categories (Computing, Mathematics, Business),
   which is cheaper, reproducible, and better grounded than asking a model to
   guess register.

7. **TTS is the primary audio, not the fallback.** Human recordings are uneven
   in coverage and loudness, and waiting on them delayed having any deck at all.
   Every card gets Swiss TTS of the exact phrase to type; the native recording
   rides along on the back as a pronunciation reference. Coverage is roughly
   90% native, 100% TTS.

## Feeling progress

- **Text coverage is the headline metric**: the share of running French text made
  up of words Anki calls mature. It uses the frequency mass already stored per
  word, counts inflections, climbs fast early, and cannot be gamed by piling up
  new cards.
- **Levels are Anki subdecks** of 100 words, so finished levels are visible on
  the deck screen without any tooling.
- **Directions unlock** rather than all arriving at once. A word you know well
  turns into a new, harder card instead of just a bigger pile. Anki generates a
  card only when its front template renders, so the gate is a field that
  `frcog sync` fills once the prerequisite matures.
- The web app shows a session summary with the coverage gained.

## Auto-checking

- **Typed**: normalise, match against the full translation set, tolerate typos by
  edit distance. Accent-stripped input is correct-with-correction; a missing
  article is correct-but-flagged, since gender is part of what is being taught.
- **Spoken** (the riskiest component): speech-to-text is biased toward real words
  and silently autocorrects a mispronunciation. **v1 is a lenient transcription
  match** across every alternative the recogniser returns. This grades *what you
  said*, not *how you said it*. Phoneme-level forced alignment (wav2vec2, Azure
  Pronunciation Assessment) is the eventual fix; it does not block the app.

## Scheduling

Anki owns scheduling for the four directions it can run, using its own FSRS. The
web app uses SM-2 for walking mode, which Anki cannot do. Both write back into
`card_state` and `reviews`, so the database keeps the whole picture. Writing a
second FSRS implementation in the browser was not worth it while Anki carries
the main study load.

## Build order (as executed)

1. **Pipeline → SQLite.** Print the top of the ranking and read it. This is where
   all seven corrections above came from.
2. **Audio**, then **Anki export** with stable GUIDs.
3. **Progress**: sync from Anki, coverage, unlocks.
4. **Walking-mode PWA.**
5. Still open: phoneme-level pronunciation scoring, sentence context on cards,
   and native human audio for the whole deck. Wikimedia answers a burst of about
   five requests with HTTP 429, so that pass runs slowly in the background; TTS
   already covers every card, so nothing waits on it.

Rebuilding never destroys progress: `build` upserts, retired words are marked
inactive rather than deleted, and Anki note GUIDs are stable across rebuilds.
