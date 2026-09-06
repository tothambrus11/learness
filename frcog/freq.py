"""French frequency data from wordfreq, with inflection roll-up.

A verb lemma is rarer than its own conjugations ("etre" 6.38 vs "est" 7.20), so
ranking on the lemma alone under-rates verbs. We sum the linear frequency of the
lemma and its inflected forms, then convert back to a Zipf value.
"""
from __future__ import annotations

import math
import re

from wordfreq import top_n_list, word_frequency, zipf_frequency

from .config import Config, DEFAULT

# Elided clitics that wordfreq emits as standalone tokens. Not words to learn.
CLITICS = {"l", "d", "c", "j", "n", "s", "t", "m", "qu", "y", "z", "k", "w", "o", "u", "e", "i", "a"}
_ALPHA_FR = re.compile(r"^[a-zà-öø-ÿœæ'\-]+$", re.IGNORECASE)


def linear_to_zipf(freq: float) -> float:
    return math.log10(freq * 1e9) if freq > 0 else 0.0


def top_words(cfg: Config = DEFAULT) -> list[tuple[str, float]]:
    """(word, zipf) for the top N French words, clitics and junk removed."""
    out = []
    for w in top_n_list("fr", cfg.top_n):
        if len(w) < cfg.min_len or w in CLITICS:
            continue
        if not _ALPHA_FR.match(w):
            continue
        z = zipf_frequency(w, "fr")
        if z < cfg.min_zipf:
            continue
        out.append((w, z))
    return out


# A conjugation table lists the auxiliary ("avoir", "ayant"), and a plural can
# collide with a common preposition ("sou" -> "sous", "dan" -> "dans"). Counting
# those hands a rare word the frequency of a very common one, so a form is only
# credited when it is not far more common than the lemma itself.
FORM_FREQ_MARGIN = 1.2   # in Zipf units


def aggregate_zipf(lemma: str, forms: list[str],
                   shared: set[str] | frozenset = frozenset()) -> tuple[float, float]:
    """(aggregated_zipf, lemma_zipf) summing the lemma and its own inflections.

    `shared` names inflections some other word also claims; they are left out
    here for the same reason as in form_mass_zipf, or the adjective "fait"
    outranks the noun on the strength of the verb's participles."""
    seen = {lemma.lower()}
    total = word_frequency(lemma, "fr")
    lemma_z = zipf_frequency(lemma, "fr")
    for f in forms:
        fl = f.lower()
        if fl in seen or fl in shared:
            continue
        seen.add(fl)
        if zipf_frequency(fl, "fr") > lemma_z + FORM_FREQ_MARGIN:
            continue      # belongs to a different, much commoner word
        total += word_frequency(f, "fr")
    return linear_to_zipf(total), lemma_z


def form_mass_zipf(lemma: str, forms: list[str], shared: set[str] | frozenset = frozenset()) -> float:
    """Zipf of the inflected forms alone, excluding the headword.

    This separates two parts of speech that share a spelling. "lire" the verb
    carries lit/lis/lisent/lu (5.38); "lire" the Italian lira carries only
    "lires" (2.92). The bare headword frequency cannot tell them apart.

    `shared` names forms that belong to some other word as well, and they are
    left out: "faite", "faits" and "faites" are listed under the adjective
    "fait" but are the participle of "faire", and counted for the adjective
    they made it outweigh the noun "le fait". A form two words own says
    nothing about which of them is in use.
    """
    lz = zipf_frequency(lemma, "fr")
    total, seen = 0.0, {lemma.lower()}
    for f in forms:
        fl = f.lower()
        if fl in seen or fl in shared:
            continue
        seen.add(fl)
        if zipf_frequency(fl, "fr") > lz + FORM_FREQ_MARGIN:
            continue
        total += word_frequency(f, "fr")
    return linear_to_zipf(total)


def total_mass(words: list[str]) -> float:
    """Share of running French text made up of these tokens."""
    return sum(word_frequency(w, "fr") for w in words)
