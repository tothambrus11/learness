# Grammar bits — what to teach, in what order, and how to grade it

*Written 2026-09-20, from the discussion of the form channel asking for tenses
nobody had taught. Revised the same day: a rule and an exercise are not one
thing, and the numbers showed it.*

The form channel asks "say *il partait*" the second time a verb's form card
comes round, and nothing in the app has said what the imparfait is or how it
is built. A flashcard per verb assumes the pattern is known; the pattern is
never introduced. This document is the inventory of the patterns — the
*grammar bits* — with their dependencies, how each is practised, and how an
exercise with many answers in it is graded. It is grounded in the sources
below so that nothing important is missing, and it stops at B2.

## Decisions taken while planning the build

Three, after the design above was written, recorded here so the document
and the code agree:

1. **Every bit is opt-in.** No bit opens by itself, not the présent, not by
   implication; *needs* and *after* are advice the Grammar screen states.
2. **Grammar is interleaved with word cards from the first exercise**, not
   dealt as a block after them: a sitting mixes bits with each other and
   with words.
3. **The first content is the présent of regular verbs and negation with
   *ne … pas***; numbers follow. The tense gate — a verb's form cards ask
   only tenses the learner has started — lands first, before any new
   exercise, because it is the relief the whole thing began with.

## Where it stands

What the branch built, milestone by milestone, so the document says what
is code and what is still design:

* **The tense gate** (`grammar/gate.ts`): a verb's form cards ask only the
  tenses whose bit the learner has started on the Grammar screen, and
  nothing until one is.
* **The registry** (`grammar/rules.ts`, generated from the tables below
  and kept equal to them by a test), **the records** (`RuleCard`,
  `Attempt`, `BitState`, each synced and versioned), **the grading router**
  (`grammar/grade.ts`) and **the derivations** (`grammar/derive.ts`:
  committed, breadth, passed, due).
* **Five generators**: the **table** (`grammar/table.ts`) for the regular
  présent groups, *partir*'s and *ouvrir*'s, the verbs learned as
  themselves (*être, avoir, aller, faire*, the modals, *venir, tenir*,
  *savoir, connaître*), the passé composé of the *avoir* verbs, and the
  imparfait, the futur and the conditionnel on any verb whose stem is the
  rule's, and the **form** — one cell of those tables — once the rule is
  passed; the **sentence** as negation, *pas de*, *jamais / plus*
  (`grammar/negation.ts`) and the *est-ce que* question
  (`grammar/questions.ts`), all on the *transform* face; the **determiner**
  (`grammar/determiners.ts`) for *le / la*, *au / du*, *mon / ma / mes* and
  *ce / cet / cette* on the learner's own nouns; the **number**
  (`grammar/numbers.ts`, the *spell* face) for the nine number-writing
  rules, in both dialects, and for the ordinals and telling the time. Each is dealt among the word cards
  (`grammar/deal.ts`, `plan.ts` `interleave`), answered on the card as a
  column of cells, and shown on the Grammar screen with its lesson
  (`grammar/lessons/`) and its breadth.
* **Not yet built**: the *boundary* and *agreement* generators; the
  *which*, *say*, *hear*, *order* and *mark* faces for rules; several
  instances at once; the P, D, J, R, Q, C and S modules'
  exercises; the change machinery (aliases, re-labelling), which waits for
  the first rule that actually changes. The inventory is complete; the
  exercises cover thirty-three of its rules.

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
Lyster (2004) that teaching them explicitly works. The grading model below
is the knowledge-component view of intelligent tutoring (Koedinger, Corbett
& Perfetti 2012; Bayesian knowledge tracing, Corbett & Anderson 1995): a
learner's answer is evidence about each of the pieces of knowledge it
needed, and the pieces are tracked, not the exercises.

**Pronunciation.** Delattre's three-way classification of liaison
(obligatoire / facultative / interdite) is the standard and what every
textbook teaches; the Wikipedia articles on liaison, elision and French
orthography summarise the rules with the lists of exceptions. The learner
lives in Valais, so the Swiss forms are taught as the norm where they
differ: *septante, huitante, nonante*, and the vowel distinctions Swiss
French keeps that Paris has dropped.

## Rules, items, and instances

Three kinds of thing, and the model is mostly the relations between them.

**A rule** is one pattern that fits in one sentence: *cent* takes an *s*
only when it ends the number; the imparfait ending for *nous* is *-ions*;
liaison is obligatory between a determiner and its noun. A rule is what is
tracked: it has an FSRS card, a count of the distinct instances it has been
answered right on, and the rules it needs. The tables below are the rules.

**An item** is a fact with no pattern behind it: *sommes* is the *nous* form
of *être*; *quinze* is fifteen; *haricot* has an aspirated *h*. Items are
tracked too, mostly by cards the app already has — a verb's form card, a
word's card — and a bit that says "as items" is a rule whose instances are
a closed list to learn one by one.

**An instance** is one concrete thing the learner is asked: the number 281,
the imparfait table of *finir*, the sentence *les enfants arrivent* with its
boundaries to mark. An instance is *generated* from data (a number, a verb
table from the catalogue, a corpus sentence) and *analysed* into the rules
and items it observes: writing 281 as *deux cent huitante-et-un* applies the
rule for *cent* without *s*, the Swiss ten, the hyphen, and *et un*; the
*nous* cell of *finir*'s imparfait applies the stem rule and the *-ions*
ending; the boundary in *les enfants* applies the obligatory-liaison rule and
the *s → z* sound rule. The analyser is a function, the same one for the
lesson's examples, the answer key and the grade, so the three cannot
disagree.

So a rule and an exercise are not one thing. A rule says which *generators*
can observe it; an instance observes many rules at once; and the learner who
writes four numbers has made observations on a dozen rules, each credited.
That is what the learner asked for, and it is what the knowledge-component
model says anyway. What ties a rule to its exercise in the tables is only
which generators it appears in.

**A bit is a rule with a lesson.** The lesson is a paragraph of prose, a
table where the rule is a table, and three or four real sentences. The prose
is written by hand, as the function-word inventory is, because it is
teaching and not a fact the pipeline could look up. The tables come from the
verb tables already in the catalogue (kaikki), the sentences from the corpus
already on disk (Tatoeba), and a bit's instances draw only on words the
learner already knows: a rule practised on *partir* when you cannot yet
produce *partir* is today's mistake one level up.

**Every bit is opt-in, and needs is advice.** The learner browses the
topics and commits to a bit by reading its lesson and starting it; the app
never opens one for them. A bit *needs* the bits its instances are built
from — the imparfait needs the présent, because its stem is the *nous* form
— and the screen says so ("builds on the présent, not started"), but it is
a sentence, not a lock: the learner picks. A few bits are also marked
*after* another, the order the acquisition research says learners take and
the syllabus follows (the imparfait after the passé composé); the screen
suggests it. Level is not a gate either: the "placed" column says where the
syllabus puts a point, so that a learner who wants the subjonctif early can
see what it rests on, not so that the app can refuse. What the app does
enforce is that a bit's exercises draw only on words the learner already
knows: a rule practised on *partir* when you cannot yet produce *partir* is
the old mistake one level up.

