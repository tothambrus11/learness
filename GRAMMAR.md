# Grammar bits — what to teach, in what order, and how to grade it

*Written 2026-09-20, from the discussion of the form channel asking for tenses
nobody had taught.*

The form channel asks "say *il partait*" the second time a verb's form card
comes round, and nothing in the app has said what the imparfait is or how it
is built. A flashcard per verb assumes the pattern is known; the pattern is
never introduced. This document is the inventory of the patterns — the
*grammar bits* — with their dependencies, the exercise each is practised
with, and how a many-gap exercise is graded. It is grounded in the sources
below so that nothing important is missing, and it stops at B2.

## Sources, and what each is used for

**The syllabus.** *Inventaire linguistique des contenus clés des niveaux du
CECRL* (Eaquals / CIEP, 2015, coordinated by Brian North) is the reference
inventory of what French A1–C2 contains, drawn up for the CEFR by the people
who wrote the descriptors. Its *Annexe E* lists the grammar per level in a
page each, and the Lille CASNAV annex (2017) compresses A1–B2 into one table.
Every bit below that a syllabus would list is checked against it; the
"placed" column is where it puts the point. Kwiziq's lesson lists (A0–B2,
around four hundred lessons) are the second check, useful because they are
finer-grained than the inventory: one lesson per verb group, per pronoun,
per negation. Tex's French Grammar and Français interactif (University of
Texas COERLL, CC BY 3.0) are the open reference texts the prose can be
written from and cite; Français interactif also carries the phonetics
chapters the pronunciation bits follow.

- Inventaire: <https://www.eaquals.org/wp-content/uploads/Inventaire_ONLINE_full.pdf>
- Lille annex: <https://casnav.site.ac-lille.fr/wp-content/uploads/sites/36/2023/06/Annexe-4-Contenus-cles-grammaire-Parcours-perso-MLDS.pdf>
- Kwiziq by level: <https://french.kwiziq.com/revision/grammar/by-cefr-level>
- Tex's French Grammar (CC BY): <https://www.laits.utexas.edu/tex/gr/index.html>
- Français interactif (CC BY): <https://www.laits.utexas.edu/fi/>

**The order learners actually follow.** Bartning & Schlyter (2004,
*Itinéraires acquisitionnels et stades de développement en français L2*)
describe six stages of L2 French morphosyntax from corpus data, and the
order is stable across learners: finite forms and *c'est* first; then
passé composé and futur proche; then imparfait on *être/avoir* before lexical
verbs, and the présent / passé composé opposition; then futur simple, with
conditionnel, plus-que-parfait and subjonctif appearing only at the lower
advanced stage; and plural verb agreement (*ils prennent*, not *ils prend*)
is the last thing to stabilise, at the mid-advanced stage. Two consequences
for the graph: the passé composé comes before the imparfait, not with it;
and the third-person plural deserves its own bit, because the ending that
is silent in speech is the one nobody learns from listening.

**How grammar is learned, as far as the evidence goes.** Explicit
instruction followed by practice beats leaving the learner to infer the rule
(Norris & Ortega 2000 meta-analysis; Spada & Tomita 2010, for simple and
complex features alike). A rule goes from something you know to something
you do through practice on many instances (DeKeyser's skill-acquisition
account), and it transfers best to the task it was practised on: writing
forms teaches writing forms, saying them teaches saying them. Recognition
tasks that force the learner to read the ending for meaning (VanPatten's
processing instruction) are what the existing which-time card is. Retrieval
beats re-reading (Roediger & Karpicke 2006), spacing beats massing (Cepeda
et al. 2006), and rules practised interleaved with each other are retained
better than blocked (Rohrer & Taylor 2007) — so a sitting mixes bits, and
the lesson is read once, not re-read. For gender, Tucker, Lambert & Rigault
(1977) showed that noun endings predict gender well enough to teach, and
Lyster (2004) that teaching them explicitly works. For the grading model,
the knowledge-component view (Koedinger, Corbett & Perfetti 2012; Bayesian
knowledge tracing, Corbett & Anderson 1995) is what "each gap is an
observation of a rule" below rests on.

**Pronunciation.** Delattre's three-way classification of liaison
(obligatoire / facultative / interdite) is the standard and what every
textbook teaches; the Wikipedia articles on liaison, elision and French
orthography summarise the rules with the lists of exceptions. The learner
lives in Valais, so the Swiss forms are taught as the norm where they
differ: *septante, huitante, nonante*, and the vowel distinctions Swiss
French keeps that Paris has dropped.

## What a bit is

A bit is one rule that fits in one sentence and is practised by one exercise
type, with a short lesson: a paragraph of prose, a table where the rule is a
table, and three or four real sentences. The prose is written by hand, as
the function-word inventory is, because it is teaching and not a fact the
pipeline could look up. The tables come from the verb tables already in the
catalogue (kaikki), the sentences from the corpus already on disk
(Tatoeba), and a bit's exercises draw only on words the learner already
knows: a rule practised on *partir* when you cannot yet produce *partir* is
today's mistake one level up.

A bit *needs* the bits it builds on. A learner opens a bit by reading its
lesson once every bit it needs is passed; the choice of which open bit to
read next is the learner's. Level is not a gate: the "placed" column says
where the syllabus puts a point, so that a learner who wants the subjonctif
early can see what it rests on, not so that the app can refuse.

Some bits are already in the app in another shape. The function-word
channel teaches the prepositions, negation words, connectives and degree
adverbs as words met in sentences; those bits below say so and add only the
rule (where *ne* goes with a compound tense, which connective takes the
subjonctif). The which-time and voice cards are the recognition and
speaking exercises of the tense bits, gated by them.

## The exercises

Twelve exercise types cover every bit below. A bit names one of them; a
rule needs its own *selector* (which verbs, which sentences, which
distractors, which cells), never its own renderer.

