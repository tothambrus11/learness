"""The verb tables are read off Wiktionary, never generated. These tests pin
down what the reader does with what Wiktionary lists."""
from frcog import conjugation as conj


def _f(form, *tags):
    return {"form": form, "tags": list(tags), "source": "conjugation"}


PRES = ("indicative", "present")


def _payer():
    return [
        _f("payer", "infinitive"),
        _f("payant", "participle", "present"),
        _f("payé", "participle", "past"),
        _f("paye", "first-person", "singular", *PRES),
        _f("paie", "first-person", "singular", *PRES),
        _f("/pɛ/", "first-person", "singular", *PRES),
        _f("payes", "second-person", "singular", *PRES),
        _f("paies", "second-person", "singular", *PRES),
        _f("paye", "third-person", "singular", *PRES),
        _f("paie", "third-person", "singular", *PRES),
        _f("payons", "first-person", "plural", *PRES),
        _f("payez", "second-person", "plural", *PRES),
        _f("payent", "third-person", "plural", *PRES),
        _f("paient", "third-person", "plural", *PRES),
        _f("paye", "first-person", "singular", "present", "subjunctive"),
        _f("paie", "first-person", "singular", "present", "subjunctive"),
        _f("payions", "first-person", "plural", "present", "subjunctive"),
        _f("payions", "first-person", "plural", "indicative", "imperfect"),
        _f("paye", "imperative", "second-person", "singular"),
        _f("paie", "imperative", "second-person", "singular"),
        _f("avoir + past participle", "infinitive", "multiword-construction"),
    ]


def test_every_spelling_of_a_cell_is_kept():
    t = conj.build("payer", _payer()).as_dict()
    pres = next(g for g in t["groups"] if g["id"] == "pres")
    je = pres["rows"][0]
    assert je["f"] == "paye"
    assert je["also"] == ["paie"]
    assert "also" not in pres["rows"][3]           # payons has one spelling
    assert conj.cell_forms(je) == ["paye", "paie"]


def test_pronunciations_and_placeholders_are_not_forms():
    forms = _payer() + [
        _f("pø", "first-person", "plural", "future", "indicative"),   # kaikki's IPA, no slashes
        _f("-", "first-person", "plural", "imperative"),             # a cell the verb lacks
        _f("payerons", "first-person", "plural", "future", "indicative"),
    ]
    t = conj.build("payer", forms).as_dict()
    fut = next(g for g in t["groups"] if g["id"] == "fut")
    assert conj.cell_forms(fut["rows"][3]) == ["payerons"]
    imper = next(g for g in t["groups"] if g["id"] == "imper")
    assert imper["rows"][1] is None                 # not a row reading "-"
    assert not conj.is_spelling("pɥis") and not conj.is_spelling("—")
    assert conj.is_spelling("haïssent")
    assert not conj.is_spelling("m'appelle") and not conj.is_spelling("appelle-toi")


def test_tenses_spelt_alike_are_marked_on_the_table():
    t = conj.build("payer", _payer()).as_dict()
    by = {g["id"]: g for g in t["groups"]}
    assert "subj" in by["pres"]["shares"] and "imper" in by["pres"]["shares"]
    assert set(by["subj"]["shares"]) == {"pres", "imp", "imper"}   # paye; payions
    assert by["imp"]["shares"] == ["subj"]


def test_compound_tenses_carry_an_id_and_the_auxiliary_tense():
    t = conj.build("payer", _payer()).as_dict()
    pc = t["compound"][0]
    assert (pc["id"], pc["aux_key"], pc["example"]) == ("pc", "pres", "j'ai payé")
