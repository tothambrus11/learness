"""How much a French word *sounds* like its English translation.

The pipeline's `similarity` is computed over spellings, so it says how easy a
word is to read. It says nothing about how easy it is to hear, and for French
against English the two come apart in one direction: "nation" is spelt
identically and said /na.sjɔ̃/. A deck that knows only the first score will
schedule listening for that word as if it were free.

The second score is built from data already on hand. Every catalogue entry
carries the French IPA from Wiktionary; the English side comes from the CMU
Pronouncing Dictionary (public domain). Both are mapped into one coarse phoneme
inventory and compared by normalised edit distance, so 1.0 is "said the same"
and 0.0 is "nothing in common". The inventory is deliberately coarse: an
English ear does not hear the difference between /a/ and /ɑ/, and a nasal vowel
lands as vowel-plus-n, which is what that ear reaches for.

`tests/test_phonetics.py` pins the answers for words whose case is not in
doubt — "nation" far, "taxi" identical — the same way the elision rule is
checked against the dictionaries.
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from .config import RAW

CMUDICT_URL = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict"
CMUDICT_PATH = RAW / "cmudict.dict"

# ARPABET, as CMUdict writes it, into the shared inventory. Stress digits are
# stripped before lookup.
ARPABET = {
    "AA": "a", "AE": "a", "AH": "ə", "AO": "o", "AW": "aw", "AY": "aj", "EH": "e",
    "ER": "ər", "EY": "e", "IH": "i", "IY": "i", "OW": "o", "OY": "oj", "UH": "u",
    "UW": "u", "B": "b", "CH": "tʃ", "D": "d", "DH": "d", "F": "f", "G": "g",
    "HH": "h", "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "n",
    "P": "p", "R": "r", "S": "s", "SH": "ʃ", "T": "t", "TH": "t", "V": "v",
    "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}

# French IPA, as Wiktionary writes it, into the same inventory. Two-character
# keys (the nasal vowels) are tried before single characters.
FRENCH = {
    "ɑ̃": "an", "ɛ̃": "en", "ɔ̃": "on", "œ̃": "en",
    "ɑ": "a", "a": "a", "e": "e", "ɛ": "e", "i": "i", "o": "o", "ɔ": "o", "u": "u",
    "y": "y", "ø": "ə", "œ": "ə", "ə": "ə",
    "p": "p", "b": "b", "t": "t", "d": "d", "k": "k", "g": "g", "f": "f", "v": "v",
    "s": "s", "z": "z", "ʃ": "ʃ", "ʒ": "ʒ", "m": "m", "n": "n", "ɲ": "n", "ŋ": "n",
    "l": "l", "ʁ": "r", "ʀ": "r", "r": "r", "j": "j", "w": "w", "ɥ": "w", "h": "",
}

_GLOSS_LEAD = re.compile(r"^(to|a|an|the)\s+")


def english_phones(arpabet: str) -> str:
    """'N EY1 SH AH0 N' -> 'neʃən'."""
    return "".join(ARPABET.get(re.sub(r"\d", "", p), "") for p in arpabet.split())


def french_phones(ipa: str | None) -> str:
    """'/na.sjɔ̃/' -> 'nasjon'. Slashes, syllable dots and stress marks go."""
    s = unicodedata.normalize("NFC", (ipa or "").strip("/[] "))
    s = s.replace(".", "").replace("ˈ", "").replace("ˌ", "").replace("‿", "")
    out, i = [], 0
    while i < len(s):
        pair = s[i:i + 2]
        if pair in FRENCH:
            out.append(FRENCH[pair])
            i += 2
            continue
        out.append(FRENCH.get(s[i], ""))
        i += 1
    return "".join(out)


def distance(a: str, b: str) -> float:
    """Levenshtein, normalised by the longer string, so 0.0 is identical."""
    if a == b:
        return 0.0
    if not a or not b:
        return 1.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[-1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] / max(len(a), len(b))


def gloss_word(gloss: str | None) -> str | None:
    """The single English word a gloss is, or None when it is a phrase.

    'to pass' -> 'pass'; 'the hero' -> 'hero'; 'to denote time' -> None. A
    phrase has no single pronunciation to compare against, and the score
    would only mislead.
    """
    w = _GLOSS_LEAD.sub("", (gloss or "").strip().lower())
    if not w or " " in w or not re.fullmatch(r"[a-z'-]+", w):
        return None
    return w


class Pronunciations:
    """English pronunciations, from CMUdict or from a dict handed in by a test."""

    def __init__(self, arpabet: dict[str, str]):
        """`arpabet` maps a word to its CMUdict line, 'N EY1 SH AH0 N'; it is
        converted here so a dictionary built by a test and one read from the
        file are the same thing."""
        self._phones = {word: english_phones(a) for word, a in arpabet.items()}

    @classmethod
    def from_file(cls, path: Path = CMUDICT_PATH) -> "Pronunciations | None":
        """None when the file is not there, so a build without it still runs;
        every word then simply has no phonological score."""
        if not path.exists():
            return None
        entries: dict[str, str] = {}
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                word, _, rest = line.partition(" ")
                word = word.split("(")[0]          # 'read(2)' is a second reading
                if word and word not in entries:   # the first reading is the common one
                    entries[word] = rest
        return cls(entries)

    def phones(self, word: str) -> str | None:
        return self._phones.get(word)

    def sounds_like(self, french_ipa: str | None, gloss: str | None) -> float | None:
        """1.0 when the French and English are said alike, 0.0 when they share
        nothing; None when either side has nothing to compare."""
        word = gloss_word(gloss)
        if word is None:
            return None
        en = self.phones(word)
        fr = french_phones(french_ipa)
        if not en or not fr:
            return None
        return round(1.0 - distance(fr, en), 3)
