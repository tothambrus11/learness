"""Read the kaikki.org English-Wiktionary extract for French.

One JSON object per line. We keep lemma entries only and pull out the four things
a card needs: English glosses, IPA, gender/POS, and candidate audio recordings.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from .config import Config, DEFAULT
from . import conjugation as conj
from .normalize import split_gloss

# Parts of speech worth a flashcard. Affixes and proper nouns are not.
KEEP_POS = {
    "noun", "verb", "adj", "adv", "pron", "prep", "conj", "num", "intj", "det", "phrase",
}
SKIP_POS = {"name", "prefix", "suffix", "infix", "character", "punct", "romanization", "abbrev"}

# Sense tags that mean "this is not a headword in its own right".
NON_LEMMA_TAGS = {"form-of", "alt-of", "inflection-of", "participle", "plural", "misspelling"}
SWISS_CATEGORIES = {"Swiss French", "Helvetism", "Helvetisms"}
# Wiktionary marks regional usage on the sense tags, and the tags are both more
# reliable than the categories and more specific: "huitante" is tagged Fribourg
# and Valais, which is exactly where the user lives, while its categories never
# mention Switzerland at all.
SWISS_TAGS = {"Switzerland", "Swiss", "Valais", "Vaud", "Fribourg", "Geneva",
              "Genève", "Neuchâtel", "Jura", "Romandy", "Suisse"}

# Sense tags that mean "real, but do not make this the primary meaning".
DEPRIORITISE_TAGS = {"obsolete", "archaic", "rare", "dated", "historical", "slang", "vulgar", "poetic"}


@dataclass
class AudioCandidate:
    url: str
    filename: str
    region: str
    region_rank: int
    source: str


@dataclass
class Entry:
    word: str
    pos: str
    gender: str | None = None
    ipa: str | None = None
    glosses: list[str] = field(default_factory=list)      # display strings, primary first
    swiss_glosses: list[str] = field(default_factory=list)  # senses tagged Switzerland/Valais
    examples: list[tuple[str, str]] = field(default_factory=list)  # (French, English)
    categories: set[str] = field(default_factory=set)
    audio: list[AudioCandidate] = field(default_factory=list)
    forms: list[str] = field(default_factory=list)         # inflected forms, for frequency roll-up
    swiss: bool = False   # tagged "Swiss French" by Wiktionary (septante, natel, ...)
    conjugation: dict | None = None   # verbs only: the categorised tables


def _gender_from_head(entry: dict) -> str | None:
    for ht in entry.get("head_templates") or []:
        args = ht.get("args") or {}
        g = str(args.get("1", "")).strip().lower()
        if g in {"m", "f", "mf", "m-f", "fm"}:
            return {"m": "m", "f": "f", "mf": "mf", "m-f": "mf", "fm": "mf"}[g]
    return None


def _gender_from_senses(senses: list[dict]) -> str | None:
    for s in senses:
        tags = set(s.get("tags") or [])
        if "masculine" in tags and "feminine" in tags:
            return "mf"
        if "masculine" in tags:
            return "m"
        if "feminine" in tags:
            return "f"
    return None


def _region_of(tags: list[str], note: str, filename: str, cfg: Config) -> tuple[str, int]:
    """Map a recording's tags to a region label and a preference rank (lower is better)."""
    blob = " ".join(tags or []) + " " + (note or "") + " " + (filename or "")
    for bad in cfg.reject_regions:
        if bad.lower() in blob.lower():
            return (bad, 99)          # 99 == never use as primary
    for i, good in enumerate(cfg.prefer_regions):
        if good.lower() in blob.lower():
            return (good, i)
    return ("unknown", len(cfg.prefer_regions))


def _extract_sounds(entry: dict, cfg: Config) -> tuple[str | None, list[AudioCandidate]]:
    ipa, audio = None, []
    for s in entry.get("sounds") or []:
        tags = s.get("tags") or []
        if s.get("ipa") and ipa is None:
            region, rank = _region_of(tags, s.get("note", ""), "", cfg)
            if rank < 99:                     # never take a Quebec transcription as the IPA
                ipa = s["ipa"].strip()
        url = s.get("mp3_url") or s.get("ogg_url")
        if url:
            fn = s.get("audio", "")
            region, rank = _region_of(tags, s.get("note", ""), fn, cfg)
            source = "lingualibre" if fn.startswith("LL-") else "commons"
            audio.append(AudioCandidate(url, fn, region, rank, source))
    audio.sort(key=lambda a: (a.region_rank, a.source != "lingualibre"))
    return ipa, audio


def _extract_glosses(senses: list[dict]) -> tuple[list[str], set[str], set[str]]:
    """Returns (glosses, all categories, categories of the first real sense).

    The split matters for the Swiss flag: "service" and "vie" have a Swiss sense
    somewhere down the list, which does not make them Helvetisms. Only a word
    whose *first* sense is Swiss earns the label.
    """
    primary: list[str] = []
    secondary: list[str] = []
    swiss: list[str] = []
    cats: set[str] = set()
    first_cats: set[str] = set()
    seen_first = False
    for s in senses:
        tags = set(s.get("tags") or [])
        if tags & NON_LEMMA_TAGS or s.get("form_of") or s.get("alt_of"):
            continue
        gl = s.get("glosses") or s.get("raw_glosses") or []
        if not gl:
            continue
        for c in s.get("categories") or []:
            name = c.get("name")
            if name:
                cats.add(name)
        sense_cats = {c.get("name") for c in (s.get("categories") or []) if c.get("name")}
        if not seen_first:
            first_cats = sense_cats | set(tags)
            seen_first = True
        target = secondary if tags & DEPRIORITISE_TAGS else primary
        for g in gl:
            parts = split_gloss(g)
            target.extend(parts)
            if tags & SWISS_TAGS:
                swiss.extend(parts)
    seen, out = set(), []
    for g in primary + secondary:
        low = g.lower()
        if low and low not in seen:
            seen.add(low)
            out.append(g)
    return out, cats, first_cats, [g for g in swiss if g]


