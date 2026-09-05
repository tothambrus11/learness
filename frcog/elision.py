"""Does a word's article elide? "le héros" or "l'héros"?

French elides "le"/"la" before a vowel *sound*, and the exceptions are lexical
rather than phonetic: "héros" and "hôpital" both begin /e/-ish and sound alike,
yet one takes "le" and the other "l'". Nothing in the spelling or in the
transcription of the word alone can tell them apart, because h aspiré is not a
sound; it is a memory of one, and it has to be looked up.

So nothing here is decided by a rule of thumb about French. Every word is
settled by one of four things:

* English Wiktionary's "aspirated h" / "mute h" categories, in the extract the
  pipeline already downloads. These cover "onze" and "huit" too, not just the h
* French Wiktionary's "Termes en français à h aspiré" / "à h muet" categories
* the Tatoeba corpus: how the language actually writes the word, counting
  "l'X"/"cet X" against "le X"/"ce X" among determiners that alternate
* failing all three, the first phoneme of the word's own IPA, or failing that
  its first letter -- which settle every word that is not an h or a semi-vowel

The dictionaries are asked first and the corpus only where they are silent, so
the sound is consulted last except for consonants, which no source can overrule.
Where the sources disagree, or where none of them speaks and the spelling could
go either way, the word is left unresolved and the caller drops it rather than
guess. `score_against_dictionaries` reports how often the corpus rule agrees
with the two dictionaries, which is the number to watch: it is how you check
this file without reading French.
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .config import BUILD, RAW
from .sentences import _read_tsv_bz2

BLOCK, ELIDE = "block", "elide"

# The IPA vowel letters French uses, plus the length and nasal marks that can
# follow one. Semi-vowels (j w ɥ) are deliberately not here: "oiseau" /wa.zo/
# elides and "yaourt" /ja.uʁt/ does not, so a semi-vowel onset settles nothing
# and has to go to the sources like an h does.
IPA_VOWELS = set("aɑeɛøœioɔuyəɐæɪʊɵʏ")
IPA_SEMIVOWELS = set("jwɥ")
IPA_STRIP = set("ˈˌ.ˑːʰ()[]/\\|'’ ")

# When there is no transcription, the spelling still rules out most of the
# question. A French word written with an initial consonant letter is said with
# an initial consonant, with h the one exception; and among the vowel letters,
# only bare o, u and y can open on a semi-vowel ("ouate", "huit", "yaourt") and
# so leave anything to decide -- an accent rules even that out, since French
# spells those onsets ou-, oi-, ui-, hu-. The rest have no elision-blocking
# words at all, and any that appeared would be carrying a Wiktionary category,
# which is consulted before this.
UNAMBIGUOUS_VOWEL_LETTERS = set("aàâäeéèêëiîïœæôöùûü")
AMBIGUOUS_LETTERS = set("houwy")

CAT_EN = {"French terms with aspirated h": BLOCK, "French terms with mute h": ELIDE}
CAT_FR = {"Catégorie:Termes en français à h aspiré": BLOCK,
          "Catégorie:Termes en français à h muet": ELIDE}
FR_API = "https://fr.wiktionary.org/w/api.php"

# Determiners that choose their form by the sound that follows, split by the
# gender they can appear with. "cette" is in neither list on purpose: it is the
# feminine form whether or not the noun elides, so it is evidence of nothing.
ELIDING_M = {"l'", "de l'", "cet", "bel", "nouvel", "vieil"}
BLOCKING_M = {"le", "du", "ce", "beau", "nouveau", "vieux"}
ELIDING_F = {"l'", "de l'", "mon"}
BLOCKING_F = {"la", "de la", "ma"}
_DET = re.compile(
    r"(?:^|[\s(«\"])(l['’]|de\s+l['’]|le|la|du|de\s+la|ce|cet|bel|nouvel|vieil"
    r"|beau|nouveau|vieux|mon|ma)\s?([A-Za-zÀ-ÿœæ]+)", re.IGNORECASE)

# How much corpus evidence is enough. Both numbers come from measurement, not
# taste: scored against the words Wiktionary settles, a single sighting is
# wrong about "huis" ("à huis clos" is the only way anyone writes it), and two
# sightings are right about all 87 it can reach. See the build log, which
# prints that score on every run.
CORPUS_MIN = 2
CORPUS_RATIO = 3


def first_sound(ipa: str | None) -> str | None:
    """'vowel', 'semivowel', 'consonant', or None when there is no usable IPA."""
    for ch in ipa or "":
        if ch in IPA_STRIP:
            continue
        if ch in IPA_VOWELS:
            return "vowel"
        if ch in IPA_SEMIVOWELS:
            return "semivowel"
        return "consonant"
    return None


def spelt_with_h(word: str) -> bool:
    return word[:1].lower() == "h"


def first_letter_class(word: str) -> str | None:
    """'vowel', 'consonant', 'ambiguous' -- what the spelling alone can say."""
    first = word[:1].lower()
    if not first:
        return None
    if first in AMBIGUOUS_LETTERS:
        return "ambiguous"
    if first in UNAMBIGUOUS_VOWEL_LETTERS:
        return "vowel"
    return "consonant"


# --------------------------------------------------------------------------
# source 2: the English Wiktionary categories, already on disk


def h_class_from_categories(names) -> str | None:
    """BLOCK, ELIDE, or None — None also when a word carries both categories,
    which is Wiktionary saying usage is divided ("haricot")."""
    found = {CAT_EN[n] for n in names if n in CAT_EN}
    return found.pop() if len(found) == 1 else None


# --------------------------------------------------------------------------
# source 3: the French Wiktionary categories, over the API


def fetch_fr_wiktionary(words, cache: Path | None = None, log=print) -> dict[str, str]:
    """{word: BLOCK|ELIDE} for the words fr.wiktionary classifies.

    Cached on disk: the answer changes about as often as French does, and the
    build should not depend on the network being up.
    """
    cache = cache or BUILD / "elision-frwiktionary.json"
    known: dict[str, str] = {}
    if cache.exists():
        known = json.loads(cache.read_text(encoding="utf-8"))
    todo = sorted(w for w in words if w not in known)
    if not todo:
        return {w: v for w, v in known.items() if v}

    for i in range(0, len(todo), 40):
        chunk = todo[i:i + 40]
        query = urllib.parse.urlencode({
            "action": "query", "titles": "|".join(chunk), "prop": "categories",
            "clcategories": "|".join(CAT_FR), "cllimit": "max", "format": "json"})
        req = urllib.request.Request(f"{FR_API}?{query}",
                                     headers={"User-Agent": "frcog/1.0 (elision lookup)"})
        for attempt in range(4):
            try:
                data = json.load(urllib.request.urlopen(req, timeout=30))
                break
            except Exception as exc:            # rate limits and flaky networks
                if attempt == 3:
                    log(f"    fr.wiktionary lookup failed ({exc}); using what is cached")
                    data = None
                    break
                time.sleep(3 * (attempt + 1))
        if data is None:
            break
        for page in data.get("query", {}).get("pages", {}).values():
            cats = {c["title"] for c in page.get("categories") or []}
            verdicts = {CAT_FR[c] for c in cats if c in CAT_FR}
            known[page["title"]] = verdicts.pop() if len(verdicts) == 1 else ""
        for w in chunk:                         # remember the silences too
            known.setdefault(w, "")
        time.sleep(1.5)

    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(known, ensure_ascii=False, indent=0, sort_keys=True),
                     encoding="utf-8")
    return {w: v for w, v in known.items() if v}


# --------------------------------------------------------------------------
# source 4: how the corpus writes it


@dataclass
class CorpusCounts:
    elide: Counter = field(default_factory=Counter)
    block: Counter = field(default_factory=Counter)

    def verdict(self, word: str, minimum: int = CORPUS_MIN,
                ratio: int = CORPUS_RATIO) -> str | None:
        e, b = self.elide[word], self.block[word]
        if e + b < minimum:
            return None
        if e >= ratio * b:
            return ELIDE
        if b >= ratio * e:
            return BLOCK
        return None                              # genuinely divided usage


def count_corpus(genders: dict[str, str], raw: Path = RAW) -> CorpusCounts:
    """Count eliding against blocking determiners for each word.

    The gender matters: "la" before a feminine noun is evidence that it does not
    elide, but before a masculine one it is not that noun at all.
    """
    forms: dict[str, str] = {}
    for word in genders:
        low = word.lower()
        forms[low] = word
        if not low.endswith("s"):
            forms.setdefault(low + "s", word)

    counts = CorpusCounts()
    corpus = raw / "fra_sentences.tsv.bz2"
    if not corpus.exists():
        # The corpus is one optional source among three; without it every
        # word simply has no observations and the dictionaries decide.
        return counts
    for row in _read_tsv_bz2(corpus):
        if len(row) < 3:
            continue
        for m in _DET.finditer(row[2]):
            word = forms.get(m.group(2).lower())
            if word is None:
                continue
            det = re.sub(r"\s+", " ", m.group(1).lower().replace("’", "'"))
            gender = genders.get(word, "")
            if gender == "m":
                eliding, blocking = ELIDING_M, BLOCKING_M
            elif gender == "f":
                eliding, blocking = ELIDING_F, BLOCKING_F
            else:
                eliding, blocking = ELIDING_M | ELIDING_F, BLOCKING_M | BLOCKING_F
            if det in eliding:
                counts.elide[word] += 1
            elif det in blocking:
                counts.block[word] += 1
    return counts


def score_against_dictionaries(counts: CorpusCounts, labels: dict[str, str],
                               minimum: int = CORPUS_MIN,
                               ratio: int = CORPUS_RATIO) -> tuple[int, int, list[str]]:
    """(agreements, disagreements, the words it got wrong).

    The corpus rule is the only piece here that is inference rather than
    lookup, so it is scored on the words the dictionaries already settle. A
    single disagreement means the rule, not the dictionary, is wrong.
    """
    agree, wrong = 0, []
    for word, truth in labels.items():
        said = counts.verdict(word, minimum, ratio)
        if said is None:
            continue
        if said == truth:
            agree += 1
        else:
            wrong.append(word)
    return agree, len(wrong), wrong


# --------------------------------------------------------------------------
# putting the sources together


@dataclass
class Verdict:
    elides: bool | None
    why: str

    @property
    def known(self) -> bool:
        return self.elides is not None


def resolve(word: str, ipa: str | None, en_class: str | None,
            fr_class: str | None, corpus: str | None) -> Verdict:
    """Combine the sources. Silence is an answer only where silence is safe."""
    dictionaries = [v for v in (en_class, fr_class) if v]
    if dictionaries and len(set(dictionaries)) > 1:
        return Verdict(None, "en.wiktionary and fr.wiktionary disagree")
    if dictionaries:
        verdict = dictionaries[0]
        if corpus and corpus != verdict:
            return Verdict(None, f"dictionaries say {verdict}, corpus says {corpus}")
        return Verdict(verdict == ELIDE, "dictionary")

    sound = first_sound(ipa)
    letter = first_letter_class(word)
    if sound == "consonant":
        # No French word beginning with a consonant sound elides, and no source
        # is needed to say so.
        return Verdict(False, "consonant onset")
    if corpus:
        return Verdict(corpus == ELIDE, "corpus")
    if sound == "vowel" and not spelt_with_h(word):
        # A vowel sound with no h to hide behind. The words that block elision
        # here -- "onze", "un" -- are ones Wiktionary categorises, and it was
        # asked first.
        return Verdict(True, "vowel onset")
    if sound == "semivowel" and letter == "vowel":
        # "l'ion", "l'iode": the semi-vowels that block are written y-, w-, ou-
        # and hu-, never with the letter this word starts with.
        return Verdict(True, "vowel spelling")
    if sound is None and letter != "ambiguous":
        # No transcription, but the spelling still rules the question out.
        return Verdict(letter == "vowel", f"{letter} spelling")
    # An h, or a letter that can open on a semi-vowel, that nobody has
    # classified. This is the whole of the problem, and the one place where a
    # source is indispensable.
    return Verdict(None, f"unclassified {word[:1].lower()}-" if letter == "ambiguous"
                   else f"{sound} onset")


def needs_lookup(word: str, ipa: str | None) -> bool:
    """Whether a word is one the dictionaries have to be asked about.

    Exactly the words `resolve` cannot settle on its own, so the two can never
    drift apart: a word is looked up when, and only when, nothing about it
    answers the question.
    """
    return not resolve(word, ipa, None, None, None).known
