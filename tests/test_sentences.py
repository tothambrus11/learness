"""Reading a tense off running text: what the context rules accept and refuse."""
import pytest

from frcog import sentences as S

tok = S.tokenize


@pytest.mark.parametrize("gid, person, text, ok", [
    ("pres", 0, "Je mange une pomme.", True),
    ("pres", 0, "Je ne le mange pas.", True),         # clitics between are fine
    ("pres", 2, "Je mange une pomme.", False),        # wrong person
    ("pres", 0, "Il faut que je mange.", False),      # "que je" is where the subjonctif hides
    ("pres", 0, "La pomme que mange Paul.", False),   # no subject pronoun
    ("subj", 0, "Il faut que je mange.", True),
    ("subj", 0, "Je mange une pomme.", False),
    ("subj", 2, "Il faut qu'il mange.", True),        # qu' splits off as a token
    ("imper", 1, "Mange ta soupe !", True),
    ("imper", 1, "Ne mange pas ça.", True),
    ("imper", 1, "Tu mange ta soupe.", False),
    ("imper", 1, "Mange-t-il ta soupe ?", False),     # an inverted question, not an order
    ("imper", 1, "Mange-le !", True),
    ("pres", 2, "Lis ce livre !", False),             # "ce" is not a subject here
])
def test_context_rules(gid, person, text, ok):
    toks = tok(text)
    at = toks.index("mange") if "mange" in toks else toks.index("livre")
    assert S.context_ok(gid, person, toks, at, raw=text) is ok


def test_learned_triggers_gate_the_subjonctif():
    toks = tok("Je pense que je mange trop.")
    at = toks.index("mange")
    assert S.context_ok("subj", 0, toks, at, triggers={"faut"}) is False
    toks = tok("Il faut que je mange.")
    assert S.context_ok("subj", 0, toks, toks.index("mange"), triggers={"faut"}) is True


def _table():
    row = lambda f: {"p": "", "s": "", "e": f, "f": f, "alt": False, "dup": False}
    return {
        "lemma": "payer", "aux": "avoir",
        "groups": [
            {"id": "pres", "rows": [row("paie"), row("paies"), row("paie"),
                                    row("payons"), row("payez"), row("paient")],
             "shares": ["subj"]},
            {"id": "subj", "rows": [row("paie"), row("paies"), row("paie"),
                                    row("payions"), row("payiez"), row("paient")],
             "shares": ["pres"]},
        ],
        "impersonal": [{"label": "Participe passé", "form": "payé"}],
        "compound": [{"id": "pc", "aux_key": "pres"}],
    }


def test_cells_know_what_they_collide_with():
    owners = {"paie": {"payer|verb", "paie|noun"}, "payons": {"payer|verb"}}
    cells = S.cells_of(_table(), owners, "payer")
    je = next(c for c in cells if c.gid == "pres" and c.person == 0)
    assert je.shared_lemma == ["paie|noun"] and je.shared_tense == ["subj"]
    nous = next(c for c in cells if c.gid == "pres" and c.person == 3)
    assert nous.sure


def test_a_shared_form_needs_context_and_is_marked():
    corpus = S.Corpus.build([
        ("Ma paie arrive demain.", "My pay comes tomorrow."),
        ("Je paie toujours en espèces.", "I always pay cash."),
        ("Nous payons trop d'impôts.", "We pay too much tax."),
    ])
    owners = {"paie": {"payer|verb", "paie|noun"}}
    cells = S.cells_of(_table(), owners, "payer")
    je = next(c for c in cells if c.gid == "pres" and c.person == 0)
    found = S.examples_for(je, corpus)
    assert [e.fr for e in found] == ["Je paie toujours en espèces."]
    assert not found[0].sure
    nous = next(c for c in cells if c.gid == "pres" and c.person == 3)
    assert S.examples_for(nous, corpus)[0].sure


def test_compound_examples_need_the_auxiliary_right_before_the_participle():
    corpus = S.Corpus.build([
        ("J'ai payé la note.", "I paid the bill."),
        ("Le travail payé est rare.", "Paid work is scarce."),
    ])
    aux = {"avoir": {"groups": [{"id": "pres", "rows": [
        {"f": "ai"}, {"f": "as"}, {"f": "a"}, {"f": "avons"}, {"f": "avez"}, {"f": "ont"}]}]}}
    found = S.compound_examples(_table(), aux, corpus)
    assert [(e.gid, e.form, e.fr) for e in found] == [("pc", "ai payé", "J'ai payé la note.")]


def test_choose_prefers_sure_short_and_varied():
    ex = lambda f, fr, sure, n, sid: S.Example("pres", f, fr, "", sure, n, sid)
    picked = S.choose([
        ex("vais", "long sure", True, 9, 1),
        ex("vais", "short sure", True, 3, 2),
        ex("va", "context", False, 2, 3),
        ex("allons", "other form", True, 8, 4),
    ], used=set(), limit=3)
    assert [e.fr for e in picked] == ["short sure", "other form", "context"]
