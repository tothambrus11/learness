"""Text normalisation shared by scoring and answer-checking.

Two jobs:
  * produce a bare comparison key for similarity scoring (accent-free, particle-free)
  * produce a tolerant key for checking what the learner typed
"""
from __future__ import annotations

import re
import unicodedata

# Ligatures and letters that NFD will not decompose into ASCII on their own.
_LIGATURES = {
    "œ": "oe", "Œ": "OE", "æ": "ae", "Æ": "AE",
    "ß": "ss", "ø": "o", "Ø": "O", "đ": "d", "ð": "d", "þ": "th",
    "’": "'", "‘": "'", "´": "'", "`": "'", " ": " ", " ": " ",
}

# Leading French particles that carry no lexical weight for a similarity comparison.
# Order matters: longest first so "de la" beats "de".
_LEADING = [
    "de la", "de l'", "à l'", "a l'", "au", "aux",
    "le", "la", "les", "l'", "un", "une", "des", "du",
    "se", "s'", "ne", "n'", "y",
]

# Prepositions a French verb governs; stripped from the comparison key, kept on the card.
_TRAILING = ["à", "a", "de", "d'", "en", "sur", "pour", "avec", "dans", "par", "vers", "contre"]

# English gloss noise.
_EN_LEADING = ["to be ", "to ", "a ", "an ", "the ", "one ", "some "]
_PARENS = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_NON_LETTER = re.compile(r"[^a-z]+")
_WS = re.compile(r"\s+")


def fold_ligatures(s: str) -> str:
    for a, b in _LIGATURES.items():
        s = s.replace(a, b)
    return s


def strip_accents(s: str) -> str:
    """NFD, drop combining marks, recompose. 'développé' -> 'developpe'."""
    s = fold_ligatures(s)
    decomposed = unicodedata.normalize("NFD", s)
    without = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return unicodedata.normalize("NFC", without)


def strip_particles(s: str) -> str:
    """Remove leading articles/reflexives and trailing governed prepositions."""
    out = s.strip().lower()
    changed = True
    while changed:
        changed = False
        for p in _LEADING:
            if p.endswith("'"):
                if out.startswith(p):
                    out, changed = out[len(p):].strip(), True
                    break
            elif out.startswith(p + " "):
                out, changed = out[len(p) + 1:].strip(), True
                break
    for p in _TRAILING:
        if p.endswith("'"):
            continue
        if out.endswith(" " + p):
            out = out[: -(len(p) + 1)].strip()
            break
    return out


def key_fr(word: str) -> str:
    """Comparison key for a French headword: 'se développer' -> 'developper'."""
    return _NON_LETTER.sub("", strip_accents(strip_particles(word)).lower())


def key_en(gloss: str) -> str:
    """Comparison key for an English gloss: 'to wash (oneself)' -> 'wash'."""
    g = _PARENS.sub(" ", fold_ligatures(gloss)).lower()
    # A gloss may pack synonyms ("cat, tom, tomcat"); score against the first only.
    g = re.split(r"[;,:]| / ", g)[0]
    g = _WS.sub(" ", g).strip()
    for p in _EN_LEADING:
        if g.startswith(p):
            g = g[len(p):]
            break
    return _NON_LETTER.sub("", strip_accents(g))


def answer_key(s: str, keep_accents: bool = False) -> str:
    """Key for grading a typed answer. Particles are kept: gender is part of the answer."""
    s = fold_ligatures(s).strip().lower()
    s = _PARENS.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    if not keep_accents:
        s = strip_accents(s)
    return re.sub(r"[^a-zà-ÿ' ]+", "", s).strip()


# A gloss that continues with one of these is a phrase, not a synonym list.
_CONTINUATION = re.compile(r"^(or|and|but|which|who|that|when|while|as|of|in|to|for|with|"
                           r"esp|especially|usually|often)\b", re.IGNORECASE)


def split_gloss(gloss: str) -> list[str]:
    """'cat, tom, tomcat (male)' -> ['cat', 'tom', 'tomcat'].

    Wiktionary packs synonyms into one gloss with commas, but it also writes
    ordinary prose there: "to denote time, day, or date" is one meaning, not
    three. Only split when every piece looks like a bare synonym.
    """
    g = _PARENS.sub(" ", fold_ligatures(gloss))
    g = g.split(":")[0]
    parts = [_WS.sub(" ", p).strip(" .\u2019'\"") for p in re.split(r"[;,]| / ", g)]
    parts = [p for p in parts if p]
    whole = _WS.sub(" ", g).strip(" .\u2019'\"")
    if len(parts) > 1:
        looks_like_prose = any(
            _CONTINUATION.match(p) or len(p.split()) > 3 for p in parts[1:])
        if looks_like_prose:
            parts = [whole]
    out, seen = [], set()
    for p in parts:
        if not p or len(p) > 60:
            continue
        low = p.lower()
        if low in seen:
            continue
        seen.add(low)
        out.append(p)
    return out or ([whole] if whole else [])
