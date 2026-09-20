"""Central configuration. Every tunable in one place."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
MEDIA = DATA / "media"
BUILD = DATA / "build"
DB_PATH = DATA / "french.db"
APP_DIR = ROOT / "app"
#: What every generated thing was made from — the pins on the dumps below and
#: the fingerprint of each pipeline stage. Committed; `recipe.py` reads and
#: writes it, `frcog refresh` brings the data up to it.
RECIPE_PATH = DATA / "recipe.json"


@dataclass(frozen=True)
class Source:
    """One upstream dump the pipeline reads, kept as `data/raw/<file>` and
    fetched from `url`. The registry below is the only place a dump is named;
    the fetch, the pins and the stage recipes all go through it."""
    file: str
    url: str
    about: str


_KAIKKI = "https://kaikki.org"
_TATOEBA = "https://downloads.tatoeba.org/exports/per_language"

#: Every dump, by the name the recipe pins it under. None of these upstreams
#: versions its files — kaikki.org and Tatoeba overwrite the same URL on
#: every export — so a pin can only say that the file on disk is the one the
#: recipe was made from, never fetch that one again once it is gone.
SOURCES: dict[str, Source] = {
    "kaikki-fr": Source(
        "kaikki-fr.jsonl", f"{_KAIKKI}/dictionary/French/kaikki.org-dictionary-French.jsonl",
        "the English Wiktionary's French entries: glosses, IPA, gender, recordings"),
    # The French Wiktionary's own extract: definitions written in French, for
    # the back of the card. 3 GB, streamed once and read for the words in the deck.
    "kaikki-frwikt": Source(
        "kaikki-frwikt.jsonl",
        f"{_KAIKKI}/frwiktionary/Fran%C3%A7ais/kaikki.org-dictionary-Fran%C3%A7ais.jsonl",
        "the French Wiktionary's own entries: definitions in French"),
    "cmudict": Source(
        "cmudict.dict", "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict",
        "English pronunciations, for how much a word sounds like its English"),
    "fra_sentences": Source("fra_sentences.tsv.bz2", f"{_TATOEBA}/fra/fra_sentences.tsv.bz2",
                            "Tatoeba's French sentences"),
    "eng_sentences": Source("eng_sentences.tsv.bz2", f"{_TATOEBA}/eng/eng_sentences.tsv.bz2",
                            "Tatoeba's English sentences"),
    "fra-eng_links": Source("fra-eng_links.tsv.bz2", f"{_TATOEBA}/fra/fra-eng_links.tsv.bz2",
                            "which English sentence translates which French one"),
}
#: The three files the example sentences come from, together or not at all.
TATOEBA = ("fra_sentences", "eng_sentences", "fra-eng_links")

KAIKKI_PATH = RAW / SOURCES["kaikki-fr"].file
KAIKKI_URL = SOURCES["kaikki-fr"].url
FRWIKT_PATH = RAW / SOURCES["kaikki-frwikt"].file
FRWIKT_URL = SOURCES["kaikki-frwikt"].url

# Study directions. These are the keys used in card_state, reviews and Anki templates.
DIR_READ = "fr_en"        # see French, recall English
DIR_RECALL = "en_fr"      # see English, type French
DIR_LISTEN_FR = "audio_fr"  # hear French, type French
DIR_LISTEN_EN = "audio_en"  # hear French, recall English
DIR_SPEAK = "speak"       # hear English, say French (walking mode)
DIRECTIONS = [DIR_READ, DIR_RECALL, DIR_LISTEN_FR, DIR_LISTEN_EN, DIR_SPEAK]

DIRECTION_LABELS = {
    DIR_READ: "Read FR->EN",
    DIR_RECALL: "Recall EN->FR",
    DIR_LISTEN_FR: "Listen->write FR",
    DIR_LISTEN_EN: "Listen->EN",
    DIR_SPEAK: "Speak (walking)",
}

# A direction unlocks once its prerequisite is mature. DIR_READ is always unlocked.


@dataclass
class Config:
    # --- source selection -------------------------------------------------
    top_n: int = 20000          # how many French words by frequency to consider
    min_zipf: float = 2.5       # drop anything rarer than this
    min_len: int = 2            # drop single-letter clitics ("l", "d", "qu")
    max_words: int = 5000       # how many words to keep in the DB after ranking
    one_pos_per_lemma: bool = True  # one card per spelling; "être" verb beats "être" noun
    pos_form_mass_gap: float = 0.5  # Zipf gap at which inflected-form mass decides the POS

    # --- similarity -------------------------------------------------------
    w_levenshtein: float = 0.6  # blend weight: edit distance
    w_jaro_winkler: float = 0.4  # blend weight: prefix-sensitive, cognates share prefixes
    gate_suffix_rules: bool = True  # only apply -ment<->-ly if the EN side really ends in -ly
    similarity_alpha: float = 1.0   # rank = zipf * similarity**alpha
    secondary_sense_discount: float = 0.88  # per-sense-position decay; a cognate in sense 5 counts less

    # --- ranking ----------------------------------------------------------
    tech_boost: float = 1.15    # multiplier for words in tech/professional sense categories
    core_top_n: int = 500       # the N most frequent words are "core" regardless of similarity
    homograph_penalty: float = 1.0  # Zipf penalty when a headword is also another lemma's inflection
    drop_stopwords: bool = True     # keep grammatical words out of the vocabulary deck
    include_helvetisms: bool = True # force in Swiss words the frequency cut would drop
    core_quota: float = 0.15    # fraction of each level reserved for core words
    level_size: int = 100       # words per level == per Anki subdeck

    # --- audio ------------------------------------------------------------
    tts_voice: str = "fr-CH-ArianeNeural"   # Swiss French; user lives in Valais
    tts_rate: str = "-10%"                  # slightly slow, easier for ear training
    english_voice: str = "af_heart"         # Kokoro voice for the English cue
    english_speed: float = 1.0
    # The silence every clip is brought to at each end: cut down to it where
    # the voice left more, padded up to it where it left less. Players swallow
    # the first few tens of milliseconds while a decoder spins up, so some is
    # kept; edge-tts left over a second, and the button felt slow (#68).
    lead_silence_ms: int = 150
    tail_silence_ms: int = 150
    prefer_regions: tuple = ("Switzerland", "France", "Paris", "Belgium")
    reject_regions: tuple = ("Canada", "Quebec", "Québec", "Acadia", "Louisiana")
    audio_concurrency: int = 8       # edge-tts, which tolerates parallelism
    native_concurrency: int = 2      # Wikimedia, which does not
    native_rate_limit: float = 1.0   # requests/second shared across threads; it
                                     # answers a burst of ~5 with HTTP 429

    # --- cards ------------------------------------------------------------
    type_with_article: bool = True  # answer "le bug", not "bug", so gender gets drilled

    # --- tech register ----------------------------------------------------
    tech_categories: tuple = (
        "Computing", "Internet", "Software", "Programming", "Mathematics",
        "Physics", "Engineering", "Sciences", "Electronics", "Telecommunications",
        "Business", "Economics", "Finance", "Management", "Statistics", "Networking",
        "Cryptography", "Robotics", "Data", "Linguistics", "Medicine",
    )

    def paths(self) -> dict:
        return {"db": DB_PATH, "media": MEDIA, "build": BUILD, "kaikki": KAIKKI_PATH}


DEFAULT = Config()

#: Which dials reach which stage of the pipeline, for the recipe (`recipe.py`):
#: a stage's fingerprint takes the values of its group, so a new voice re-makes
#: the clips and nothing else, and a new similarity weight re-ranks the deck
#: and leaves the clips alone. A field may sit in more than one group when
#: more than one stage reads it — the silence margins shape the French clips
#: and the English cues alike, and the level size is both where the ranking
#: cuts and what the catalogue says. This file is deliberately outside every
#: stage's code fingerprint; these groups are how a change here is felt.
RECIPE_GROUPS: dict[str, tuple[str, ...]] = {
    "build": (
        "top_n", "min_zipf", "min_len", "max_words", "one_pos_per_lemma", "pos_form_mass_gap",
        "w_levenshtein", "w_jaro_winkler", "gate_suffix_rules", "similarity_alpha",
        "secondary_sense_discount", "tech_boost", "core_top_n", "homograph_penalty",
        "drop_stopwords", "include_helvetisms", "core_quota", "level_size",
        # The region preference ranks the candidate native recordings at
        # build time (kaikki.py); the fetch only takes what the build ranked.
        "prefer_regions", "reject_regions",
        "type_with_article", "tech_categories",
    ),
    "audio": ("tts_voice", "tts_rate", "lead_silence_ms", "tail_silence_ms"),
    "english": ("english_voice", "english_speed", "lead_silence_ms", "tail_silence_ms"),
    "export": ("level_size",),
}

#: The dials that change only how fast a run goes, never what it makes. A
#: field of Config is in a group above or here, and a test says so, so a dial
#: added later cannot be forgotten by the recipe without a test naming it.
UNRECIPED: tuple[str, ...] = ("audio_concurrency", "native_concurrency", "native_rate_limit")
