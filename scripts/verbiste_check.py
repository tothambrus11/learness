"""Compare the catalogue's verb tables with Verbiste, an independent conjugation database.

The tables come from Wiktionary; this is the second opinion. Verbiste's XML is
not in the repo. The mlconjug3 wheel ships a copy:

    pip download mlconjug3 --no-deps -d /tmp/mlc
    unzip -q /tmp/mlc/mlconjug3-*.whl -d /tmp/mlc/ex
    .venv/bin/python scripts/verbiste_check.py /tmp/mlc/ex/mlconjug3/data/conjug_manager

Prints the share of cells that agree and lists every cell that does not.
Run from the repository root, after `frcog sentences`.
"""
import json, re, sqlite3, sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
X = sys.argv[1]
verbs = {}
for v in ET.parse(f"{X}/verbs-fr.xml").getroot().iter("v"):
    verbs[v.find("i").text] = v.find("t").text
templates = {}
MAP = {("Indicatif","Présent"):"pres", ("Indicatif","Imparfait"):"imp", ("Indicatif","Futur"):"fut",
       ("Indicatif","Passé-Simple"):"hist", ("Conditionnel","Présent"):"cond",
       ("Subjonctif","Présent"):"subj", ("Subjonctif","Imparfait"):"subjimp",
       ("Imperatif","Imperatif-Présent"):"imper"}
for t in ET.parse(f"{X}/conjugation-fr.xml").getroot().iter("template"):
    name = t.get("name"); cut = len(name.split(":")[1])
    tenses = {}
    for mood in t:
        for tense in mood:
            key = MAP.get((mood.tag, tense.tag))
            if not key: continue
            tenses[key] = [[i.text or "" for i in p.findall("i")] for p in tense.findall("p")]
    templates[name] = (cut, tenses)
con = sqlite3.connect("data/french.db"); con.row_factory = sqlite3.Row
same = diff = 0; missing = []; diffs = []; per = Counter(); alt_only = 0
for r in con.execute("SELECT lemma, conjugation FROM words WHERE active=1 AND conjugation IS NOT NULL"):
    lemma = r["lemma"]; tmpl = verbs.get(lemma)
    if not tmpl: missing.append(lemma); continue
    cut, tenses = templates[tmpl]; radical = lemma[:-cut] if cut else lemma
    table = json.loads(r["conjugation"])
    for g in table["groups"]:
        ref = tenses.get(g["id"])
        if not ref: continue
        for i, row in enumerate(g["rows"]):
            if i >= len(ref): break
            expect = {radical + e for e in ref[i] if e is not None}
            expect = {e for e in expect if e != radical}  # Verbiste's empty <i/> = no form
            got = set([row["f"]] + row.get("also", [])) if row else set()
            if not expect and not got: continue
            if got == expect: same += 1
            elif got and got <= expect: same += 1; alt_only += 1
            else:
                diff += 1; per[g["id"]] += 1
                if len(diffs) < 40: diffs.append((lemma, g["id"], i, sorted(got), sorted(expect)))
print(f"cells agree: {same}, differ: {diff} ({diff/(same+diff):.2%}); verbs not in Verbiste: {len(missing)} {missing[:15]}")
print("by tense:", dict(per)); print("ours is a subset of Verbiste's spellings in", alt_only, "cells")
for d in diffs: print("  ", d)
