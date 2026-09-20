"""The catalogue both halves of the project are tested against.

The pipeline writes JSON and the app parses it, field by field, with no
schema in between. So one small catalogue is exported from a seeded database
and checked in under tests/fixtures/catalogue/: pytest compares a fresh
export against it, the app's unit suite loads it as its catalogue and drives
the real readers over it, and the browser suite serves it. A field renamed
on either side fails all three with the same files in the message.

Six words: two that read as English and three that do not, so a sitting has
both entry rungs in it; a verb with a table, which is the only kind of card
with more on it than a word; and one whose recording is gone, for the card
that has to say so. The word ids matter — the import test addresses word 1.

And three function words — sur, sous, dans, each other's contrast partners —
with the sentences they are met in, so the sense channel has a card on every
rung to show: a word has one active card per channel, so three rungs need
three words. They are mined from `FUNCTION_PAIRS` by the same rule the real
corpus is, rather than written into the export by hand.

And four words the ranking never chose, in the dictionary the words screen
fills a form from: one that shares a first letter with a taught word, one that
does not, one that is itself written with an article — which has to be filed
under the word rather than the article, or it is written to one file and looked
for in another — and one that is also in the catalogue, which must be offered
from the catalogue only, never twice.

To refresh the checked-in files after a deliberate change to the export:

    python tests/catalogue_fixture.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

from frcog import function, sentences
from frcog.audio import MIN_BYTES
from frcog.db import connect
from frcog.webexport import export

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "catalogue"

#: A recording the server does not have. It is on the pipeline's disk when
#: the catalogue is exported — the export promises nothing it cannot see —
#: and the browser suite answers it 404, which is how #61 looked from the
#: app: a rebuild's clips made on one machine, never committed, and named in
#: a catalogue that was. The card has to say so, and the warm-up has to name
#: the file.
MISSING_CLIP = "gone.mp3"

PARLER = {
    "lemma": "parler", "aux": "avoir", "shape": "regular -er",
    "groups": [{
        "id": "pres", "mood": "Indicatif", "tense": "Présent", "stem": "parl",
        "irregular": False, "note": "",
        "rows": [
            {"p": "je", "s": "parl", "e": "e", "f": "parle", "alt": False, "dup": False},
            {"p": "tu", "s": "parl", "e": "es", "f": "parles", "alt": False, "dup": False},
            {"p": "il", "s": "parl", "e": "e", "f": "parle", "alt": False, "dup": True},
            {"p": "nous", "s": "parl", "e": "ons", "f": "parlons", "alt": False, "dup": False},
            {"p": "vous", "s": "parl", "e": "ez", "f": "parlez", "alt": False, "dup": False},
            {"p": "ils", "s": "parl", "e": "ent", "f": "parlent", "alt": False, "dup": False},
        ],
    }],
    "compound": [], "impersonal": [{"label": "Infinitif", "form": "parler"}], "links": [],
}

# (id, lemma, pos, display, gender, ipa, zipf, freq, similarity, phon, rank, level, active)
WORDS = [
    (1, "nation", "noun", "la nation", "f", "/na.sjɔ̃/", 4.5, 0.004, 0.95, 0.3, 1, 1, 1),
    (2, "parler", "verb", "parler", "", "/paʁ.le/", 5.8, 0.006, 0.3, 0.2, 2, 1, 1),
    (3, "jour", "noun", "le jour", "m", "/ʒuʁ/", 5.5, 0.003, 0.2, 0.1, 3, 1, 1),
    (4, "train", "noun", "le train", "m", "/tʁɛ̃/", 4.2, 0.002, 0.9, 0.6, 4, 1, 1),
    (5, "pont", "noun", "le pont", "m", "/pɔ̃/", 4.0, 0.001, 0.1, 0.1, 5, 1, 1),
    (6, "oubli", "noun", "l'oubli", "m", "/u.bli/", 3.5, 0.0005, 0.1, 0.1, 6, 1, 1),
    # Dropped by the last rebuild: active=0, and it must not be exported.
    (7, "galetas", "noun", "le galetas", "m", "/ɡal.ta/", 2.0, 1e-7, 0.1, 0.1, 7, 2, 0),
]

TRANSLATIONS = {
    1: ["nation"], 2: ["to speak", "to talk"], 3: ["day"], 4: ["train"], 5: ["bridge"],
    6: ["oblivion"], 7: ["garret"],
}

# The audio file names the browser suite answers with silence, and the one it
# answers 404.
AUDIO = {1: "w1", 2: "w5", 3: "w2", 4: "w3", 5: "w4"}

# (lemma, pos, display, gender, ipa, glosses)
DICTIONARY = [
    ("chaussette", "noun", "la chaussette", "f", "/ʃo.sɛt/", ["sock"]),
    ("plonger", "verb", "plonger", "", "/plɔ̃.ʒe/", ["to dive", "to plunge"]),
    # Filed under u, not l: the app strips what was typed before it picks a
    # file, and the two have to agree or the fetch is a 404.
    ("l'un", "pron", "l'un", "", "/lœ̃/", ["one (of them)"]),
    # Taught already, as word 3: the export must leave it out, since the
    # catalogue offers it with its audio and its place in the ranking.
    ("jour", "noun", "le jour", "m", "/ʒuʁ/", ["day"]),
]


# Sentences the three function words are found in, three apiece — the least
# the export ships a word with — and one that is not the word at all, so the
# fixture exercises the rule that keeps "sous-titres" out.
FUNCTION_PAIRS = [
    ("Les feuilles tombaient sur le sol.", "The leaves were falling on the ground."),
    ("Le chat dort sur la chaise.", "The cat is sleeping on the chair."),
    ("Un livre sur la guerre.", "A book about the war."),
    ("Il avait laissé le vélo sous la pluie.", "He had left the bike out in the rain."),
    ("Le chien se cache sous la table.", "The dog is hiding under the table."),
    ("Ils vivent sous le même toit.", "They live under the same roof."),
    ("Les sous-titres sont faux.", "The subtitles are wrong."),
    ("Nous avons dormi dans le train.", "We slept on the train."),
    ("Il y a un bug dans le code.", "There is a bug in the code."),
    ("Elle habite dans une petite ville.", "She lives in a small town."),
]


def seed(con: sqlite3.Connection) -> None:
    """Fill an empty database with the fixture."""
    con.executescript(sentences.SCHEMA)
    function.attach(con, sentences.Corpus.build(FUNCTION_PAIRS), log=lambda *_: None)
    with con:
        for (wid, lemma, pos, display, gender, ipa, zipf, freq, sim, phon, rank, level,
             active) in WORDS:
            con.execute(
                """INSERT INTO words (id, lemma, pos, display_form, type_answer, gender, ipa,
                     zipf, freq_linear, similarity, phon_similarity, rank, level, active)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (wid, lemma, pos, display, display, gender, ipa, zipf, freq, sim, phon, rank,
                 level, active))
        for wid, trs in TRANSLATIONS.items():
            con.executemany(
                "INSERT INTO translations (word_id, english, is_primary, sense_index) "
                "VALUES (?,?,?,?)",
                [(wid, t, int(i == 0), i) for i, t in enumerate(trs)])
        for wid, stem in AUDIO.items():
            con.execute("INSERT INTO audio (word_id, path, source, is_primary) VALUES (?,?,?,1)",
                        (wid, f"{stem}.mp3", "tts"))
            con.execute("INSERT INTO audio (word_id, path, source) VALUES (?,?,?)",
                        (wid, f"{stem}-en.mp3", "tts-en"))
        con.execute("INSERT INTO audio (word_id, path, source, is_primary) VALUES (6,?,?,1)",
                    (MISSING_CLIP, "tts"))
        con.execute("INSERT INTO audio (word_id, path, source) VALUES (6,?,?)",
                    (MISSING_CLIP, "tts-en"))
        con.execute("UPDATE words SET definitions=? WHERE id=1",
                    (json.dumps(["Communauté humaine établie sur un territoire."]),))
        con.execute("UPDATE words SET conjugation=? WHERE id=2", (json.dumps(PARLER),))
        # One line of the table with a sentence, a sentence in each of two past
        # tenses with no time word in it — the which-time card deals only
        # those — and a sentence for the cloze rung.
        con.execute(
            "INSERT INTO examples (word_id,tense,form,fr,en,sure,source,n) VALUES (?,?,?,?,?,?,?,?)",
            (2, "pres", "parlons", "Nous parlons français.", "We speak French.", 1,
             sentences.SOURCE, 0))
        con.execute(
            "INSERT INTO examples (word_id,tense,form,fr,en,sure,source,n) VALUES (?,?,?,?,?,?,?,?)",
            (2, "pc", "a parlé", "Elle a parlé au directeur.", "She spoke to the manager.", 1,
             sentences.SOURCE, 0))
        con.execute(
            "INSERT INTO examples (word_id,tense,form,fr,en,sure,source,n) VALUES (?,?,?,?,?,?,?,?)",
            (2, "imp", "parlait", "Il parlait doucement.", "He was speaking softly.", 1,
             sentences.SOURCE, 0))
        con.execute(
            "INSERT INTO examples (word_id,tense,form,fr,en,sure,source,n) VALUES (?,?,?,?,?,?,?,?)",
            (2, sentences.WORD_TENSE, "parle", "Il parle trop vite.", "He talks too fast.", 1,
             sentences.SOURCE_WORD, 0))
        con.execute(
            "INSERT INTO examples (word_id,tense,form,fr,en,sure,source,n) VALUES (?,?,?,?,?,?,?,?)",
            (3, sentences.WORD_TENSE, "jour", "Quel beau jour !", "What a beautiful day!", 1,
             sentences.SOURCE_WORD, 0))
        con.executemany(
            "INSERT INTO dictionary (lemma,pos,display,gender,ipa,english) VALUES (?,?,?,?,?,?)",
            [(lemma, pos, display, gender, ipa, json.dumps(en, ensure_ascii=False))
             for lemma, pos, display, gender, ipa, en in DICTIONARY])


