"""Cognate similarity between a French headword and its English glosses.

The score is a blend of normalised Levenshtein similarity and Jaro-Winkler.
Jaro-Winkler is in the blend deliberately: it rewards a shared prefix, which is
exactly the signal that makes a cognate feel free to learn.

Regular French/English suffix correspondences are applied as rewrite rules. Both
sides are rewritten, and the best-scoring pair wins, so "rapidement"/"rapidly"
scores as the near-identity it actually is.
"""
from __future__ import annotations

from dataclasses import dataclass

from rapidfuzz.distance import JaroWinkler, Levenshtein

from .config import Config, DEFAULT
from .normalize import key_en, key_fr

# (french_suffix, english_suffix) on accent-stripped keys.
SUFFIX_RULES: list[tuple[str, str]] = [
    ("ment", "ly"),      # rapidement / rapidly
    ("te", "ty"),        # qualite / quality   (accent already stripped)
    ("ite", "ity"),      # activite / activity
    ("ique", "ic"),      # logique / logic
    ("ique", "ical"),    # pratique / practical
    ("eur", "or"),       # acteur / actor
    ("eur", "er"),       # serveur / server
    ("euse", "er"),      # serveuse / server
    ("aire", "ary"),     # necessaire / necessary
    ("oire", "ory"),     # obligatoire / obligatory
    ("eux", "ous"),      # nerveux / nervous
    ("if", "ive"),       # actif / active
    ("ie", "y"),         # energie / energy
    ("ise", "ize"),      # organise / organize
    ("iser", "ize"),     # organiser / organize
    ("isme", "ism"),     # tourisme / tourism
    ("iste", "ist"),     # artiste / artist
    ("ance", "ancy"),
    ("ence", "ency"),
    ("able", "able"),
    ("ible", "ible"),
    ("tion", "tion"),
    ("ssion", "ssion"),
    ("e", "ed"),         # developpe / developed
    ("er", ""),          # danser / dance   (verb infinitive)
    ("ir", ""),          # finir / finish
    ("re", ""),          # vendre / vend
]


@dataclass
class Score:
    similarity: float
    english: str          # the gloss alternative that produced the best score
    fr_variant: str
    en_variant: str

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Score({self.similarity:.3f}, {self.english!r})"


def _pair_similarity(a: str, b: str, cfg: Config) -> float:
    if not a or not b:
        return 0.0
    lev = Levenshtein.normalized_similarity(a, b)
    jw = JaroWinkler.similarity(a, b)
    return cfg.w_levenshtein * lev + cfg.w_jaro_winkler * jw


def fr_variants(fr: str, en: str, cfg: Config) -> set[str]:
    """French key plus every suffix-rewritten form pointing at English."""
    out = {fr}
    for fs, es in SUFFIX_RULES:
        if not fr.endswith(fs) or len(fr) <= len(fs):
            continue
        if cfg.gate_suffix_rules and es and not en.endswith(es):
            continue
        out.add(fr[: len(fr) - len(fs)] + es)
    return out


def en_variants(fr: str, en: str, cfg: Config) -> set[str]:
    """English key plus every suffix-rewritten form pointing at French."""
    out = {en}
    for fs, es in SUFFIX_RULES:
        if not es or not en.endswith(es) or len(en) <= len(es):
            continue
        if cfg.gate_suffix_rules and not fr.endswith(fs):
            continue
        out.add(en[: len(en) - len(es)] + fs)
    return out


def score_pair(french: str, english: str, cfg: Config = DEFAULT) -> Score:
    """Best similarity between one French headword and one English gloss."""
    f, e = key_fr(french), key_en(english)
    if not f or not e:
        return Score(0.0, english, f, e)
    best = Score(0.0, english, f, e)
    for fv in fr_variants(f, e, cfg):
        for ev in en_variants(f, e, cfg):
            s = _pair_similarity(fv, ev, cfg)
            if s > best.similarity:
                best = Score(s, english, fv, ev)
    return best


def score_word(french: str, glosses: list[str], cfg: Config = DEFAULT) -> tuple[Score, float]:
    """Return (best gloss match, similarity to use for ranking).

    Comparing only true translation pairs keeps most false friends out, but not
    all: Wiktionary lists "to rest" as a minor sense of "rester" ("to stay"), so
    scoring the best gloss made a false friend look like a perfect cognate. The
    ranking similarity therefore favours the *primary* sense and discounts a
    match that only appears further down the sense list.
    """
    if not glosses:
        return Score(0.0, "", "", ""), 0.0
    best = Score(0.0, glosses[0], "", "")
    rank_sim = 0.0
    for j, g in enumerate(glosses):
        s = score_pair(french, g, cfg)
        if s.similarity > best.similarity:
            best = s
        # Wiktionary orders senses by prominence, so decay by position: the
        # cognate reading of "rester" is sense 5 ("to rest"), sense 1 is "to stay".
        rank_sim = max(rank_sim, s.similarity * (cfg.secondary_sense_discount ** j))
    return best, rank_sim