| type | what the learner does | graded |
|---|---|---|
| **read** | reads the lesson; the bit opens | not graded |
| **choose** | taps one of a few options in a sentence or table | first tap; a wrong one is taken away and the question stands |
| **gap** | types one missing form into one sentence, from a prompt (the infinitive, the pronoun, the tense) | strict, on the letter |
| **gaps** | the same rule in three to five sentences at once, one gap each, different words | per gap, strict |
| **table** | fills the six cells of one tense of one verb from the infinitive | per cell, strict |
| **transform** | rewrites what is given: présent → imparfait, statement → question, direct → reported, active → passive | strict on the part the rule changes, tolerant elsewhere |
| **order** | puts given pieces in order: object pronouns, *ne … pas* around a compound tense, an adjective and its noun | whole answer |
| **which** | reads a sentence and says what it means: which time, which mood, who *lui* is, is the noun singular | first tap |
| **say** | says a form or a sentence aloud, then hears the model and judges | self-graded, as the voice card is now |
| **hear** | hears audio and types or chooses: a number, a minimal pair, singular or plural | strict |
| **mark** | taps positions in a written sentence: where the liaisons are, which final letters are silent, where *e* drops | per position |
| **spell** | writes a number in words from digits, or digits from words | strict, hyphens and agreement included |

**gaps**, **table** and **mark** are the many-answers exercises. The rest
are one answer, and the existing card already draws most of them: **gap**
is the fill rung, **choose** and **which** are the choose and tense rungs,
**say** is the voice rung. **transform**, **order**, **hear**, **mark** and
**spell** are new faces; all of them are a prompt line, an answer line and
a verdict, in the DSL `cardface.ts` already has, plus one new line kind for
**mark** (a sentence with tappable boundaries) and one for **table** (a
column of pronoun-and-box rows).

## Grading a rule, which is not grading a word

A word is one memory and one FSRS card. A rule is one memory *and* a set of
instances, some of which have memories of their own — *être*'s imparfait
stem is not the imparfait rule, it is a fact about *être*. So an exercise
about a rule is graded twice, and the selector says how.

**Every gap names its knowledge components.** A cell of the imparfait table
of *finir* is an observation of the rule bit (imparfait endings) and of the
stem rule (nous-form of the présent). A cell of the imparfait of *être* is an
observation of the endings bit and of the item "être, imparfait stem", which
is a form card *être* already has. The selector attaches the components
when it builds the exercise; the grader routes each answer to each.

**The rule card gets one grade for the whole exercise**, because FSRS takes
one grade per review and the table was one act of recall of the rule. Only
the gaps that observe the rule count: with six cells, all six right is
Good (Easy on a streak, as the ladder climbs today), five is Hard, four or
fewer is Again. An irregular cell wrong and the five regular ones right is
Hard on the rule and Again on the irregular item. Nothing is retried for a
grade; the corrections are shown per gap, the card teaches, and the next
time is the next review.

**Item cards get their own grade from their own gap.** *être*'s stem wrong
is *être*'s card, so it comes back sooner, on a table or on its voice card,
without the rule's interval being punished for it.

**A rule is passed on breadth, not on count.** The rule card counts the
distinct words it has been answered right on; a bit is passed when that
count reaches a handful (five, say) *and* the card is mature. A table of
six cells on one verb is one word; a **gaps** exercise over four sentences
is four. That is what the many-sentence exercise is for: breadth in one
sitting. Duolingo's half-life regression tracks the same thing per lexeme;
here the unit is the rule, which is what generalises.

**A passed bit does not close.** Its card stays in the scheduler, so a rule
unused for a month comes back, on new verbs. What "passed" opens is the
bits that need it. Skill Circuits' checkbox is right for a course and wrong
for a language.

**Recognition and production are separate cards** of the same bit, where
the bit has both: the which-time card and the transform card of the
imparfait are two intervals, as the written and heard channels are two
intervals of a word.

## The inventory

Column *needs* names bit ids. *Placed* is where the sources put the point:
one level where the Inventaire and Kwiziq agree, both where they differ
(Inventaire first), and "—" for a bit neither lists as such, with the
reason in the row. Modules are ordered roughly as the graph is walked, but
the graph, not the module order, is the constraint.

### P — Sounds and spelling

Pronunciation is taught as rules because the rules are what a reader cannot
hear: the ending that is written and not said, the consonant that is said
only before a vowel. The app has a voice for every word and sentence, so
every one of these can be heard as well as read. Français interactif's
phonetics chapters are the order followed.

