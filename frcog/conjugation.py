"""Build a categorised conjugation table for a French verb.

Wiktionary gives every form with a tag set (person, number, mood, tense). This
turns that flat list into the tables a learner actually wants, and marks what
differs between the forms:

* Within a tense, the shared **stem** is separated from the **ending**, because
  the endings are what you memorise and the stem is what you already know.
* A form whose stem departs from the rest of its tense is flagged. That is the
  whole story of *aller*: v- in four forms, all- in nous/vous.
* A tense with no shared stem at all is flagged irregular rather than forced
  into a split that would be a lie (*être*: suis, es, est, sommes, êtes, sont).
* Forms that are identical to another form in the same tense are marked, since
  those collisions are exactly where comprehension breaks.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

MIN_STEM = 2   # a one-letter shared prefix is a coincidence, not a stem

PERSON_TAGS = {"first-person": 0, "second-person": 1, "third-person": 2}
NUMBER_TAGS = {"singular": 0, "plural": 1}

# Tense selection. Each entry: (id, mood, tense, required tags, forbidden tags, note)
SIMPLE_TENSES = [
    ("pres",   "Indicatif",   "Présent",     {"indicative", "present"}, {"imperfect", "future", "historic", "past", "subjunctive", "perfect"}, ""),
    ("imp",    "Indicatif",   "Imparfait",   {"indicative", "imperfect"}, {"subjunctive", "perfect"}, ""),
    ("fut",    "Indicatif",   "Futur simple", {"indicative", "future"}, {"perfect"}, ""),
    ("cond",   "Conditionnel", "Présent",    {"conditional"}, {"perfect"}, ""),
    ("subj",   "Subjonctif",  "Présent",     {"subjunctive", "present"}, {"imperfect", "past", "pluperfect"}, ""),
    ("imper",  "Impératif",   "Présent",     {"imperative"}, set(), ""),
    ("hist",   "Indicatif",   "Passé simple", {"indicative", "historic", "past"}, {"anterior"}, "literary; you read it, you do not say it"),
    ("subjimp", "Subjonctif", "Imparfait",   {"subjunctive", "imperfect"}, {"pluperfect"}, "literary; recognition only"),
]

PRONOUNS = ["je", "tu", "il", "nous", "vous", "ils"]
SUBJ_PRONOUNS = ["que je", "que tu", "qu'il", "que nous", "que vous", "qu'ils"]
IMPER_PRONOUNS = ["(tu)", "(nous)", "(vous)"]
VOWELS = tuple("aàâeéèêëiîïoôuùûy")   # h is deliberately absent: see _elide

# 1sg of each auxiliary, for the worked example in the compound-tense panel.
AUX_FIRST_SINGULAR = {
    "avoir": {"pres": "ai", "imp": "avais", "fut": "aurai", "cond": "aurais", "subj": "aie"},
    "être": {"pres": "suis", "imp": "étais", "fut": "serai", "cond": "serais", "subj": "sois"},
}
# (id, label, tense of the auxiliary, note)
COMPOUND_TENSES = [
    ("pc",    "Passé composé",      "pres", "the everyday past: I washed, I have washed"),
    ("pqp",   "Plus-que-parfait",   "imp",  "had already happened before something else"),
    ("futant", "Futur antérieur",   "fut",  "will have happened by then"),
    ("condp", "Conditionnel passé", "cond", "would have happened"),
    ("subjp", "Subjonctif passé",   "subj", "after que, for something completed"),
]

# What a simple verb form is spelt with: letters, nothing else. kaikki lists a
# pronunciation ("pø", "pɥis") under the same tags as the spelling it belongs
# to, with nothing else to tell them apart; marks a cell a verb does not have
# with a dash; and lists a reflexive verb's clitic spellings ("m'appelle",
# "appelle-toi") without always tagging them reflexive. None of those is a
# form of the plain verb.
_SPELLING = re.compile(r"^[a-zàâäæçéèêëîïôöœùûüÿ]+$", re.IGNORECASE)


def is_spelling(form: str) -> bool:
    return bool(form) and form not in {"-", "—", "–"} and bool(_SPELLING.match(form))


def _elide(pronoun: str, form: str, h_elides: bool | None = None) -> str:
    """je + ai -> j'ai. Only "je" and "que" elide in these tables.

    A form starting with a vowel letter always elides. A form starting with h
    is the one case spelling cannot answer -- "j'hésite" but "je hais" -- so it
    is answered by `h_elides`, which the caller looks up rather than infers. A
    verb whose h nobody has classified does not elide here and is dropped from
    the deck upstream, so the guess never reaches a card.
    """
    if not form:
        return pronoun
    first = form[0].lower()
    elides = first.startswith(VOWELS) or (first == "h" and bool(h_elides))
    if elides and pronoun in ("je", "que je"):
        return "j'" if pronoun == "je" else "que j'"
    return pronoun + " "


def _slot(tags: set[str]) -> int | None:
    """Map person+number tags onto 0..5 (je, tu, il, nous, vous, ils)."""
    person = next((v for k, v in PERSON_TAGS.items() if k in tags), None)
    number = next((v for k, v in NUMBER_TAGS.items() if k in tags), None)
    if person is None or number is None:
        return None
    return person + 3 * number


def _longest_common_prefix(words: list[str]) -> str:
    if not words:
        return ""
    out = words[0]
    for w in words[1:]:
        i = 0
        while i < len(out) and i < len(w) and out[i] == w[i]:
            i += 1
        out = out[:i]
        if not out:
            break
    return out


INFINITIVE_ENDINGS = ("oir", "er", "ir", "re")   # -oir before -ir, or "pouvoir" reads as -ir


def _infinitive_stem(lemma: str) -> str:
    for end in INFINITIVE_ENDINGS:
        if lemma.endswith(end) and len(lemma) > len(end) + 1:
            return lemma[: -len(end)]
    return ""


def _dominant_prefix(forms: list[str], need: int) -> str:
    """Longest prefix shared by at least `need` of the forms."""
    if not forms:
        return ""
    for length in range(max(len(f) for f in forms), 0, -1):
        best = ""
        for f in forms:
            if len(f) < length:
                continue
            p = f[:length]
            if sum(1 for g in forms if g.startswith(p)) >= need:
                if len(p) > len(best):
                    best = p
        if best:
            return best
    return ""


def analyse(forms: list[str], lemma: str) -> tuple[str, list[bool], bool]:
    """Return (stem, per-form stem-change flags, irregular).

    A stem shared by every form is used as-is. Otherwise a stem shared by a
    majority is used and the rest are flagged. If not even a majority agrees,
    the tense is irregular and nothing is split.
    """
    present = [f for f in forms if f]
    if not present:
        return "", [False] * len(forms), False
    lcp = _longest_common_prefix(present)
    if len(lcp) >= MIN_STEM:
        # Every form agrees on a real stem: nothing here is a stem change.
        return lcp, [False] * len(forms), False
    # A shared prefix of one letter or none is not a stem. "pouvoir" shares only
    # "p" across peux/peut/pouvons/peuvent, which hides the real story: peu- in
    # four forms, pouv- in nous and vous. Fall back to what the majority agree on.
    need = max(2, len(present) // 2 + 1)
    dominant = _dominant_prefix(present, need)
    # One letter is enough here: we already know the forms do not all agree, so
    # a prefix four of six share is a real pattern (aller: v- against all-).
    if dominant:
        return dominant, [bool(f) and not f.startswith(dominant) for f in forms], False
    return "", [False] * len(forms), True


@dataclass
class Conjugation:
    lemma: str
    aux: str = "avoir"
    groups: list = field(default_factory=list)
    impersonal: list = field(default_factory=list)
    compound: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"lemma": self.lemma, "aux": self.aux, "groups": self.groups,
                "impersonal": self.impersonal, "compound": self.compound,
                "shape": self.shape(), "links": self.links()}

    def to_json(self) -> str:
        return json.dumps(self.as_dict(), ensure_ascii=False, separators=(",", ":"))

    def group(self, gid: str) -> dict | None:
        return next((g for g in self.groups if g["id"] == gid), None)

    def shape(self) -> str:
        """How regular the verb is, judged from its own forms rather than asserted."""
        core = [g for g in self.groups if g["id"] in {"pres", "imp", "fut", "cond", "subj"}]
        broken = any(g["irregular"] for g in core)
        # A future stem unrelated to the infinitive is the clearest sign of a
        # genuinely irregular verb: aller -> ir-, faire -> fer-, pouvoir -> pourr-.
        base = _infinitive_stem(self.lemma)
        fut = self.group("fut")
        if base and fut and fut["stem"] and not fut["stem"].startswith(base):
            broken = True
        shifting = any(r and r["alt"] for g in core for r in g["rows"])
        kind = "irregular" if broken else "stem-changing" if shifting else "regular"
        for ending in INFINITIVE_ENDINGS:
            if self.lemma.endswith(ending):
                return f"{kind} -{ending}"
        return kind

    def links(self) -> list[str]:
        """Relationships between tenses, stated only where they actually hold.

        These are the rules that make French conjugation learnable: four of the
        eight tables are predictable from two stems.
        """
        out = []
        fut, cond = self.group("fut"), self.group("cond")
        if fut and cond and fut["stem"] and fut["stem"] == cond["stem"]:
            out.append(f"Futur and Conditionnel share the stem <b>{fut['stem']}-</b>. "
                       f"Learn one and you have both.")
        pres, imp = self.group("pres"), self.group("imp")
        if pres and imp and imp["stem"]:
            nous = pres["rows"][3]
            if nous and nous["f"].endswith("ons"):
                base = nous["f"][:-3]
                if base == imp["stem"]:
                    out.append(f"The Imparfait stem <b>{base}-</b> is the <i>nous</i> form of the "
                               f"Présent ({nous['f']}) with <i>-ons</i> removed.")
        subj = self.group("subj")
        if pres and subj and subj["stem"]:
            ils = pres["rows"][5]
            if ils and ils["f"].endswith("ent") and ils["f"][:-3] == subj["stem"]:
                out.append(f"The Subjonctif stem <b>{subj['stem']}-</b> is the <i>ils</i> form of "
                           f"the Présent ({ils['f']}) with <i>-ent</i> removed.")
        imper = self.group("imper")
        if pres and imper:
            same = [r for r in imper["rows"] if r and any(
                q and q["f"] == r["f"] for q in pres["rows"])]
            if len(same) == len([r for r in imper["rows"] if r]):
                out.append("The Impératif is the Présent with the pronoun dropped.")
        return out


def _pick(forms: list[dict], require: set[str], forbid: set[str]) -> dict[int, list[str]]:
    """Collect the person slots for one tense, skipping reflexive duplicates.

    A slot keeps every spelling Wiktionary lists for it, in its order: "paie"
    and "paye" are both the present of payer, and dropping one would teach
    that the other is wrong.
    """
    out: dict[int, list[str]] = {}
    for fm in forms:
        tags = set(fm.get("tags") or [])
        if "reflexive" in tags or "multiword-construction" in tags:
            continue
        if not require <= tags or tags & forbid:
            continue
        slot = _slot(tags)
        if slot is None:
            continue
        value = (fm.get("form") or "").strip()
        if is_spelling(value) and value not in out.setdefault(slot, []):
            out[slot].append(value)
    return {k: v for k, v in out.items() if v}


def _simple_form(forms: list[dict], require: set[str], forbid: set[str] = frozenset()) -> str:
    for fm in forms:
        tags = set(fm.get("tags") or [])
        if "reflexive" in tags or "multiword-construction" in tags:
            continue
        if require <= tags and not (tags & forbid):
            v = (fm.get("form") or "").strip()
            if is_spelling(v):
                return v
    return ""


def _auxiliary(forms: list[dict]) -> str:
    for fm in forms:
        tags = set(fm.get("tags") or [])
        if "infinitive" in tags and "multiword-construction" in tags and "reflexive" not in tags:
            text = (fm.get("form") or "").lower()
            if text.startswith("être"):
                return "être"
            if text.startswith("avoir"):
                return "avoir"
    return "avoir"


def cell_forms(row: dict | None) -> list[str]:
    """Every spelling a table cell lists."""
    if not row:
        return []
    return [row["f"]] + list(row.get("also") or [])


def _mark_shared(groups: list[dict]) -> None:
    """Note, on each tense, the other tenses of the same verb it is spelt like.

    For a regular -er verb the subjonctif présent is the présent in five cells
    out of six, and the nous/vous cells are the imparfait. Anything that later
    looks a form up in running text has to know that the spelling alone cannot
    say which tense it found, so the overlap is recorded here, on the table,
    where it is a plain fact about the forms rather than a rule about French.
    """
    spelled = {g["id"]: {f for r in g["rows"] for f in cell_forms(r)} for g in groups}
    for g in groups:
        g["shares"] = [o["id"] for o in groups
                       if o["id"] != g["id"] and spelled[g["id"]] & spelled[o["id"]]]


def build(lemma: str, forms: list[dict], h_elides: bool | None = None) -> Conjugation | None:
    """Turn kaikki's flat form list into the structured tables.

    `h_elides` says whether "je" elides before this verb's h, for the handful
    of verbs that start with one; it comes from a dictionary, never from here.
    """
    if not forms:
        return None
    c = Conjugation(lemma=lemma, aux=_auxiliary(forms))

    for gid, mood, tense, require, forbid, note in SIMPLE_TENSES:
        slots = _pick(forms, require, set(forbid))
        if gid == "imper":
            # Imperative has only tu / nous / vous.
            cells = [slots.get(1, []), slots.get(3, []), slots.get(4, [])]
            pronouns = IMPER_PRONOUNS
        else:
            cells = [slots.get(i, []) for i in range(6)]
            pronouns = SUBJ_PRONOUNS if mood == "Subjonctif" else PRONOUNS
        # The first spelling is the one the table is analysed on; the rest
        # travel with the cell as alternatives.
        ordered = [c[0] if c else "" for c in cells]
        if not any(ordered):
            continue
        stem, flags, irregular = analyse(ordered, lemma)
        counts: dict[str, int] = {}
        for f in ordered:
            if f:
                counts[f] = counts.get(f, 0) + 1
        rows = []
        for i, form in enumerate(ordered):
            if not form:
                rows.append(None)
                continue
            if irregular or flags[i] or not form.startswith(stem):
                s, e = "", form
            else:
                s, e = stem, form[len(stem):]
            row = {
                "p": (_elide(pronouns[i], form, h_elides).rstrip()
                      if pronouns[i].endswith("je") else pronouns[i]),
                "s": s, "e": e, "f": form,
                "alt": bool(flags[i]),
                "dup": counts.get(form, 0) > 1,
            }
            if len(cells[i]) > 1:
                row["also"] = cells[i][1:]
            rows.append(row)
        c.groups.append({"id": gid, "mood": mood, "tense": tense, "stem": stem,
                         "irregular": irregular, "note": note, "rows": rows})
    _mark_shared(c.groups)

    inf = _simple_form(forms, {"infinitive"}) or lemma
    pres_p = _simple_form(forms, {"participle", "present"})
    past_p = _simple_form(forms, {"participle", "past"})
    c.impersonal = [x for x in [
        {"label": "Infinitif", "form": inf},
        {"label": "Participe présent", "form": pres_p, "hint": "en " + pres_p if pres_p else ""},
        {"label": "Participe passé", "form": past_p},
    ] if x["form"]]

    if past_p:
        aux_forms = AUX_FIRST_SINGULAR[c.aux]
        for cid, label, aux_key, why in COMPOUND_TENSES:
            av = aux_forms.get(aux_key)
            if not av:
                continue
            agrees = c.aux == "être"
            example = f"{_elide('je', av)}{av} {past_p}" + ("(e)" if agrees else "")
            if aux_key == "subj":
                example = "que " + example
            c.compound.append({"id": cid, "label": label, "aux": c.aux, "aux_key": aux_key,
                               "aux_form": av,
                               "participle": past_p, "example": example, "why": why,
                               "agrees": agrees})
    return c if c.groups else None
