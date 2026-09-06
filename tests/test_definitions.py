"""French definitions, read off extract lines small enough to see."""
import json

from frcog.definitions import clean, scan, senses_of


def test_pointer_senses_are_not_definitions():
    entry = {"senses": [
        {"glosses": ["Pluriel de bug."], "tags": ["plural", "form-of"]},
        {"glosses": ["Petit insecte."]},
        {"glosses": ["Défaut dans un programme."]},
        {"glosses": ["Petit insecte."]},          # repeated across etymologies
    ]}
    assert senses_of(entry) == ["Petit insecte.", "Défaut dans un programme."]


def test_one_line_per_sense_and_a_cap():
    entry = {"senses": [{"glosses": [f"Sens {i}.", "Et sa précision."]} for i in range(6)]}
    assert senses_of(entry) == ["Sens 0.", "Sens 1.", "Sens 2."]


def test_a_long_gloss_is_cut_where_a_sentence_ends():
    long = "Première phrase assez longue pour dépasser la limite " * 4 + ". Deuxième phrase."
    out = clean(long)
    assert out.endswith(".")
    assert len(out) < len(long)
    assert clean("  espaces   multiples  ") == "espaces multiples"


def test_scan_keeps_only_the_pairs_asked_for(tmp_path):
    lines = [
        {"word": "bug", "pos": "noun", "lang_code": "fr",
         "senses": [{"glosses": ["Petit insecte."]}]},
        {"word": "bug", "pos": "noun", "lang_code": "fr",
         "senses": [{"glosses": ["Défaut dans un programme."]}]},
        {"word": "bug", "pos": "verb", "lang_code": "fr", "senses": [{"glosses": ["Verbe."]}]},
        {"word": "bug", "pos": "noun", "lang_code": "en", "senses": [{"glosses": ["English."]}]},
        {"word": "table", "pos": "noun", "lang_code": "fr", "senses": [{"glosses": ["Meuble."]}]},
    ]
    p = tmp_path / "x.jsonl"
    p.write_text("\n".join(json.dumps(l, ensure_ascii=False) for l in lines) + "\n", encoding="utf-8")
    found = scan(p, {("bug", "noun"), ("chat", "noun")}, log=lambda *a: None)
    assert found == {("bug", "noun"): ["Petit insecte.", "Défaut dans un programme."]}