Some bits are already in the app in another shape. The function-word
channel teaches the prepositions, negation words, connectives and degree
adverbs as words met in sentences; those bits below say so and add only the
rule (where *ne* goes with a compound tense, which connective takes the
subjonctif). The which-time and voice cards are the recognition and
speaking instances of the tense bits, gated by them.

## Generators, faces, and how many at once

An exercise is a generator, a face, and a multiplicity. They vary
independently, which is what keeps the count small.

**Generators** turn data into instances and label every answer part with
the rules and items it observes. There are six, and each is a pure function
in `lib` with a table test:

| generator | data in | instance out | labels from |
|---|---|---|---|
| **number** | an integer, a time, a date, a price, a phone number | its words, its digits, its sound | the number grammar below, applied token by token |
| **table** | a verb and a tense from the catalogue | the six cells, from the infinitive and the pronouns | the tense's stem and ending rules; a flagged cell is the verb's own item |
| **form** | a verb, a tense and a person | one form, in or out of a sentence | as table, one cell |
| **sentence** | a corpus sentence with a target word, a pipeline-marked form, or a rule's pattern in it | the sentence with one part blanked, given, or to be rewritten | the rule the selector asked for, plus every rule the blank cannot be right without |
| **boundary** | a sentence, with each word's aspirated-*h* flag from the catalogue | its word boundaries, each classified | the liaison, elision and enchaînement rules, and the sound of the consonant |
| **agreement** | a noun phrase from the corpus with its gender and number | the noun and its adjective, one of them to be inflected | the gender and number rules, and the adjective's irregular feminine as an item |

Every label obeys one criterion: **a rule is observed by an answer part only
when a wrong application of that rule would make the part wrong.** Writing
*deux cent un* observes the *cent*-without-*s* rule (writing *cents* would be
wrong) but not the *mille* rule (which never came up). The *je* cell of an
imparfait table observes the ending rule but not the plural agreement.
A gap for the passé composé of *partir* in a negative sentence observes the
participle, the auxiliary and where *pas* goes, because any of the three
wrong makes the answer wrong. Incidental knowledge the answer does not
depend on is not credited, so a rule's history is made of discriminating
evidence only.

**Faces** are how an instance is put in front of the learner. Nine, and the
first five are the card's faces today:

| face | the learner… | graded |
|---|---|---|
| **choose** | taps one of a few options | first tap; a wrong one is taken away and the question stands |
| **gap** | types the missing part from a prompt (the infinitive, the pronoun, the digits) | strict, on the letter |
| **which** | reads or hears and says what it means: which time, who *lui* is, singular or plural | first tap |
| **say** | says it aloud, then hears the model and judges | self-graded, as the voice card is now |
| **hear** | hears and types or taps: a number in digits, a minimal pair, a plural | strict |
| **transform** | rewrites what is given: présent → imparfait, statement → question, active → passive | strict on the part the rule changes, tolerant elsewhere |
| **order** | puts given pieces in order: object pronouns, *ne … pas* around a compound tense | whole answer |
| **mark** | taps positions in a written sentence: where the liaisons are, which letters are silent | per position |
| **spell** | writes a number in words from digits, or digits from words | strict, hyphens and agreement included |

**Multiplicity** is a property of the deal, not of the face: one instance,
several instances in a column, or a table. The six cells of a tense are
**gap** × table; four sentences with the same rule are **gap** × several;
sorting twelve verbs into *avoir* and *être* is **choose** × several with
the same two options; four numbers to write are **spell** × several. The
many-answers exercises the learner asked for are the existing faces dealt
several at once, plus one new line kind in `cardface.ts` for a column of
prompt-and-box rows and one for a sentence with tappable boundaries.
Nothing else is new on the screen.

**Selection is by what is due.** A rule's card says when it is due; the
generator is asked for an instance whose labels cover the most due rules
and no rule that is not open. For numbers that means a range: while only
the units and tens are open, the numbers are under a hundred; the day the
*cent* bit opens, three-digit numbers appear, and the ones dealt first are
the ones that also exercise whatever else is due (*deux cent huitante-et-un*
rather than *deux cents*). For verbs it means the tense, the person and the
verb: a table on a verb whose irregular cell is due, a sentence whose
blank needs the rule that is. This is how Duolingo picks sentences by the
half-life of their lexemes; here the unit picked on is the rule.

## Grading: a rule is not a word

A word is one memory and one FSRS card. An exercise with six answers in it
is six observations on some rules and one on others, so the grade is
routed, not averaged.

**Each rule gets one grade per exercise, from its own observations.** FSRS
takes one grade per review, and the table was one act of recall of the
rule, however many cells it filled. Over the parts labelled with that rule:
all right is Good (Easy on a streak, as the ladder climbs today), one wrong
is Hard, more is Again. A rule observed once in the exercise is graded on
that once. So the four numbers *21, 200, 281, 1000* grade the *et un* rule
on two observations, the *cent* rule on two, the *mille* rule on one, and
the hyphen rule on three, each separately.

**Each item gets its own grade from its own part.** *être*'s imparfait stem
wrong is *être*'s card, graded Again, and it comes back sooner — on a table,
on its voice card — while the ending rule, if the other five cells were
right, is graded Good. An irregular is never allowed to punish the rule it
is an exception to, and the rule is never allowed to hide the irregular.

**Nothing is retried for a grade.** The corrections are shown per part, the
card teaches, and the next time is the next review. A **choose** face keeps
the retry it has today, ungraded.

**A rule is passed on breadth.** Its card counts the distinct instances it
has been answered right on; the bit is passed when that count reaches a
handful and the card is mature. A table on one verb is one instance of the
ending rule; four sentences on four verbs are four. That is what the
several-at-once deal is for: breadth in one sitting, on a rule that
generalises.

**A passed bit does not close.** Its card stays in the scheduler, so a rule
unused for a month comes back, on new instances. What "passed" opens is the
bits that need it. Skill Circuits' checkbox is right for a course and wrong
for a language.

**Recognition and production are separate cards** of the same rule, where
the rule has both: reading *il partait* and saying when, and writing
*partait* from *partir*, are two intervals, as the written and heard
channels of a word are two intervals.

## The inventory

Column *needs* names bit ids; *after* is the soft order explained above.
*Faces* is how the rule is practised; the generator is implied by the
module (numbers by **number**, verb forms by **table** and **form**,
sounds by **boundary**, agreement by **agreement**, the rest by
**sentence**). *Placed* is where the sources put the point: one level where
the Inventaire and Kwiziq agree, both where they differ (Inventaire first),
and "—" for a bit neither lists as such, with the reason in the row.