def seeded(path: Path) -> sqlite3.Connection:
    con = connect(path)
    seed(con)
    return con


def media_for(con: sqlite3.Connection, media: Path) -> Path:
    """A media directory holding every recording the database names.

    The export names a recording only when its file is there, so a test of
    the catalogue's shape needs the files to exist — a few hundred bytes of
    nothing each, which is all the export looks at. A test about a recording
    that is *not* there removes it from what this made.
    """
    media.mkdir(parents=True, exist_ok=True)
    for r in con.execute("SELECT DISTINCT path FROM audio WHERE path IS NOT NULL"):
        (media / r["path"]).write_bytes(b"\0" * (MIN_BYTES + 1))
    return media


#: What the fixture says it was made from. A real catalogue carries the hash
#: of the pipeline's recipe; this one is made by a test, and says so.
RECIPE = "fixture"


def exported(con: sqlite3.Connection, out_dir: Path) -> dict[str, dict]:
    """The export, read back. The recordings the database names are laid out
    beside it first, and the recipe is the fixture's own, so two exports of
    the fixture compare equal."""
    out = export(con, out_dir, log=lambda *_: None, media=media_for(con, out_dir.parent / "media"),
                 recipe=RECIPE)
    return {path.name: json.loads(path.read_text()) for path in sorted(out.glob("*.json"))}


def write_fixture(out_dir: Path = FIXTURE_DIR) -> list[Path]:
    """Refresh the checked-in files from a fresh export."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        con = seeded(Path(tmp) / "fixture.db")
        files = exported(con, Path(tmp) / "catalogue")
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.json"):
        stale.unlink()
    written = []
    for name, data in files.items():
        path = out_dir / name
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
        written.append(path)
    return written


if __name__ == "__main__":
    for p in write_fixture():
        print(p.relative_to(Path.cwd()) if p.is_relative_to(Path.cwd()) else p, file=sys.stderr)