def _extract_examples(senses: list[dict], limit: int = 4) -> list[tuple[str, str]]:
    """Wiktionary's own example sentences, which are sense-matched and translated.

    Only about 7% of entries have any, so these are a high-quality seed rather
    than a complete source; Tatoeba fills the rest in.
    """
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for s in senses:
        tags = set(s.get("tags") or [])
        if tags & NON_LEMMA_TAGS:
            continue
        for ex in s.get("examples") or []:
            fr = (ex.get("text") or "").strip()
            en = (ex.get("english") or ex.get("translation") or "").strip()
            if not fr or not en or len(fr) > 200:
                continue
            key = fr.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append((fr, en))
            if len(out) >= limit:
                return out
    return out


def _is_lemma(entry: dict) -> bool:
    senses = entry.get("senses") or []
    if not senses:
        return False
    for s in senses:
        tags = set(s.get("tags") or [])
        if not (tags & NON_LEMMA_TAGS) and not s.get("form_of") and not s.get("alt_of"):
            if s.get("glosses") or s.get("raw_glosses"):
                return True
    return False


def _forms(entry: dict) -> list[str]:
    out = []
    for f in entry.get("forms") or []:
        form = (f.get("form") or "").strip()
        tags = set(f.get("tags") or [])
        if not form or " " in form or len(form) < 2:
            continue
        if tags & {"table-tags", "inflection-template", "class"}:
            continue
        if form in {"no-table-tags", "fr-conj-auto"}:
            continue
        out.append(form)
    return out




def _entry_from_dict(d: dict, cfg: Config) -> Entry | None:
    if d.get("lang_code") != "fr":
        return None
    pos = d.get("pos") or ""
    if pos in SKIP_POS or pos not in KEEP_POS:
        return None
    if not _is_lemma(d):
        return None
    glosses, cats, first_cats, swiss_glosses = _extract_glosses(d.get("senses") or [])
    if not glosses:
        return None
    ipa, audio = _extract_sounds(d, cfg)
    table = None
    if pos == "verb":
        built = conj.build(d["word"], d.get("forms") or [])
        table = built.as_dict() if built else None
    return Entry(
        word=d["word"],
        pos=pos,
        gender=_gender_from_head(d) or _gender_from_senses(d.get("senses") or []),
        ipa=ipa,
        glosses=glosses,
        categories=cats,
        audio=audio,
        forms=_forms(d),
        swiss=bool(first_cats & (SWISS_CATEGORIES | SWISS_TAGS)),
        swiss_glosses=swiss_glosses,
        conjugation=table,
        examples=_extract_examples(d.get("senses") or []),
    )


def iter_entries(path: Path, cfg: Config = DEFAULT, wanted: set[str] | None = None) -> Iterator[Entry]:
    """Stream lemma entries, optionally restricted to a set of headwords.

    Every line is parsed. A substring prefilter looked tempting but kaikki lines
    contain nested "word" keys (synonyms, derived terms), so it silently dropped
    and mixed up entries.
    """
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if wanted is not None and d.get("word") not in wanted:
                continue
            e = _entry_from_dict(d, cfg)
            if e is not None:
                yield e


def merge_entries(entries: Iterator[Entry]) -> dict[tuple[str, str], Entry]:
    """Collapse the several kaikki lines that share a (headword, POS).

    Wiktionary splits by etymology, so "chat" the animal and "chat" the chatroom
    are separate lines. For a flashcard they are one card with both meanings.
    """
    out: dict[tuple[str, str], Entry] = {}
    for e in entries:
        key = (e.word, e.pos)
        cur = out.get(key)
        if cur is None:
            out[key] = e
            continue
        seen = {g.lower() for g in cur.glosses}
        cur.glosses.extend(g for g in e.glosses if g.lower() not in seen)
        cur.categories |= e.categories
        # Do not OR the Swiss flag. "vie" has a second, Swiss-only etymology
        # ("way, path"); that must not label the ordinary word as a Helvetism.
        cur.gender = cur.gender or e.gender
        cur.ipa = cur.ipa or e.ipa
        cur.swiss_glosses = list(dict.fromkeys(cur.swiss_glosses + e.swiss_glosses))
        cur.conjugation = cur.conjugation or e.conjugation
        known_ex = {f.lower() for f, _ in cur.examples}
        cur.examples.extend(x for x in e.examples if x[0].lower() not in known_ex)
        known = {a.url for a in cur.audio}
        cur.audio.extend(a for a in e.audio if a.url not in known)
        cur.audio.sort(key=lambda a: (a.region_rank, a.source != "lingualibre"))
        cur.forms = list(dict.fromkeys(cur.forms + e.forms))
    return out