### P — Sounds and spelling

Pronunciation is taught as rules because the rules are what a reader cannot
hear: the ending that is written and not said, the consonant that is said
only before a vowel. The app has a voice for every word and sentence, so
every one of these can be heard as well as read, and the **boundary**
generator classifies every word boundary of any sentence the corpus has.

| id | bit | needs | faces | placed |
|---|---|---|---|---|
| P.letters | The alphabet and the five accents: what é, è, ê, ç and the tréma do to a sound; spelling a word aloud | — | hear, say | A1 |
| P.final | Final consonants are silent except *c, r, f, l* — and the exceptions that matter (*-er* infinitives, *blanc, porc, tabac, gentil*) | P.letters | mark | — (FI phonetics) |
| P.e-caduc | The *e* that drops: *samedi, je ne sais pas → j'sais pas*; kept when three consonants would meet | P.final | mark, hear | — (FI phonetics) |
| P.nasal | The nasal vowels *an/en, on, in/ain/ein, un* (Swiss French keeps *un* distinct), and the *n* that comes back before a vowel or a written *n*: *bon / bonne, an / année* | P.letters | hear, say | — (FI phonetics) |
| P.vowel-pairs | *u* against *ou*; *é* against *è* (kept apart in Swiss French at the end of a word: *j'irai / j'irais*); *o* open and closed; *eu* open and closed | P.letters | hear | — (FI phonetics) |
| P.semi | The semi-vowels *oi, ui, ill, y*: *lui, fille, travail, voyage* | P.letters | hear, say | — (FI phonetics) |
| P.r-h | The French *r*; mute *h* against aspirated *h* (*l'homme* but *le héros*), and that the dictionary marks which | P.letters | choose | — (FI phonetics) |
| P.elision | Elision: *je, me, te, se, le, la, ne, de, que, ce* lose their vowel before a vowel; *si* only before *il(s)*; never before an aspirated *h*, *onze*, *oui* | P.r-h | mark, gap | A1 (implicit in every article bit) |
| P.enchaine | Enchaînement: a said final consonant moves onto the next vowel, *il est / i-lest*, *une amie / u-namie* | P.final | mark, say | — (FI phonetics) |
| P.liaison-must | Obligatory liaison: determiner + noun, adjective + noun, pronoun + verb, verb + pronoun in inversion, after *en, dans, chez, très, plus* and in set phrases; *s/x → z, d → t, f → v* in *neuf ans / neuf heures*, *n* with the nasal kept in *mon ami* and lost in *bon ami* | P.enchaine, P.nasal | mark, say | A2 (Inventaire: "liaisons") |
| P.liaison-never | Forbidden liaison: after *et*, after a singular noun, before an aspirated *h*, before *onze* and *oui*, after *quand* and *comment* as question words (except *quand est-ce que*, *comment allez-vous*) | P.liaison-must | mark | — |
| P.liaison-may | Optional liaison and register: plural noun + verb, *est* + complement, *pas* + vowel; more in reading aloud, fewer in speech | P.liaison-never | which | — |
| P.verb-endings | What verb endings sound like: *-ent* is silent (*il parle = ils parlent*), *-er, -ez, -é, -ai* are all /e/, *-ais, -ait, -aient* are /ɛ/, *-ons* and *-ont* are the same nasal; so *ils ont / ils sont* is a liaison, *z* against *s* | P.final, P.liaison-must, V.pres-er | hear, mark | — (needed by every tense bit) |
| P.plural-heard | Plural is heard on the article and the liaison, not the noun: *les amis* /lez‿ami/, *ils aiment* /ilz‿ɛm/; *il aime* and *ils aiment* differ only there | P.liaison-must, D.plural | hear | — (Bartning & Schlyter: last to stabilise) |
| P.questions | Intonation of a yes/no question; rhythm and final stress of a phrase, against English word stress | P.letters | hear, say | A1–B2 (Inventaire: "rythme / intonation") |

### N — Numbers

The learner asked for several lessons on numbers, and the syllabus agrees:
counting, prices, time, dates and measures are A1 functions in the
Inventaire, and Kwiziq has a lesson group for them at every level.

Numbers are the cleanest case of the model, because the number grammar is
small and closed. The **number** generator's analyser writes any integer as
its tokens and names, for each token, the rule that produced it; the rules
are the first ten rows below, and every number is an instance of several.
The lesson for each rule is the same analyser run on chosen examples. The
Swiss forms are the ones produced; the French ones are recognised, as a
rule of their own, because Geneva, France and every timetable use them.

| id | bit | needs | faces | placed |
|---|---|---|---|---|
| N.units | Zero to sixteen as items: *un / une* agrees, the rest do not; *onze* to *seize* are one word each | P.letters | hear, spell, say | A1 |
| N.teens | Seventeen to nineteen are *dix* + unit with a hyphen: *dix-sept, dix-huit, dix-neuf* | N.units | spell, hear | A1 |
| N.tens | The tens as items: *vingt, trente, quarante, cinquante, soixante, septante, huitante, nonante* | N.units | hear, spell, say | A1 |
| N.tens-units | A ten and a unit join with a hyphen: *vingt-deux, huitante-quatre, nonante-neuf* | N.tens | spell, hear | A1 |
| N.et-un | *et un* — no hyphen in the traditional spelling, hyphens throughout since 1990, both accepted — at twenty-one and every tens-plus-one up to *nonante et un*; *et une* before a feminine noun | N.tens-units | spell | A1 |
| N.french-tens | Recognising the French compounds: *soixante-dix* to *soixante-dix-neuf* is sixty plus a teen, *quatre-vingts* to *quatre-vingt-dix-neuf* is eighty plus a number under twenty; *soixante et onze*, *quatre-vingt-un* without *et*; *quatre-vingts* keeps its *s* only when it ends the number; written too, by a learner who has chosen France's numerals | N.et-un | hear, which, spell | A1 (Kwiziq: "70 to 999") |
| N.cent | *cent* multiplies and never takes *un*; it takes an *s* only when it is multiplied *and* ends the number: *cent un, deux cents, deux cent un* | N.tens-units | spell | A1 |
| N.mille | *mille* never varies and never takes *un*: *mille, deux mille, mille un*; *deux mille vingt-six* in a date | N.cent | spell | A1 |
| N.million | *million* and *milliard* are nouns: they take *un*, an *s*, and *de* before what they count — *un million de personnes, deux milliards d'euros*; *deux millions trois cent mille* | N.mille | spell | A1 |
| N.sandhi | The numbers that change sound: *six* and *dix* are /sis/ /dis/ alone, /si/ /di/ before a consonant, /siz/ /diz/ before a vowel; *huit* loses its *t* before a consonant; *neuf* is /nœv/ in *neuf ans* and *neuf heures* only; *vingt* sounds its *t* in *vingt et un* to *vingt-neuf* and before a vowel; *cent* liaises (*cent ans*) but not in *cent un*; *deux, trois* liaise in *z*; *quatre-vingts ans* liaises in *z*, never *t*; no liaison or elision before *huit* and *onze* | N.french-tens, N.cent, P.liaison-must | say, hear | — (needed by everything below) |
| N.ordinal | Ordinals: *premier / première*, then *-ième* on the cardinal (*quatrième* drops the *e*, *cinquième* adds a *u*, *neuvième* turns *f* to *v*); written *1er, 1re, 2e*; *premier* for the first of the month and the first king, cardinals after that (*le deux mai, Louis quatorze*), ordinals for floors and centuries | N.units | spell, gap | A1 |
| N.time | Telling the time: *il est une heure*, *heure(s)* always said, *et quart, et demie, moins le quart, moins dix*, *midi et demi*; the 24-hour clock for timetables, *quinze heures trente* | N.tens-units | hear, spell, say | A1 |
| N.date | Dates: *le premier mai* but *le deux mai*, *en deux mille quinze*, *jeudi 3 septembre* with no capitals, *on est le combien ?* | N.mille, N.ordinal | spell, gap | A1 |
| N.prices | Prices and measures: *trois francs cinquante*, *un euro vingt*, *deux kilos de*, *à dix kilomètres*, *moins dix pour cent* | N.cent | hear, spell | A1 (Inventaire: "quantités et mesures") |
| N.age-duration | Age and spans: *j'ai trente ans* (avoir, never être), *depuis trois ans, pendant deux heures, il y a dix ans, dans une semaine* | N.tens-units, C.time-markers | gap | A1–A2 |
| N.phone | Phone numbers, read in groups: *079 123 45 67* in Switzerland (*zéro septante-neuf, cent vingt-trois, quarante-cinq, soixante-sept*), pairs in France | N.cent | hear, say | — (an A1 function: donner des informations personnelles) |
| N.approx | Roughly: *une dizaine, une douzaine, une quinzaine, une vingtaine, une centaine, un millier* + *de*; *environ, à peu près, presque* | N.cent | gap, choose | A2 |
| N.fractions | Halves and parts: *demi* (agrees after the noun, invariable before it: *une heure et demie, une demi-heure*), *la moitié de, un tiers, un quart, trois cinquièmes*; decimals with a comma, *deux virgule cinq*; percentages | N.ordinal | spell, hear | A2–B1 |
| N.arith | Arithmetic aloud: *et / plus, moins, fois, divisé par, font / égale*; the **hear** face where the answer must be computed, so the number was understood and not just transcribed | N.cent | hear | A2 (Kwiziq) |

### D — Nouns and determiners

| id | bit | needs | faces | placed |
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
| D.countries | Countries and cities take their article and preposition by gender: *en France, au Portugal, aux États-Unis, à Sion, en Suisse*; the canton is *le Valais* but *en Valais* | D.contract | choose | A1 |

### J — Adjectives and adverbs

The **agreement** generator takes a noun phrase from the corpus and asks
for the adjective, so a rule here is observed on many nouns; an irregular
feminine is the adjective's own item.

| id | bit | needs | faces | placed |
|---|---|---|---|---|
| J.agree | Adjectives agree: *-e* for feminine (none if already *-e*), *-s* for plural; *grand / grande / grands / grandes* | D.gender, D.plural | gap | A1 |
| J.fem-irregular | Feminine by rule: *-eux → -euse, -er → -ère, -f → -ve, -ien → -ienne, -el → -elle, -et → -ète / -ette, -c → -che / -que*; and the ones to learn as items (*long, frais, faux, doux, sec, gentil, favori, grec*) | J.agree | gap | A1–A2 |
| J.plural-x | Plural in *-x*: *-al → -aux* (*banals* excepted), *-eau → -eaux*; *-s, -x* unchanged | J.agree | gap | A2–B1 |
| J.position | Most adjectives follow the noun; the short common ones go before (*beau, bon, grand, gros, jeune, joli, mauvais, nouveau, petit, vieux*) | J.agree | order | A1 |
| J.beau | *beau / bel / belle, nouveau / nouvel / nouvelle, vieux / vieil / vieille* before a vowel | J.position, P.elision | gap | A1 |
| J.meaning-position | An adjective that changes meaning with its place: *un ancien collègue / un bâtiment ancien, ma propre voiture / une voiture propre, un certain âge / une réponse certaine* | J.position | which | B1 |
| J.colours | Colours: agree, except those named after things (*orange, marron*) and compounds (*bleu clair*) | J.agree | gap | A1–B1 |
| J.compare | Comparing: *plus … que, moins … que, aussi … que* with adjectives and adverbs; *plus de … que* with nouns; *autant que* with verbs | J.agree | transform | A2 |
| J.superlative | The superlative: *le plus …, le moins …*, the article repeated after the noun (*la ville la plus belle*); *de* for "in" | J.compare | transform | A2 |
| J.bon-bien | *bon / meilleur / le meilleur* against *bien / mieux / le mieux*; *mauvais / pire* | J.compare | choose | A2–B1 |
| J.adverb-ment | Adverbs in *-ment*: from the feminine (*lentement*), from the vowel masculine (*vraiment*), *-ant / -ent → -amment / -emment*; the irregular set (*bien, mal, vite, mieux*) | J.fem-irregular | gap | A1–A2 |
| J.adverb-position | Where the adverb goes: after the verb in a simple tense, between auxiliary and participle in a compound one for the short ones (*déjà, toujours, bien, beaucoup*) | J.adverb-ment, V.pc | order | A2 |
| J.more-and-more | *de plus en plus, de moins en moins, plus … plus …* | J.compare | gap | A2–B1 |

### R — Pronouns

| id | bit | needs | faces | placed |
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
| R.pronoun-imperative | Pronouns after an affirmative command with a hyphen, *me → moi*, *te → toi*; before a negative one: *donne-le-moi, ne me le donne pas*; *vas-y, parles-en* get their *s* back | R.io, V.imperative | transform | A2–B1 |
| R.order | Two pronouns at once: *me / te / se / nous / vous* before *le / la / les* before *lui / leur* before *y* before *en* | R.pronoun-imperative | order | B1–B2 |
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

Each tense is at least two bits: how it is built for the regular groups,
and its irregular members as items. The **table** generator takes the
verb's table from the catalogue; the pipeline already separates stem from
ending and flags the cell that departs from the pattern, so which group a
verb belongs to and which cells are exceptions is computed, never authored.
What is authored is the rule in words. A cell observes the tense's ending
rule and its stem rule; a flagged cell observes the verb's own item instead
of the stem rule.

| id | bit | needs | faces | placed |
|---|---|---|---|---|
| V.pres-er | Présent of *-er* verbs: stem + *-e -es -e -ons -ez -ent*; four of the six sound the same | R.subject, P.final | gap, say | A1 |
| V.pres-etre-avoir | *être* and *avoir* in the présent, as items; *c'est / il y a / j'ai … ans* | V.pres-er | gap, say | A1 |
| V.pres-aller-faire | *aller* and *faire*, as items; *aller* for how you are, *faire* for weather and sport | V.pres-etre-avoir | gap | A1 |
| V.pres-ir | Présent of *-ir* verbs like *finir*: *-is -is -it -issons -issez -issent* | V.pres-er | gap | A1 |
| V.pres-re | Présent of *-re* verbs like *vendre, attendre*: *-s -s — -ons -ez -ent*; *prendre* and family lose the *d* in the plural (*prenons, prennent*), *mettre* and *battre* drop a *t* in the singular (*je mets*) | V.pres-ir | gap | A1 |
| V.pres-tir | *partir, sortir, dormir, servir, sentir*: the stem loses its last consonant in the singular (*je pars, nous partons*) | V.pres-re | gap | A1 |
| V.pres-ouvrir | *ouvrir, offrir, souffrir, découvrir, cueillir* conjugate like *-er* verbs | V.pres-er | gap | A2 |
| V.pres-spelling | The spelling-change groups: *-cer → ç* and *-ger → ge* before *a / o* (*commençons, mangeons*); *-yer → i* before a silent *e* (*paie / paye* both for *-ayer*); *-eler / -eter* double the consonant (*appelle, jette*) where *acheter, geler, peler* take *è*; *é_er* and *e_er* take *è* in the stressed forms (*préfère, lève*) | V.pres-er | gap | A1–A2 |
| V.pres-modals | *pouvoir, vouloir, devoir* as items, each with two stems (*peux / pouvons / peuvent*); modal + infinitive; *il faut* | V.pres-aller-faire | gap | A1 |
| V.pres-venir | *venir, tenir* and derivatives: *viens / venons / viennent*; *venir de* + infinitive for just did | V.pres-modals | gap | A1 |
| V.pres-savoir-connaitre | *savoir* and *connaître* as items, and the difference (a fact or a skill against a person or a place) | V.pres-modals | gap, choose | A2 |
| V.pres-dire-lire-ecrire | *dire, lire, écrire* and family (*vous dites*, *ils lisent*, *nous écrivons*) | V.pres-re | gap | A1–A2 |
| V.pres-voir-croire-boire | *voir, croire, boire, recevoir* and *-cevoir*: two stems each, *vois / voyons, crois / croyons, bois / buvons, reçois / recevons* | V.pres-re | gap | A1–A2 |
| V.pres-uire-aindre | *conduire, construire* and *-uire* (*-uis / -uisons*); *craindre, peindre, joindre* (*-ains / -aignons*) | V.pres-re | gap | A2 |
| V.pres-rest | The rest of the common irregulars as items: *courir, mourir, vivre, suivre, rire, s'asseoir, valoir, acquérir*; the impersonals *falloir, pleuvoir* | V.pres-uire-aindre | gap | A2–B1 |
| V.pres-3pl | Third-person plural: *ils prennent, ils viennent, ils finissent* — the form that is written and mostly not heard, and the last to become automatic | V.pres-venir, P.plural-heard | gap, hear | — (Bartning & Schlyter, stages 2–5) |
| V.pronominal | Pronominal verbs: *se lever, s'appeler, se souvenir*; the pronoun agrees with the subject; reflexive, reciprocal and idiomatic uses | V.pres-er, R.reflexive | gap | A1 |
| V.participle | The past participle: *-er → -é, -ir → -i, -re → -u*; and the irregular set as items (*eu, été, fait, pris, mis, dit, écrit, vu, bu, lu, su, pu, dû, voulu, venu, ouvert, mort, né, connu, reçu, conduit, peint, vécu, plu, ri, suivi, couru, assis*) | V.pres-re | gap | A2 |
| V.aux | *avoir* or *être* in the compound tenses: *être* for the verbs of coming and going and change (*aller, venir, arriver, partir, entrer, sortir, monter, descendre, naître, mourir, rester, tomber, retourner, passer, devenir, revenir, rentrer*) and every pronominal verb; *avoir* for the rest | V.participle, V.pres-etre-avoir | choose | A1–A2 |
| V.aux-transitive | *monter, descendre, sortir, passer, rentrer, retourner* take *avoir* with a direct object: *j'ai sorti le chien* | V.aux | choose | B1–B2 |
| V.pc | The passé composé: auxiliary in the présent + participle; the meaning (done, once, over) | V.aux | gap, transform, which | A1–A2 |
| V.pc-agree-etre | With *être* the participle agrees with the subject: *elle est partie, ils sont venus* | V.pc, J.agree | gap | A2 |
| V.pc-agree-do | With *avoir* it agrees with a direct object that comes *before*: *la lettre que j'ai écrite, je les ai vues*; with a pronominal verb, only when the reflexive pronoun is the direct object (*elle s'est lavée* but *elle s'est lavé les mains*) | V.pc-agree-etre, R.pronoun-compound, R.rel-qui-que | gap | B1 (B2 for the exceptions) |
| V.pc-pronominal | Pronominal verbs in the passé composé: *être*, the pronoun before it, *je me suis levé(e)* | V.pc-agree-etre, V.pronominal | gap | A2 |
| V.imparfait | The imparfait: the *nous* stem of the présent + *-ais -ais -ait -ions -iez -aient*; *être* has *ét-*; *-cer / -ger* keep the *ç / ge* before *a* · after V.pc | V.pres-modals, P.verb-endings | gap, transform | A2 |
| V.pc-vs-imp | Passé composé against imparfait: the event against the scene; what happened against what was going on, used to happen, or was the case; verbs whose meaning shifts (*je savais / j'ai su*, *je devais / j'ai dû*) | V.pc, V.imparfait | which, gap | A2–B1 |
| V.narration | The past in a story: présent, passé composé and imparfait together; *depuis* with the imparfait | V.pc-vs-imp | gap | B1 |
| V.futur-proche | *aller* + infinitive for what is about to happen; *être en train de* for what is happening; *venir de* for what just did | V.pres-aller-faire | transform | A1 |
| V.futur | The futur simple: the infinitive (minus *-e* for *-re*) + *-ai -as -a -ons -ez -ont*; the irregular stems as items (*ser-, aur-, ir-, fer-, viendr-, pourr-, voudr-, devr-, saur-, verr-, enverr-, recevr-, courr-, mourr-, faudr-*); after *quand / dès que* where English uses the présent · after V.imparfait | V.pres-er, P.verb-endings | gap, transform | A2·K B1 |
| V.conditionnel | The conditionnel présent: the futur stem + the imparfait endings; *-rai* against *-rais* is the whole difference on the page, and /e/ against /ɛ/ in the mouth | V.futur, V.imparfait, P.vowel-pairs | gap, hear | A2·K B1 |
| V.cond-uses | What the conditionnel is for: politeness (*je voudrais, pourriez-vous*), the imagined (*si j'avais le temps, je viendrais*), *devrais* should and *pourrais* could, a report that is not confirmed | V.conditionnel | gap, which | A1 (politeness) – B1 |
| V.si-clauses | The three *si* sentences: *si* + présent → présent / futur / impératif; *si* + imparfait → conditionnel; *si* + plus-que-parfait → conditionnel passé; never a futur or conditionnel after *si* | V.cond-uses, V.pqp | gap, transform | B1 (B2 for the third) |
| V.imperative | The impératif: the *tu, nous, vous* forms of the présent without the pronoun; *-er* verbs (and *aller, ouvrir*) drop the *s* of *tu*; *être / avoir / savoir / vouloir* as items (*sois, aie, sache, veuillez*); negative around the verb | V.pres-er, V.pres-etre-avoir | gap, transform | A1–A2 (B2 for the items) |
| V.pqp | The plus-que-parfait: auxiliary in the imparfait + participle, for what had already happened | V.imparfait, V.pc | gap | B1 |
| V.futur-anterieur | The futur antérieur: auxiliary in the futur + participle; for what will have happened, and for a guess (*il aura oublié*) | V.futur, V.pc | gap | B2 |
| V.cond-passe | The conditionnel passé: auxiliary in the conditionnel + participle; regret and reproach (*j'aurais dû, tu aurais pu*) | V.conditionnel, V.pc | gap | B2 |
| V.subj-forms | The subjonctif présent: the *ils* stem + *-e -es -e -ions -iez -ent*; *nous / vous* borrow the imparfait forms, so a two-stem verb has two stems here too (*boive / buvions*); the items: *sois, aie, aille, fasse, puisse, sache, veuille, faille, vaille, pleuve* · after V.futur | V.pres-3pl, V.imparfait | gap | B1 (forms) · K B2 |
| V.subj-triggers | When the subjonctif is required: after *que* following necessity (*il faut que*), wanting (*je veux que*), feeling (*je suis content que*), doubt (*je ne pense pas que*), and the conjunctions *pour que, bien que, avant que, jusqu'à ce que, à condition que, sans que*; the subject must change, otherwise the infinitive | V.subj-forms | choose, gap | B1–B2 |
| V.subj-vs-ind | Indicative after *penser que, croire que, espérer que, dire que* in the affirmative; subjonctif when they are negated or questioned; *après que* takes the indicative | V.subj-triggers | choose | B1–B2 |
| V.subj-passe | The subjonctif passé for what is already done: *je suis content que tu sois venu* | V.subj-forms, V.pc | gap | B2 |
| V.passe-simple | Reading the passé simple: *-a / -èrent* for *-er*, *-it / -irent* and *-ut / -urent* for the rest, *fut, eut, fit, vint*; recognised, never produced | V.pc, V.imparfait | which | B2 (recognition) · Inventaire C1 |
| V.gerondif | *en* + present participle for while and by: *en travaillant*; the participle from the *nous* stem + *-ant*, three irregular (*ayant, étant, sachant*) | V.imparfait | transform | B1 |
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

| id | bit | needs | faces | placed |
|---|---|---|---|---|
| G.pas | *ne … pas* around the conjugated verb; *n'* before a vowel; *si* to say yes to a negative question | V.pres-er, P.elision | transform | A1 |
| G.pas-infinitive | Both halves before an infinitive: *ne pas fumer*; around the modal otherwise: *je ne veux pas partir* | G.pas, V.pres-modals | order | A1–A2 |
| G.others | *ne … jamais / plus / rien / personne / pas encore / nulle part*; *personne ne …, rien ne …* as subjects | G.pas | transform | A1–B1 |
| G.pas-compound | The negation around the auxiliary: *je n'ai pas vu*, but *je n'ai vu personne* | G.others, V.pc | order | A2 |
| G.que | The restrictive *ne … que* for only, and *ne … aucun(e)*, *ne … ni … ni* | G.others | transform | A2–B1 |
| G.combined | Two negations together: *plus jamais, plus rien, jamais personne* | G.que | order | B1 |
| G.spoken | *ne* dropped in speech: *je sais pas*; recognised, and written only in dialogue | G.pas, P.e-caduc | which | B1 (Kwiziq) |

### Q — Questions

| id | bit | needs | faces | placed |
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

| id | bit | needs | faces | placed |
|---|---|---|---|---|
| C.place | *à, en, au, aux, dans, chez, sur, sous, devant, derrière, entre, à côté de, en face de, près de, loin de*; *à* for a city, *en / au / aux* for a country by gender | D.countries | choose | A1 |
| C.transport | *à* against *en* with transport: *à pied, à vélo, en train, en voiture* | C.place | choose | A1 |
| C.time-markers | *depuis* (still going), *il y a* (ago), *pendant* (a span), *pour* (a planned span), *dans* (from now), *en* (how long it takes), *dès, à partir de* | N.tens-units | choose, gap | A1–B1 |
| C.depuis-tense | *depuis* takes the présent where English takes the perfect; the passé composé only in the negative | C.time-markers, V.pc | choose | A2–B1 |
| C.en-dans | *en* against *dans* with places and with time | C.time-markers | choose | A1–A2 |
| C.prep-infinitive | *pour* + infinitive for purpose; *avant de*, *sans*, *au lieu de*, *afin de* + infinitive | V.pres-modals | gap | A1–B2 |
| C.cause | Cause: *parce que, à cause de, grâce à, car, comme, puisque, en raison de, faute de* | C.prep-infinitive | choose | A2–B2 |
| C.consequence | Consequence: *donc, alors, c'est pourquoi, par conséquent, si bien que, tellement … que* | C.cause | choose | A2–B2 |
| C.opposition | Opposition and concession: *mais, alors que, par contre, en revanche, pourtant, cependant, malgré, bien que* + subjonctif, *même si* + indicative, *quand même* | C.consequence, V.subj-triggers | choose | A2–B2 |
| C.purpose-condition | Purpose and condition: *pour que, afin que, à condition que, pourvu que* + subjonctif; *au cas où* + conditionnel | C.opposition, V.subj-triggers | choose | B1–B2 |
| C.chronology | Ordering a story: *d'abord, puis, ensuite, après, enfin, finalement*; *la veille, le lendemain, d'ici* | V.narration | order | A2–B1 |

### S — Sentence patterns

| id | bit | needs | faces | placed |
|---|---|---|---|---|
| S.exclamation | *quel …!, que …!, comme …!* | Q.quel | transform | A2 |
| S.emphasis | Putting a thing first: *ce qui / ce que … c'est …*, *moi, je …*, *c'est … qui / que* | R.ce-qui, R.stress | transform | B1 |
| S.nominalisation | The noun from the verb for a headline or a title: *arriver → l'arrivée, développer → le développement* | D.gender-endings | gap | B1 |
| S.tu-vous | *tu* against *vous*, and what it does to the whole sentence: the verb, the possessive, the pronoun | R.subject, D.possessive | transform | A1 (socio-cultural in the Inventaire) |
| S.avoir-idioms | *avoir faim / soif / chaud / froid / peur / besoin de / envie de / raison / tort / mal à / … ans* — states English says with *be* | V.pres-etre-avoir | gap | A1–A2 |
| S.impersonal | *il faut, il y a, il fait (beau), il est (tard), il s'agit de, il vaut mieux* | V.pres-modals | gap | A1–B1 |

## The records

What is written down, what is derived, and what happens to the learner's
history when the code changes. The rules of `model.ts` hold here too: a
card is state, can be recomputed, merged and thrown away; a log row is what
happened, is append-only, and is never edited; anything a later reader would
need that it could not recover is written at the moment it happens.

### Four records, and what is not one

**An attempt** is the log row: one exercise answered, whole. It is the
grammar's review, and it is the record everything else can be rebuilt from.

```ts
interface Attempt {
  uid: string;             // identity everywhere; the sync unions on it
  ts: Seconds;             // the log's unit, as reviews
  ms: number | null;
  gen: string;             // 'number' | 'table' | 'sentence' | … as a string
  face: string;            // 'gap' | 'spell' | … as a string
  spec: unknown;           // what the generator was given: { n: 281, dialect: 'ch' },
                           // { key: 'finir|verb', tense: 'imp' }, { sid: 1234567, gap: 2 }
  instance: string;        // 'number:281' | 'table:finir|verb:imp' | 'sentence:1234567:2'
  parts: {
    expected: string;      // the answer key, as it was that day
    got: string;           // what the learner wrote, tapped, or judged
    ok: boolean;
    obs: { of: string; ok: boolean }[];   // 'N.cent' | 'item:être|verb:imp:3'
  }[];
  grades: Record<string, Rating>;         // the grade each card actually received
  v: number;               // the version of this record kind when written
  genv: number;            // the version of the generator's analyser that labelled it
  synced?: boolean;
}
```

Three things about it are deliberate. It carries *both* the raw answer and
the labels: the labels are what the day's grading used and cannot be taken
back; the raw answer with its spec is what a better analyser can re-label
later. It carries the answer key as it was, so a catalogue rebuild that
corrects a table does not make an old right answer wrong in the log. And
`gen`, `face` and `spec` are strings and `unknown`: an attempt from a
generator this version does not know is kept, synced and ignored, never
refused — the same posture `Pull` takes with a field it does not expect.

**A rule card** is the FSRS state of one rule in one mode, in a store of
its own rather than in `cards`, because a `CardId` names a word and a rule
is not one; the type system should keep refusing `getCard(rule)`.

```ts
interface RuleCard extends Schedule {
  id: string;              // 'N.cent|produce' | 'V.pc-vs-imp|recognise'
  rule: string;
  mode: 'recognise' | 'produce';
  updatedAt?: Millis;      // last-write-wins on the last answer, as cards
  streak?: number;
  retired?: boolean;       // the rule is gone; the card and its history stay
  v: number;               // the version of this record kind when written
}
```

**A bit record** is the learner's one act on a bit: opening it.

```ts
interface BitState {
  id: string;              // the rule id
  openedAt: Millis;
  updatedAt: Millis;       // last-write-wins with a tombstone, as words
  deleted?: boolean;
  v: number;
}
```

**Items** get no new record. An observation on *être*'s imparfait stem
grades the verb's existing form card, which is the app's one card per verb;
the attempt keeps the finer fact (which cell), and the form card's next
deal reads the attempts to prefer the cell that failed. The alternative, a
card per irregular cell, is the six-hundred-by-six arithmetic that the one
form card per verb exists to avoid. The units of the number grammar are the
same: one rule card, seventeen instances, the failed one dealt first.

**Not stored, because derived:** whether a bit is *passed* (breadth and
maturity, read off the attempts and the rule card), the breadth count
itself, what is due, and which instance to deal next. Each of those is a rule, and a rule that is
derived changes when the code changes, with no migration. The one setting
is which numerals to produce, Swiss or French, and the attempt's `spec`
records which was in force.

### Identities

The learner's history hangs on identities, not on versions, so these are
the things that must never change meaning:

- **Rule ids** (`N.cent`). Never reused for a different rule. A rule whose
  meaning changes gets a new id; the old one is aliased or retired.
- **Instance ids.** `number:281` is 281 for ever. `table:finir|verb:imp` is
  a word key and a tense id, both already identities. `sentence:<sid>:<gap>`
  needs the Tatoeba sentence id, which the pipeline has (`sid` in
  `sentences.py`) and does not export: the catalogue's `Example` gains an
  `id`. Until then a sentence instance is identified by its text, which
  survives a rebuild only if the sentence does.
- **Item refs.** `item:<word key>:<tense id>:<person>` with the person as
  its index in the pipeline's pronoun order, which is a convention older
  than the app; never a cell's position in a rendered table.
- **Tense ids** (`imp`, `pc`) are the pipeline's and `TENSE_NOTES`'s
  already, and are not renamed.

### The changes I expect, and what each costs

| change | what happens to the history | migration |
|---|---|---|
| A rule is **split** (`V.imparfait` into endings and stem) | Attempts keep the old label; a reader maps it through `RULE_ALIASES` to both new ids. For a deterministic generator (numbers, tables) the reader can re-run the analyser on `spec` and get exact new labels instead. | Rule cards: copy the old card's schedule to each new id at db upgrade, retire the old. The bit record is copied. |
| Two rules are **merged** | Aliases, many to one. | Keep the more mature of the two cards. |
| A rule is **renamed** | Alias. | Rename the card and the bit record in the upgrade. |
| A rule is **removed** | Its attempts stay in the log, as the speaking direction's reviews stayed. | Retire the card; the bit record is left. |
| A rule is **added as a prerequisite** of rules already open | Nothing. A bit already opened stays open, and *needs* is advice: the new bit is a line on the screen under the ones that build on it, until the learner starts it. | None. |
| The **labelling criterion** changes, or the analyser had a bug | Old rows carry `v`; a reader re-labels rows from deterministic generators and keeps the stored labels for the rest. | None; on read. |
| The **grading thresholds** change | Apply from now. Past card states stand: FSRS adds fuzz and cannot be replayed exactly, which is why cards are last-write-wins already. | None. |
| The **pass threshold** changes | Derived; applies at once, forward and backward. | None. |
| A **face** or **generator** is added or dropped | Strings in the attempt; unknown ones are kept and ignored. | None. |
| The **catalogue** corrects a table, or a sentence leaves the corpus | The attempt has its own answer key and its instance id; breadth still counts it; selection cannot deal it again. | None. |
| A **new record kind** is needed | — | A store in `db.ts` under a new version, a table under `server/migrations`, one more name in the Worker's list of kinds and one more optional field on `Pull`. The Worker stores every kind as opaque JSON keyed by id, so it never needs to understand the shape. |

### Where a migration runs

Four levels, and each kind of record has its level.

1. **On read, for logs.** An attempt is never rewritten. `trustAttempt(raw)`
   understands every version ever written and hands back the current shape,
   as `'met' in review` and `trustLesson` do today. This is where aliases
   and re-labelling live. It is lazy, cheap, and reversible, because the row
   on disk is still what happened.
2. **In the db upgrade, for state, over the whole kind at once.** Rule cards
   and bit records are transformed in the upgrade transaction, as the
   direction cards became ladder cards. Whole kind, one transaction, because
   some transformations are relational: which of two merged cards to keep is
   a question about both, and settling rungs was a question about a word's
   whole channel.
3. **On the way in from sync, with the same mapper.** A device that has not
   upgraded must not be able to reintroduce the old shape; `merge.ts` runs
   `legacyToChannel` on pulled cards for that reason, and runs the rule-card
   mapper for the same one.
4. **Never on the server.** The Worker adds tables by migration file and
   otherwise stores what it is given. A `d1 execute` by hand is how a deploy
   once went out ahead of its schema.

### An older app in the loop

Two devices, one updated and one not, both syncing. This is the ordinary
case, not the edge case: a phone that has not been opened for a week pulls
whatever the laptop wrote on the new version. The first draft of this
section met that with three mechanisms — a version stamped by every
writer, a cursor reset on upgrade, a per-kind acknowledgement from the
server. They all answered the same question, what a stale app should do
with data from the future, and the simpler answer is that it should not
be stale. So:

**Update before you sync.** Before every sync the app asks the service
worker for a new build, and if one is waiting it takes it and reloads,
then syncs on the new version. `pwa.ts` already has both halves: the hook
that fires when a build is waiting, and the call that steps it in and
reloads. The check is a fetch of the worker script, which the browser
does with the cache bypassed, so it is cheap and honest. The reload
happens only where a sync happens: on opening, before the sitting is
dealt, and at the auto-sync moments, which already wait while the learner
is busy. A reload mid-sitting costs nothing anyway — the queue is derived
and the log is written per answer, so the app lands where it was — but it
is not asked for.

**One number in the reply.** The Worker and the app are built from the
same commit and deployed together, so the Worker knows the schema the app
should have: an integer, `SCHEMA`, bumped whenever any kind's shape or
meaning changes, returned in every sync reply. The app compares before it
writes anything:

- **Reply above the app.** The update check missed — a deploy in flight,
  a cached worker script. The sync writes nothing, advances no cursor,
  asks the service worker again, and reloads when the build arrives. If it
  does not arrive, the screen says "a newer version is needed" and the
  app keeps working offline on what it has. Nothing is written by a stale
  app, so nothing needs a version stamp to be distrusted later.
- **Reply below the app, or no number at all.** The Worker is behind, the
  same deploy seen from the other side. The push has already gone with the
  request — one request a sync, and the reply is where the number is — so
  what protects the history is that nothing is marked sent and nothing is
  written: the same records go again once the Worker has caught up. A
  Worker that knows the number refuses a push from ahead of it outright,
  with its own number, so the records never land half-stored. The app says
  the server is updating and tries again later.
- **Equal.** Sync.

That is the whole protocol. What it removes from the plan: the rule that a
writer stamps its version and never writes above it, since a stale app no
longer writes; the cursor reset on upgrade, since a stale app never advances
its cursor past what it cannot read; the per-kind acknowledgement, since the
app never pushes to a Worker that is behind; and the deferred retirement of
a removed rule, since the older device is reloaded before it can pull the
tombstone. The change table above stands with retirement at upgrade again.

**What stays.** The version on each record stays as the reader's hint,
for the upgrade mapper and for `trust*` functions reading rows written
under an earlier shape of the same kind — that is not about two devices,
it is about one device's own history. And the trust functions for the new
kinds still validate and spread rather than rebuild, because a record
survives a relay whole today and should survive an edit whole too.

**What it costs.** A device that cannot reach the update — offline, or a
build that will not install — cannot sync either, where before it could
have synced the kinds it knew. That is the trade: coherence over
availability, on the one path where the two conflict. The app already
prefers it, in waiting for every tab of the old build to close before a
new one takes over.

### On a version on every record, migrated independently

Yes to the version, with two changes, and one objection.

**The version is per kind, not per app.** An app version changes with every
deploy and nearly none of them change a record's meaning. What a reader
needs to know is which shape and which semantics *this kind* had when the
row was written: a small integer per kind, bumped only when that kind
changes, with the change written beside the bump in `model.ts`. Every kind
is versioned independently, which is the part of the proposal that is
right: an attempt at `v: 3` and a rule card at `v: 1` say nothing about
each other.

**The version is a hint, and the shape is the truth.** The app's one
migration so far detects a legacy card by what it has (`direction`) rather
than by a number, and that has held up through a sync from an unmigrated
device, because a device relays records it did not write without touching
them, and a number can be stale where a shape cannot. So readers switch on
the version but tolerate a row whose shape disagrees with it, and a test
feeds each `trust*` function every shape ever written. A stale app never
writes at all, because it updates before it syncs (below), so the version
on a record is the version of the code that wrote it.

**The objection is to "independently" meaning "one record at a time".** A
log row can be upcast alone, and is. A state record often cannot: merging
two rule cards, splitting one, retiring the lower of two rungs are all
decisions about a set. So state migrates by kind, in one transaction, at
upgrade; and logs migrate by row, on read. Those are the two grains, and
picking the wrong one for a kind is how a migration comes to leave half a
set in the new shape.

What actually protects the learner is not the version field. It is that
identities are never reused, that the attempt is self-contained, and that
everything that can be derived is derived. The version only tells the
reader which of those to trust first.

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
catalogue already carries. The things neither source lists and this
inventory adds are the pronunciation rules of verb endings and plurals
(needed by every tense bit and by the plural agreement Bartning & Schlyter
put last), the number-pronunciation sandhi, and the Swiss numerals; each is
marked "—" with its reason.

Three tests should keep this true. Every bit id in the tables above exists
in the code as a rule, every *needs* names a rule that exists, and the
graph has no cycle — a table test like `keys.test.ts`. Every generator's
labels name rules that exist, checked by running each generator over the
fixture catalogue. And the number analyser is checked against a table of
numbers and their spellings, French and Swiss, including every number that
is an exception to something (*81, 91, 100, 101, 200, 201, 1000, 1001,
1 000 000*), because the analyser is the answer key.