| id | bit | needs | exercise | placed |
|---|---|---|---|---|
| P.letters | The alphabet and the five accents: what é, è, ê, ç and the tréma do to a sound; spelling a word aloud | — | hear, say | A1 |
| P.final | Final consonants are silent except *c, r, f, l* — and the exceptions that matter (*-er* infinitives, *blanc, porc, tabac, gentil*) | P.letters | mark | — (FI phonetics) |
| P.e-caduc | The *e* that drops: *samedi, je ne sais pas → j'sais pas*; kept when three consonants would meet | P.final | mark, hear | — (FI phonetics) |
| P.nasal | The nasal vowels *an/en, on, in/ain/ein, un* (Swiss French keeps *un* distinct), and the *n* that comes back before a vowel or a written *n*: *bon / bonne, an / année* | P.letters | hear, say | — (FI phonetics) |
| P.vowel-pairs | *u* against *ou*; *é* against *è* (kept apart in Swiss French: *j'ai* / *j'aie*, *parlerai* / *parlerais*); *o* open and closed; *eu* open and closed | P.letters | hear | — (FI phonetics) |
| P.semi | The semi-vowels *oi, ui, ill, y*: *lui, fille, travail, voyage* | P.letters | hear, say | — (FI phonetics) |
| P.r-h | The French *r*; mute *h* against aspirated *h* (*l'homme* but *le héros*), and that the dictionary marks which | P.letters | choose | — (FI phonetics) |
| P.elision | Elision: *je, me, te, se, le, la, ne, de, que, ce* lose their vowel before a vowel; *si* only before *il(s)*; never before an aspirated *h*, *onze*, *oui* | P.r-h | mark, gap | A1 (implicit in every article bit) |
| P.enchaine | Enchaînement: a said final consonant moves onto the next vowel, *il est / i-lest*, *une amie / u-namie* | P.final | mark, say | — (FI phonetics) |
| P.liaison-must | Obligatory liaison: determiner + noun, adjective + noun, pronoun + verb, verb + pronoun in inversion, after *en, dans, chez, très, plus* and in set phrases; *s/x → z, d → t, f → v* in *neuf ans / neuf heures*, *n* with the nasal kept in *mon ami* | P.enchaine, P.nasal | mark, say | A2 (Inventaire: "liaisons") |
| P.liaison-never | Forbidden liaison: after *et*, after a singular noun, before an aspirated *h*, before *onze* and *oui*, after *quand* and *comment* as question words (except *comment allez-vous*) | P.liaison-must | mark | — |
| P.liaison-may | Optional liaison and register: plural noun + verb, *est* + complement, *pas* + vowel; more in reading aloud, fewer in speech | P.liaison-never | which | — |
| P.verb-endings | What verb endings sound like: *-ent* is silent (*il parle = ils parlent*), *-er, -ez, -é, -ai* are all /e/, *-ais, -ait, -aient* are /ɛ/, *-ons* and *-ont* are the same nasal; so *ils ont / ils sont* is a liaison, *z* against *s* | P.final, P.liaison-must, V.pres-er | hear, mark | — (needed by every tense bit) |
| P.plural-heard | Plural is heard on the article and the liaison, not the noun: *les amis* /lez‿ami/, *ils aiment* /ilz‿ɛm/; *il aime* and *ils aiment* differ only there | P.liaison-must, D.plural | hear | — (Bartning & Schlyter: last to stabilise) |
| P.questions | Intonation of a yes/no question; rhythm and final stress of a phrase, against English word stress | P.letters | hear, say | A1–B2 (Inventaire: "rythme / intonation") |
| P.numbers | The numbers that change: *cinq, six, dix, huit, neuf, vingt, cent* before a vowel, before a consonant, and alone; no elision or liaison before *huit* and *onze* | P.liaison-must, N.0-20 | hear, say | — (needed by N) |

### N — Numbers

The learner asked for several lessons on numbers, and the syllabus agrees:
counting, prices, time, dates and measures are A1 functions in the
Inventaire, and Kwiziq has a lesson group for them at every level. The
Swiss forms are the ones taught, with the French ones for recognition.

| id | bit | needs | exercise | placed |
|---|---|---|---|---|
| N.0-20 | Zero to twenty: *un/une* agrees, the rest do not; *onze* to *seize* are one word, *dix-sept* to *dix-neuf* are two | P.letters | hear, spell, say | A1 |
| N.tens | Twenty to sixty-nine: tens plus units with a hyphen, *et un* at twenty-one, thirty-one … sixty-one, *et onze* at seventy-one | N.0-20 | spell, hear | A1 |
| N.70-99 | Seventy to ninety-nine: *septante, huitante, nonante* here (Vaud, Valais, Fribourg), *soixante-dix, quatre-vingts, quatre-vingt-dix* in France and Geneva; recognise both, say the local one | N.tens | hear, spell | A1 (Kwiziq: "70 to 999") |
| N.hundreds | Hundreds and thousands: *cent* takes an *s* only when nothing follows (*deux cents, deux cent un*), *mille* never; *million* and *milliard* are nouns and take *de* | N.70-99 | spell | A1 |
| N.pron | Saying numbers in a row: *six* /sis/ alone, /si/ before a consonant, /siz/ before a vowel; *neuf heures*; *vingt et un* with the *t*; *quatre-vingts ans* without it | P.numbers, N.hundreds | say, hear | — |
| N.ordinal | Ordinals: *premier/première*, then *-ième* (*quatrième* drops the *e*, *cinquième* adds a *u*, *neuvième* turns *f* to *v*); written *1er, 1re, 2e*; used for the first of the month, floors and centuries, cardinals for kings and the other days | N.0-20 | spell, gap | A1 |
| N.time | Telling the time: *il est une heure*, *heure(s)* always said, *et quart, et demie, moins le quart, moins dix*, *midi et demi*; the 24-hour clock for timetables, *quinze heures trente* | N.tens | hear, spell, say | A1 |
| N.date | Dates: *le premier mai* but *le deux mai*, *en deux mille quinze*, *jeudi 3 septembre* with no capitals, *on est le combien ?* | N.hundreds, N.ordinal | spell, gap | A1 |
| N.prices | Prices and measures: *trois francs cinquante*, *un euro vingt*, *deux kilos de*, *à dix kilomètres*, *moins dix pour cent* | N.hundreds | hear, spell | A1 (Inventaire: "quantités et mesures") |
| N.age-duration | Age and spans: *j'ai trente ans* (avoir, never être), *depuis trois ans, pendant deux heures, il y a dix ans, dans une semaine* | N.tens, C.time-markers | gap | A1–A2 |
| N.phone | Phone numbers, read in groups: *079 123 45 67* in Switzerland, pairs in France | N.70-99 | hear, say | — (an A1 function: donner des informations personnelles) |
| N.approx | Roughly: *une dizaine, une douzaine, une quinzaine, une vingtaine, une centaine, un millier* + *de*; *environ, à peu près, presque* | N.hundreds | gap, choose | A2 |
| N.fractions | Halves and parts: *demi* (agrees after the noun, not before), *la moitié de, un tiers, un quart, trois cinquièmes*; decimals with a comma, *deux virgule cinq*; percentages | N.ordinal | spell, hear | A2–B1 |
| N.arith | Arithmetic aloud: *et / plus, moins, fois, divisé par, font / égale*; used for the **hear** exercises where the answer is computed | N.hundreds | hear | A2 (Kwiziq) |

### D — Nouns and determiners

| id | bit | needs | exercise | placed |
|---|---|---|---|---|
| D.gender | Every noun has a gender and the article carries it; *le / la / l'*, *un / une* | P.elision | choose | A1 |
| D.gender-endings | Gender from the ending, for the endings that predict it: *-tion, -té, -ette, -ance, -ure, -ie* feminine; *-age, -ment, -eau, -isme, -oir* masculine; the famous exceptions | D.gender | which | A1 (Kwiziq) |
| D.plural | Plural: *-s* unheard; *-x* after *-au, -eau, -eu*; *-al → -aux*; *-ou* (*bijoux*); nouns already in *-s, -x, -z*; surnames do not pluralise | D.gender | gap, hear | A1 |
| D.art-def | The definite article: generalising (*j'aime le café*), days and dates (*le lundi*), body parts, languages, titles, countries | D.gender | choose, gap | A1 |
| D.art-indef | The indefinite and the partitive: *un, une, des*; *du, de la, de l'* for some of; *des* against *les* | D.art-def | choose | A1 |
| D.contract | *à* and *de* fuse with *le* and *les*: *au, aux, du, des* | D.art-def | gap | A1 |
| D.de-negative | After a negation, *un / une / du / des* become *de*: *je n'ai pas de voiture*; not after *être* | D.art-indef, G.pas | gap | A1 |
| D.de-quantity | After a quantity, *de* alone: *beaucoup de, un peu de, un kilo de, trop de, assez de, plus de*; *la plupart des* | D.de-negative | gap | A1 |
| D.de-adjective | *des* becomes *de* before a plural adjective + noun: *de belles maisons* | D.de-quantity, J.position | gap | B1 |
| D.possessive | *mon, ma, mes …*; *mon* before a feminine vowel (*mon amie*); *son* for his and her alike; *leur* against *leurs* | D.gender | gap | A1 |
| D.demonstrative | *ce, cet, cette, ces*; *cet* before a vowel; *-ci* and *-là* to tell two apart | D.possessive | gap | A1–A2 |
| D.tout | *tout / toute / tous / toutes* as a determiner: *tous les jours, toute la journée* | D.plural | gap | A2 |
| D.indef-det | *chaque, plusieurs, quelques, certains, aucun, n'importe quel, autre* | D.tout | choose | A2–B1 |
| D.c-est | *c'est* against *il est / elle est*: *c'est* before a determiner or a name, *il est* before a bare adjective, nationality or job | D.art-indef | choose | A1 |
| D.il-y-a | *il y a* and *voilà / voici* for pointing at what exists | D.art-indef | gap | A1 |
| D.countries | Countries and cities take their article and preposition by gender: *en France, au Valais, aux États-Unis, à Sion, en Suisse* | D.contract | choose | A1 |

### J — Adjectives and adverbs

| id | bit | needs | exercise | placed |
|---|---|---|---|---|
| J.agree | Adjectives agree: *-e* for feminine (none if already *-e*), *-s* for plural; *grand / grande / grands / grandes* | D.gender, D.plural | gaps | A1 |
| J.fem-irregular | Feminine by rule: *-eux → -euse, -er → -ère, -f → -ve, -ien → -ienne, -el → -elle, -et → -ète / -ette, -c → -che / -que*; and the ones to learn as items (*blanc, long, frais, faux, doux, sec*) | J.agree | table, gaps | A1–A2 |
| J.plural-x | Plural in *-x*: *-al → -aux* (*banals* excepted), *-eau → -eaux*; *-s, -x* unchanged | J.agree | gap | A2–B1 |
| J.position | Most adjectives follow the noun; the short common ones go before (*beau, bon, grand, gros, jeune, joli, mauvais, nouveau, petit, vieux*) | J.agree | order | A1 |
| J.beau | *beau / bel / belle, nouveau / nouvel / nouvelle, vieux / vieil / vieille* before a vowel | J.position, P.elision | gap | A1 |
| J.meaning-position | An adjective that changes meaning with its place: *un ancien collègue / un bâtiment ancien, ma propre voiture / une voiture propre, un certain âge / une réponse certaine* | J.position | which | B1 |
| J.colours | Colours: agree, except those named after things (*orange, marron*) and compounds (*bleu clair*) | J.agree | gaps | A1–B1 |
| J.compare | Comparing: *plus … que, moins … que, aussi … que* with adjectives and adverbs; *plus de … que* with nouns; *autant que* with verbs | J.agree | transform | A2 |
| J.superlative | The superlative: *le plus …, le moins …*, the article repeated after the noun (*la ville la plus belle*); *de* for "in" | J.compare | transform | A2 |
| J.bon-bien | *bon / meilleur / le meilleur* against *bien / mieux / le mieux*; *mauvais / pire* | J.compare | choose | A2–B1 |
| J.adverb-ment | Adverbs in *-ment*: from the feminine (*lentement*), from the vowel masculine (*vraiment*), *-ant / -ent → -amment / -emment*; the irregular set (*bien, mal, vite, mieux*) | J.fem-irregular | gaps | A1–A2 |
| J.adverb-position | Where the adverb goes: after the verb in a simple tense, between auxiliary and participle in a compound one for the short ones (*déjà, toujours, bien, beaucoup*) | J.adverb-ment, V.pc | order | A2 |
| J.more-and-more | *de plus en plus, de moins en moins, plus … plus …* | J.compare | gap | A2–B1 |

### R — Pronouns

| id | bit | needs | exercise | placed |
|---|---|---|---|---|
| R.subject | Subject pronouns; *on* for we, people, someone; *vous* to one person; *il / elle* for things | — | choose | A1 |
| R.stress | Stress pronouns *moi, toi, lui, elle, nous, vous, eux, elles*: after a preposition, alone, for emphasis, in *c'est moi*, with *-même* | R.subject | gap | A1–A2 |
| R.do | Direct object pronouns *me, te, le, la, nous, vous, les*, before the verb; *le / la → l'* | R.subject, P.elision | transform | A2 |
| R.io | Indirect object pronouns *me, te, lui, nous, vous, leur*: for *à* + person; verbs that take *à* (*parler à, téléphoner à, plaire à*) against English | R.do, V.verb-prep | transform | A2 |
| R.y | *y* replaces *à* + place or thing, and *chez / dans / sur* + place: *j'y vais* | R.io | transform | A2 |
| R.en | *en* replaces *de* + thing and a quantity: *j'en veux deux*; the number stays | R.y, D.de-quantity | transform | A2 |
| R.pronoun-infinitive | The pronoun goes before the infinitive it belongs to: *je vais le voir*, *je veux lui parler* | R.io, V.futur-proche | order | A2 |
| R.pronoun-compound | With a compound tense the pronoun goes before the auxiliary: *je l'ai vu*, *je lui ai parlé* | R.io, V.pc | order | A2 |
| R.pronoun-negative | Pronouns inside the negation: *je ne le vois pas*, *je ne l'ai pas vu* | R.pronoun-compound, G.pas-compound | order | A2 |
| R.pronoun-imperative | Pronouns after an affirmative command with a hyphen, *me → moi*, *te → toi*; before a negative one: *donne-le-moi, ne me le donne pas*; *vas-y, parles-en* keep the *s* | R.io, V.imperative | transform | A2–B1 |
| R.order | Two pronouns at once: *me / te / nous / vous* before *le / la / les* before *lui / leur* before *y* before *en* | R.pronoun-imperative | order | B1–B2 |
| R.reflexive | Reflexive pronouns *me, te, se, nous, vous, se*, and the reciprocal reading (*ils se parlent*) | R.subject | gap | A1–A2 |
| R.neuter-le | *le* for an idea or an adjective: *je le sais, elle l'est* | R.do | transform | B1 |
| R.rel-qui-que | Relatives *qui* (subject) and *que* (object), *qu'* before a vowel; the participle agrees after *que* | R.do | choose, gap | A2 (B1 for the agreement) |
| R.rel-ou | *où* for where and when: *le jour où* | R.rel-qui-que | gap | A2–B1 |
| R.rel-dont | *dont* for *de* + relative: *le livre dont je parle, l'ami dont le père …* | R.rel-ou, V.verb-prep | gap | B1 |
| R.ce-qui | *ce qui, ce que, ce dont* for "what"; the mise en relief *ce que je veux, c'est …* | R.rel-dont | choose | B1 |
| R.rel-compound | *lequel / laquelle / lesquels / lesquelles* after a preposition, fused with *à* and *de* (*auquel, duquel*); *à qui* for people | R.rel-dont, D.contract | gap | B1–B2 |
| R.demonstrative | *celui / celle / ceux / celles* + *-ci / -là*, *de*, or a relative: *celui qui parle*; *ça / cela / ceci* | R.rel-qui-que, D.demonstrative | gap | A2–B1 |
| R.possessive | *le mien, la tienne, les siens, le nôtre, le leur* | D.possessive | gap | A2 |
| R.indefinite | *quelqu'un, quelque chose, personne, rien, tout, tous, chacun, plusieurs, certains, l'un … l'autre, n'importe qui*; adjective after them with *de* and masculine | D.indef-det | gap | A2–B1 |
| R.interrogative | *qui, que, quoi, qu'est-ce qui, qu'est-ce que, qui est-ce qui, lequel* | Q.words | choose | A1–B2 |

### V — Verbs: forms

The forms. Each tense is at least two bits: how it is built for the regular
groups, and its irregular members as items. The tables come from the
catalogue; the pipeline already separates stem from ending and flags the
cell that departs from the pattern, so which group a verb belongs to and
which cells are exceptions is computed, never authored. What is authored is
the rule in words.

| id | bit | needs | exercise | placed |
|---|---|---|---|---|
| V.pres-er | Présent of *-er* verbs: stem + *-e -es -e -ons -ez -ent*; four of the six sound the same | R.subject, P.final | table | A1 |
| V.pres-etre-avoir | *être* and *avoir* in the présent, as items; *c'est / il y a / j'ai … ans* | V.pres-er | table, say | A1 |
| V.pres-aller-faire | *aller* and *faire*, as items; *aller* for how you are, *faire* for weather and sport | V.pres-etre-avoir | table | A1 |
| V.pres-ir | Présent of *-ir* verbs like *finir*: *-is -is -it -issons -issez -issent* | V.pres-er | table | A1 |
| V.pres-re | Présent of *-re* verbs like *vendre, attendre*: *-s -s — -ons -ez -ent*; *prendre* and family lose the *d* in the plural, *mettre* and *battre* a *t* | V.pres-ir | table | A1 |
| V.pres-tir | *partir, sortir, dormir, servir, sentir*: the stem loses its last consonant in the singular (*je pars, nous partons*) | V.pres-re | table | A1 |
| V.pres-ouvrir | *ouvrir, offrir, souffrir, découvrir, cueillir* conjugate like *-er* verbs | V.pres-er | table | A2 |
| V.pres-spelling | The spelling-change groups: *-cer → ç* and *-ger → ge* before *a / o* (*commençons, mangeons*); *-yer → i* before a silent *e* (*paie / paye*); *-eler / -eter* double the consonant (*appelle, jette*) where *acheter, geler, peler* take *è*; *é_er* and *e_er* take *è* in the stressed forms (*préfère, lève*) | V.pres-er | table, gaps | A1–A2 |
| V.pres-modals | *pouvoir, vouloir, devoir* as items, each with two stems (*peux / pouvons / peuvent*); modal + infinitive; *il faut* | V.pres-aller-faire | table | A1 |
| V.pres-venir | *venir, tenir* and derivatives: *viens / venons / viennent*; *venir de* + infinitive for just did | V.pres-modals | table | A1 |
| V.pres-savoir-connaitre | *savoir* and *connaître* as items, and the difference (a fact or a skill against a person or a place) | V.pres-modals | table, choose | A2 |
| V.pres-dire-lire-ecrire | *dire, lire, écrire* and family (*vous dites*, *ils lisent*, *nous écrivons*) | V.pres-re | table | A1–A2 |
| V.pres-voir-croire-boire | *voir, croire, boire, recevoir* and *-cevoir*: the *-oi- / -oy- / -ev-* stem changes | V.pres-re | table | A1–A2 |
| V.pres-uire-aindre | *conduire, construire* and *-uire* (*-uis / -uisons*); *craindre, peindre, joindre* (*-ains / -aignons*) | V.pres-re | table | A2 |
| V.pres-rest | The rest of the common irregulars as items: *courir, mourir, vivre, suivre, rire, s'asseoir, valoir, acquérir*; the impersonals *falloir, pleuvoir* | V.pres-uire-aindre | table | A2–B1 |
| V.pres-3pl | Third-person plural: *ils prennent, ils viennent, ils finissent* — the form that is written and mostly not heard, and the last to become automatic | V.pres-venir, P.plural-heard | gaps, hear | — (Bartning & Schlyter, stages 2–5) |
| V.pronominal | Pronominal verbs: *se lever, s'appeler, se souvenir*; the pronoun agrees with the subject; reflexive, reciprocal and idiomatic uses | V.pres-er, R.reflexive | table | A1 |
| V.participle | The past participle: *-er → -é, -ir → -i, -re → -u*; and the irregular set as items (*eu, été, fait, pris, mis, dit, écrit, vu, bu, lu, su, pu, dû, voulu, venu, ouvert, mort, né, connu, reçu, conduit, peint, vécu, plu, ri, suivi, couru, assis*) | V.pres-re | gaps | A2 |
| V.aux | *avoir* or *être* in the compound tenses: *être* for the verbs of coming and going and change (*aller, venir, arriver, partir, entrer, sortir, monter, descendre, naître, mourir, rester, tomber, retourner, passer, devenir, revenir, rentrer*) and every pronominal verb; *avoir* for the rest | V.participle, V.pres-etre-avoir | choose | A1–A2 |
| V.aux-transitive | *monter, descendre, sortir, passer, rentrer, retourner* take *avoir* with a direct object: *j'ai sorti le chien* | V.aux | choose | B1–B2 |
| V.pc | The passé composé: auxiliary in the présent + participle; the meaning (done, once, over) | V.aux | table, transform, which | A1–A2 |
| V.pc-agree-etre | With *être* the participle agrees with the subject: *elle est partie, ils sont venus* | V.pc, J.agree | gaps | A2 |
| V.pc-agree-do | With *avoir* it agrees with a direct object that comes *before*: *la lettre que j'ai écrite, je les ai vues*; with a pronominal verb, only when the reflexive pronoun is the direct object (*elle s'est lavée* but *elle s'est lavé les mains*) | V.pc-agree-etre, R.pronoun-compound, R.rel-qui-que | gaps | B1 (B2 for the exceptions) |
| V.pc-pronominal | Pronominal verbs in the passé composé: *être*, the pronoun before it, *je me suis levé(e)* | V.pc-agree-etre, V.pronominal | table | A2 |
| V.imparfait | The imparfait: the *nous* stem of the présent + *-ais -ais -ait -ions -iez -aient*; *être* has *ét-*; *-cer / -ger* keep the *ç / ge* before *a* | V.pres-3pl, P.verb-endings | table, transform | A2 |
| V.pc-vs-imp | Passé composé against imparfait: the event against the scene; what happened against what was going on, used to happen, or was the case; verbs whose meaning shifts (*je savais / j'ai su*, *je devais / j'ai dû*) | V.pc, V.imparfait | which, gaps | A2–B1 |
| V.narration | The past in a story: présent, passé composé and imparfait together; *depuis* with the imparfait | V.pc-vs-imp | gaps | B1 |
| V.futur-proche | *aller* + infinitive for what is about to happen; *être en train de* for what is happening; *venir de* for what just did | V.pres-aller-faire | transform | A1 |
| V.futur | The futur simple: the infinitive (minus *-e* for *-re*) + *-ai -as -a -ons -ez -ont*; the irregular stems as items (*ser-, aur-, ir-, fer-, viendr-, pourr-, voudr-, devr-, saur-, verr-, enverr-, recevr-, courr-, mourr-, faudr-*); after *quand / dès que* where English uses the présent | V.pres-rest, P.verb-endings | table, transform | A2·K B1 |
| V.conditionnel | The conditionnel présent: the futur stem + the imparfait endings; *-rai* against *-rais* is the whole difference on the page, and /e/ against /ɛ/ in the mouth | V.futur, V.imparfait, P.vowel-pairs | table, hear | A2·K B1 |
| V.cond-uses | What the conditionnel is for: politeness (*je voudrais, pourriez-vous*), the imagined (*si j'avais le temps, je viendrais*), *devrais* should and *pourrais* could, a report that is not confirmed | V.conditionnel | gaps, which | A1 (politeness) – B1 |
| V.si-clauses | The three *si* sentences: *si* + présent → présent / futur / impératif; *si* + imparfait → conditionnel; *si* + plus-que-parfait → conditionnel passé; never a futur or conditionnel after *si* | V.cond-uses, V.pqp | gaps, transform | B1 (B2 for the third) |
| V.imperative | The impératif: the *tu, nous, vous* forms of the présent without the pronoun; *-er* verbs (and *aller, ouvrir*) drop the *s* of *tu*; *être / avoir / savoir / vouloir* as items (*sois, aie, sache, veuillez*); negative around the verb | V.pres-er, V.pres-etre-avoir | table, transform | A1–A2 (B2 for the items) |
| V.pqp | The plus-que-parfait: auxiliary in the imparfait + participle, for what had already happened | V.imparfait, V.pc | table, gaps | B1 |
| V.futur-anterieur | The futur antérieur: auxiliary in the futur + participle; for what will have happened, and for a guess (*il aura oublié*) | V.futur, V.pc | table | B2 |
| V.cond-passe | The conditionnel passé: auxiliary in the conditionnel + participle; regret and reproach (*j'aurais dû, tu aurais pu*) | V.conditionnel, V.pc | table, gaps | B2 |
| V.subj-forms | The subjonctif présent: the *ils* stem + *-e -es -e -ions -iez -ent*; *nous / vous* borrow the imparfait forms, so a two-stem verb has two stems here too (*boive / buvions*); the items: *sois, aie, aille, fasse, puisse, sache, veuille, faille, vaille, pleuve* | V.pres-3pl, V.imparfait | table | B1 (forms) · K B2 |
| V.subj-triggers | When the subjonctif is required: after *que* following necessity (*il faut que*), wanting (*je veux que*), feeling (*je suis content que*), doubt (*je ne pense pas que*), and the conjunctions *pour que, bien que, avant que, jusqu'à ce que, à condition que, sans que*; the subject must change, otherwise the infinitive | V.subj-forms | choose, gaps | B1–B2 |
| V.subj-vs-ind | Indicative after *penser que, croire que, espérer que, dire que* in the affirmative; subjonctif when they are negated or questioned; *après que* takes the indicative | V.subj-triggers | choose | B1–B2 |
| V.subj-passe | The subjonctif passé for what is already done: *je suis content que tu sois venu* | V.subj-forms, V.pc | gaps | B2 |
| V.passe-simple | Reading the passé simple: *-a / -èrent* for *-er*, *-it / -irent* and *-ut / -urent* for the rest, *fut, eut, fit, vint*; recognised, never produced | V.pc, V.imparfait | which | B2 (recognition) · Inventaire C1 |
| V.gerondif | *en* + present participle for while and by: *en travaillant*; the participle from the *nous* stem + *-ant* (*ayant, étant, sachant*) | V.imparfait | transform | B1 |
| V.participe-present | The participe présent and the verbal adjective: *des enfants dormant …* against *des enfants fatigants*, the adjective agreeing | V.gerondif | choose | B2 |
| V.infinitif-passe | *avoir / être* + participle after *après*: *après avoir mangé, après être parti(e)* | V.pc | transform | B2 |
| V.passive | The passive: *être* + participle agreeing with the subject, *par* for the agent; *on* and the pronominal as the ways French avoids it | V.pc-agree-etre | transform | B1 |
| V.causative | *faire* + infinitive for having something done: *je fais réparer la voiture*; *se faire* + infinitive | V.pres-aller-faire | transform | B2 |
| V.reported | Reported speech in the present: *que* for a statement, *si* for a yes/no question, *ce que / ce qui* for what, the infinitive for a command | V.pres-dire-lire-ecrire, R.ce-qui | transform | B1 |
| V.reported-past | Reported speech in the past: présent → imparfait, passé composé → plus-que-parfait, futur → conditionnel; the time words shift (*demain → le lendemain, hier → la veille*) | V.reported, V.pqp, V.cond-uses | transform | B2 |
| V.verb-prep | Verbs that govern *à* or *de* before an infinitive or a noun (*commencer à, arrêter de, penser à, se souvenir de*), and the ones that take none (*vouloir, pouvoir, aimer*); already shown as chunks on each verb's cards | V.pres-modals | gap | A2–B2 |

### G — Negation

The words (*pas, plus, jamais, rien, personne*) are in the function-word
channel already. What is left is where they go.

| id | bit | needs | exercise | placed |
|---|---|---|---|---|
| G.pas | *ne … pas* around the conjugated verb; *n'* before a vowel; *si* to say yes to a negative question | V.pres-er, P.elision | transform | A1 |
| G.pas-infinitive | Both halves before an infinitive: *ne pas fumer*; around the modal otherwise: *je ne veux pas partir* | G.pas, V.pres-modals | order | A1–A2 |
| G.others | *ne … jamais / plus / rien / personne / pas encore / nulle part*; *personne ne …, rien ne …* as subjects | G.pas | transform | A1–B1 |
| G.pas-compound | The negation around the auxiliary: *je n'ai pas vu*, but *je n'ai vu personne* | G.others, V.pc | order | A2 |
| G.que | The restrictive *ne … que* for only, and *ne … aucun(e)*, *ne … ni … ni* | G.others | transform | A2–B1 |
| G.combined | Two negations together: *plus jamais, plus rien, jamais personne* | G.que | order | B1 |
| G.spoken | *ne* dropped in speech: *je sais pas*; recognised, and written only in dialogue | G.pas, P.e-caduc | which | B1 (Kwiziq) |

### Q — Questions

| id | bit | needs | exercise | placed |
|---|---|---|---|---|
| Q.yes-no | Three ways to ask: intonation, *est-ce que*, inversion with a hyphen (*parlez-vous*); *n'est-ce pas* | V.pres-er, P.questions | transform | A1 |
| Q.words | *qui, que / quoi, où, quand, comment, pourquoi, combien (de)*, each with *est-ce que* or inversion | Q.yes-no | gap | A1 |
| Q.quel | *quel / quelle / quels / quelles* + noun, and as an exclamation (*quelle surprise !*) | Q.words, J.agree | gap | A2 |
| Q.inversion-t | Inversion with *il / elle / on* after a vowel takes *-t-*: *parle-t-il, y a-t-il*; with a noun subject the pronoun is repeated (*Marie parle-t-elle*) | Q.yes-no, P.liaison-must | transform | A2 |
| Q.inversion-compound | Inversion in the passé composé and with a pronominal verb: *as-tu vu, t'es-tu levé* | Q.inversion-t, V.pc | transform | A2–B1 |
| Q.qu-est-ce | *qu'est-ce qui* (subject) against *qu'est-ce que* (object), *qui est-ce qui / que* | Q.words | choose | A2 |
| Q.lequel | *lequel / laquelle / lesquels / lesquelles* for which one | Q.quel | gap | B2 |
| Q.indirect | The indirect question: *je me demande si …, dis-moi où …, ce que* | Q.words, V.reported | transform | B1 |

### C — Prepositions, time and connectors

The prepositions and connectives are words in the function-word channel.
These bits are the rules that pick between them.

| id | bit | needs | exercise | placed |
|---|---|---|---|---|
| C.place | *à, en, au, aux, dans, chez, sur, sous, devant, derrière, entre, à côté de, en face de, près de, loin de*; *à* for a city, *en / au / aux* for a country by gender | D.countries | choose | A1 |
| C.transport | *à* against *en* with transport: *à pied, à vélo, en train, en voiture* | C.place | choose | A1 |
| C.time-markers | *depuis* (still going), *il y a* (ago), *pendant* (a span), *pour* (a planned span), *dans* (from now), *en* (how long it takes), *dès, à partir de* | N.tens | choose, gaps | A1–B1 |
| C.depuis-tense | *depuis* takes the présent where English takes the perfect; the passé composé only in the negative | C.time-markers, V.pc | choose | A2–B1 |
| C.en-dans | *en* against *dans* with places and with time | C.time-markers | choose | A1–A2 |
| C.prep-infinitive | *pour* + infinitive for purpose; *avant de*, *sans*, *au lieu de*, *afin de* + infinitive | V.pres-modals | gap | A1–B2 |
| C.cause | Cause: *parce que, à cause de, grâce à, car, comme, puisque, en raison de, faute de* | C.prep-infinitive | choose | A2–B2 |
| C.consequence | Consequence: *donc, alors, c'est pourquoi, par conséquent, si bien que, tellement … que* | C.cause | choose | A2–B2 |
| C.opposition | Opposition and concession: *mais, alors que, par contre, en revanche, pourtant, cependant, malgré, bien que* + subjonctif, *même si* + indicative, *quand même* | C.consequence, V.subj-triggers | choose | A2–B2 |
| C.purpose-condition | Purpose and condition: *pour que, afin que, à condition que, pourvu que* + subjonctif; *au cas où* + conditionnel | C.opposition, V.subj-triggers | choose | B1–B2 |
| C.chronology | Ordering a story: *d'abord, puis, ensuite, après, enfin, finalement*; *la veille, le lendemain, d'ici* | V.narration | order | A2–B1 |

### S — Sentence patterns

| id | bit | needs | exercise | placed |
|---|---|---|---|---|
| S.exclamation | *quel …!, que …!, comme …!* | Q.quel | transform | A2 |
| S.emphasis | Putting a thing first: *ce qui / ce que … c'est …*, *moi, je …*, *c'est … qui / que* | R.ce-qui, R.stress | transform | B1 |
| S.nominalisation | The noun from the verb for a headline or a title: *arriver → l'arrivée, développer → le développement* | D.gender-endings | gap | B1 |
| S.tu-vous | *tu* against *vous*, and what it does to the whole sentence: the verb, the possessive, the pronoun | R.subject, D.possessive | transform | A1 (socio-cultural in the Inventaire) |
| S.avoir-idioms | *avoir faim / soif / chaud / froid / peur / besoin de / envie de / raison / tort / mal à / … ans* — states English says with *be* | V.pres-etre-avoir | gap | A1–A2 |
| S.impersonal | *il faut, il y a, il fait (beau), il est (tard), il s'agit de, il vaut mieux* | V.pres-modals | gap | A1–B1 |

## What is left out, and why

- **Producing the passé simple and the subjonctif imparfait.** Both are read
  and not said; the Inventaire puts the passé simple at C1 even for reading.
  A recognition bit for the passé simple stays, because novels and
  newspapers use it, and nothing more.
- **The passé antérieur, the subjonctif plus-que-parfait, the literary
  concordance.** C1 and above.
- **Vocabulary-shaped items** the Kwiziq lists count as grammar (*visiter*
  against *rendre visite à*, *manquer à / de*, *faire la queue*). Those are
  words, and they are in the deck as words, with their chunks.
- **Register and discourse** (the connectors for structuring an argument at
  B2, the rituals of a formal letter). They are not rules and are not
  practised with gaps.

## Coverage check

Every grammar line of the Inventaire's Annexe E for A1–B2 maps to at least
one bit above; the mapping was done line by line while writing the tables,
and the *placed* column is the trace. The Kwiziq A1–B2 lists are covered at
the level of rule: where Kwiziq has one lesson per verb (*conjugate boire in
the present tense*), the bit here is the group and the verb is an item the
catalogue already carries. The three things neither source lists and this
inventory adds are the pronunciation rules of verb endings and plurals
(needed by every tense bit and by the plural agreement Bartning & Schlyter
put last), the number-pronunciation sandhi, and the Swiss numerals; each is
marked "—" with its reason.

A test should keep this true: every bit id in the tables above exists in the
code as a bit, every *needs* names a bit that exists, and the graph has no
cycle. That is a table test in `app/tests`, like `keys.test.ts`.
