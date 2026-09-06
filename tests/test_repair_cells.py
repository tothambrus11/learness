"""A mis-spelt cell in a verb table, mended from the table and the corpus."""
from frcog.sentences import Corpus, repair_cells

CORPUS = Corpus.build([
    ("Tu vaux mieux que ça.", "x"), ("Ça vaut le coup.", "x"), ("Tu vaux de l'or.", "x"),
    ("Tu vaux bien ça.", "x"),
    ("Tu manges trop.", "x"), ("Mange ta soupe.", "x"),
    ("Va voir ailleurs.", "x"), ("Tu vas bien.", "x"),
    ("Tu sais tout.", "x"), ("Sache que je t'aime.", "x"),
    ("Tu commentes tout.", "x"),                       # once: the -er verb's présent, never its impératif
])


def table(imper, pres):
    rows = lambda forms, ps: [{"p": p, "s": "", "e": f, "f": f} for p, f in zip(ps, forms)]
    return {"groups": [
        {"id": "pres", "rows": rows(pres, ["je", "tu", "il", "nous", "vous", "ils"])},
        {"id": "imper", "rows": rows(imper, ["(tu)", "(nous)", "(vous)"])},
    ]}


def test_the_slip_takes_the_attested_spelling():
    t = {"valoir": table(["vaus", "valons", "valez"], ["vaux", "vaux", "vaut", "valons", "valez", "valent"])}
    fixed = repair_cells(t, CORPUS)
    assert fixed == ["valoir: impératif (tu) vaus -> vaux"]
    assert t["valoir"]["groups"][1]["rows"][0]["f"] == "vaux"


def test_a_real_difference_is_left_alone():
    """"mange" is one letter from "manges" but people write it; "va" from
    "vas" likewise; "sache" is nowhere near "sais"."""
    t = {
        "manger": table(["mange", "mangeons", "mangez"], ["mange", "manges", "mange", "mangeons", "mangez", "mangent"]),
        "aller": table(["va", "allons", "allez"], ["vais", "vas", "va", "allons", "allez", "vont"]),
        "savoir": table(["sache", "sachons", "sachez"], ["sais", "sais", "sait", "savons", "savez", "savent"]),
    }
    assert repair_cells(t, CORPUS) == []
    assert t["manger"]["groups"][1]["rows"][0]["f"] == "mange"


def test_a_rare_er_verb_keeps_its_impératif():
    """"commente" is one letter from "commentes", and the corpus has seen the
    présent once and the impératif never — which is what a rare verb looks
    like, not a slip. It is also "je commente", a cell of its own table."""
    t = {"commenter": table(["commente", "commentons", "commentez"],
                            ["commente", "commentes", "commente", "commentons", "commentez", "commentent"])}
    assert repair_cells(t, CORPUS) == []
    assert t["commenter"]["groups"][1]["rows"][0]["f"] == "commente"


def test_one_sighting_of_the_present_form_is_not_enough():
    t = {"zorquer": table(["zorqus", "zorquons", "zorquez"],
                          ["zorqux", "zorqux", "zorqut", "zorquons", "zorquez", "zorquent"])}
    thin = Corpus.build([("Tu zorqux bien.", "x"), ("Rien.", "x"), ("Encore rien.", "x")])
    assert repair_cells(t, thin) == []


def test_no_attested_present_form_no_repair():
    """A slip can only be mended toward a spelling the corpus vouches for."""
    t = {"zorquer": table(["zorqus", "zorquons", "zorquez"], ["zorqux", "zorqux", "zorqut", "zorquons", "zorquez", "zorquent"])}
    assert repair_cells(t, CORPUS) == []
