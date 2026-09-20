"""The dictionary: every glossed word, whether or not the ranking kept it.

It is what the words screen fills a form from when a lesson hands the learner a
word the curriculum does not have. So what it must get right is small and
exact: the word as a card would show it, article and all, and never an article
that was guessed.
"""
from __future__ import annotations

import json

from frcog import dictionary
from frcog.db import connect
from frcog.kaikki import Entry


def entry(word: str, pos: str = "noun", **kw) -> Entry:
    kw.setdefault("glosses", ["a thing"])
    return Entry(word=word, pos=pos, **kw)


def test_a_noun_is_shown_with_its_article_like_every_other_card():
    assert dictionary.display_form(entry("chaussette", gender="f", ipa="/ʃo.sɛt/")) \
        == "la chaussette"
    assert dictionary.display_form(entry("vélo", gender="m", ipa="/ve.lo/")) == "le vélo"
    assert dictionary.display_form(entry("élève", gender="mf", ipa="/e.lɛv/")) == "l'élève", \
        "a vowel onset elides, and either gender does not change that"


def test_a_word_whose_article_nobody_can_settle_is_offered_without_one():
    """"le héros" and "l'hôtel" look alike and nothing in the spelling separates
    them. The curriculum asks fr.wiktionary; a hundred thousand words cannot be
    asked one at a time, so the dictionary offers the bare word — the learner is
    looking at it and can say which it is — rather than teaching a guess."""
    assert dictionary.display_form(entry("héros", gender="m", ipa="/e.ʁo/")) == "héros"


def test_only_nouns_carry_an_article():
    assert dictionary.display_form(entry("plonger", pos="verb", ipa="/plɔ̃.ʒe/")) == "plonger"
    assert dictionary.display_form(entry("vite", pos="adv")) == "vite"
    assert dictionary.display_form(entry("truc", pos="noun", gender=None)) == "truc", \
        "a noun with no gender has no article to show"


def test_a_row_is_what_a_form_needs_and_nothing_that_implies_a_ranking():
    row = dictionary.row(entry("chaussette", gender="f", ipa="/ʃo.sɛt/",
                               glosses=["sock", "windsock"]))
    assert row == ("chaussette", "noun", "la chaussette", "f", "/ʃo.sɛt/",
                   json.dumps(["sock", "windsock"], ensure_ascii=False), None), \
        "and no table: a noun has none, and the column is the one thing kept past the form (#91)"


def test_a_word_with_no_english_is_not_a_dictionary_entry():
    """A headword the extract carries for another language's sake. A card made
    from one could not be asked in either direction."""
    assert dictionary.row(entry("truc", glosses=[])) is None
    assert dictionary.row(entry("truc", glosses=["  "])) is None
    assert dictionary.row(entry("", glosses=["thing"])) is None


def test_only_the_first_few_senses_travel():
    row = dictionary.row(entry("coup", gender="m",
                               glosses=[f"sense {i}" for i in range(8)]))
    assert row is not None
    assert json.loads(row[5]) == ["sense 0", "sense 1", "sense 2"]


def test_building_it_twice_leaves_one_of_each(tmp_path):
    """The extract is the only source, so a rebuild is the whole answer: a merge
    would keep words a newer dump has dropped."""
    con = connect(tmp_path / "d.db")
    rows = [dictionary.row(entry("chaussette", gender="f")),
            dictionary.row(entry("plonger", pos="verb"))]
    for _ in range(2):
        con.execute("DELETE FROM dictionary")
        con.executemany(
            f"INSERT OR REPLACE INTO dictionary ({','.join(dictionary.COLUMNS)}) "
            f"VALUES ({','.join('?' * len(dictionary.COLUMNS))})", rows)
    assert dictionary.count(con) == 2


def test_it_is_read_from_the_extract_a_line_at_a_time(tmp_path):
    """The same file the ranking is built from, read for what the ranking threw
    away: `iter_entries` with nothing wanted is every lemma in it."""
    lines = [
        {"word": "chaussette", "lang_code": "fr", "pos": "noun",
         "senses": [{"glosses": ["sock"], "tags": ["feminine"]}],
         "sounds": [{"ipa": "/ʃo.sɛt/"}]},
        # Not French: the extract is one language, but the reader says so.
        {"word": "sock", "lang_code": "en", "pos": "noun", "senses": [{"glosses": ["a sock"]}]},
        # An inflected form, not a headword.
        {"word": "chaussettes", "lang_code": "fr", "pos": "noun",
         "senses": [{"glosses": ["plural of chaussette"], "tags": ["plural", "form-of"],
                     "form_of": [{"word": "chaussette"}]}]},
    ]
    path = tmp_path / "extract.jsonl"
    path.write_text("\n".join(json.dumps(line, ensure_ascii=False) for line in lines) + "\n")

    con = connect(tmp_path / "d.db")
    written = dictionary.build(con, path, log=lambda *_: None)
    assert written == 1
    stored = con.execute("SELECT lemma, display, gender FROM dictionary").fetchall()
    assert [tuple(r) for r in stored] == [("chaussette", "la chaussette", "f")]


def test_a_verb_keeps_its_table_and_nothing_else_does():
    """A verb added from the dictionary is a verb like any other to the
    learner, so its table comes along (#91) -- the same one the curriculum's
    verbs carry, built from the same entry. A noun has none to keep."""
    table = {"lemma": "plonger", "groups": []}
    verb = dictionary.row(entry("plonger", pos="verb", conjugation=table))
    assert verb is not None and json.loads(verb[-1]) == table
    noun = dictionary.row(entry("chaussette", gender="f", conjugation=table))
    assert noun is not None and noun[-1] is None, "a table on a noun is a mistake upstream, not a fact to ship"
