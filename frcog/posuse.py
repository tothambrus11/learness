"""Which part of speech a spelling is mostly used as, read off the corpus.

One card per spelling means choosing between "vidéo" the adjective and "la
vidéo" the noun, or "fait" the participle and "le fait". The frequency of the
inflected forms settles most such pairs, but not a tie, and a tie is exactly
where it matters: the noun card carries an article and a gender, the
adjective card carries nothing the noun does not.

So a tie is settled by how the word is actually used. A noun use is a
determiner directly before the word and no noun directly after it — "la vidéo
est", "de la politique". That second half is what keeps "un petit garçon"
from making "petit" a noun. Nothing here is a list of words; the rule is
scored on the lemmas Wiktionary gives only one part of speech, and the build
prints that score.
"""
from __future__ import annotations

import statistics
from collections import Counter
from pathlib import Path

from .config import RAW
from .sentences import load_pairs, tokenize

DETERMINERS = {
    "le", "la", "l", "les", "un", "une", "des", "du", "ce", "cet", "cette", "ces",
    "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "votre",
    "leur", "leurs", "nos", "vos", "quel", "quelle", "quels", "quelles", "chaque",
    "plusieurs", "aucun", "aucune",
}
MIN_OCCURRENCES = 8       # fewer sightings and the share is noise
NOUN_USE_SHARE = 0.20     # well above the 0.10 that best separates the calibration classes


class NounUse:
    """Per lemma: how often it stands where a noun stands."""

    def __init__(self, seen: Counter, noun_like: Counter):
        self._seen = seen
        self._noun = noun_like

    def share(self, lemma: str) -> float | None:
        n = self._seen[lemma.lower()]
        if n < MIN_OCCURRENCES:
            return None
        return self._noun[lemma.lower()] / n

    def count(self, lemma: str) -> int:
        return self._seen[lemma.lower()]

    def is_noun(self, lemma: str) -> bool:
        s = self.share(lemma)
        return s is not None and s >= NOUN_USE_SHARE


def count_noun_use(lemmas: set[str], noun_forms: set[str],
                   pairs: list[tuple[str, str]] | None = None, raw: Path = RAW) -> NounUse:
    """Scan the corpus once. `noun_forms` is every spelling that is a noun or a
    noun's inflection, so that a word followed by one of them reads as an
    adjective in front of it rather than a noun."""
    if pairs is None:
        pairs = load_pairs(raw, log=lambda *a: None) if (raw / "fra_sentences.tsv.bz2").exists() else []
    want = {l.lower() for l in lemmas}
    seen: Counter = Counter()
    noun_like: Counter = Counter()
    for fr, _ in pairs:
        toks = tokenize(fr)
        for i, t in enumerate(toks):
            if t not in want:
                continue
            seen[t] += 1
            after = toks[i + 1] if i + 1 < len(toks) else None
            if i > 0 and toks[i - 1] in DETERMINERS and (after is None or after not in noun_forms):
                noun_like[t] += 1
    return NounUse(seen, noun_like)


def score(use: NounUse, noun_only: set[str], adj_only: set[str],
          threshold: float = NOUN_USE_SHARE) -> tuple[float, float, int, int]:
    """How the rule does on words whose part of speech is not in question:
    (share of noun-only lemmas it calls nouns, share of adjective-only lemmas
    it does not, and how many of each it could measure)."""
    nouns = [use.share(w) for w in noun_only if use.share(w) is not None]
    adjs = [use.share(w) for w in adj_only if use.share(w) is not None]
    if not nouns or not adjs:
        return 0.0, 0.0, len(nouns), len(adjs)
    hit = sum(1 for s in nouns if s >= threshold) / len(nouns)
    spare = sum(1 for s in adjs if s < threshold) / len(adjs)
    return hit, spare, len(nouns), len(adjs)
