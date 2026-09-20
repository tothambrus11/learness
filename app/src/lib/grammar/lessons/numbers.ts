/** The lessons behind the number drills (see verbs.ts for the shape).
 *
 *  Every example is written by the number grammar itself (numbers.ts), so
 *  a lesson cannot show a form the answer key would refuse.
 */
import { words } from '../numbers.js';
import type { RuleId } from '../rules.js';
import type { Lesson } from './verbs.js';

/** Numbers written out with their digits, for an example line. */
const show = (ns: readonly number[]): string => ns.map((n) => `${n} ${words(n)}`).join(' · ');

export const NUMBER_LESSONS: Readonly<Partial<Record<RuleId, Lesson>>> = {
  'N.units': {
    name: 'Zero to sixteen',
    use: 'The numbers that are words of their own. Everything above is built from these, so they are learned as items, like words.',
    formation: 'Seventeen words to know, one each: zéro to seize. Only un changes: une before a feminine noun (une heure). Onze to seize are one word, not ten-and-something.',
    example: show([0, 1, 5, 8, 11, 13, 16]),
    unit: 'number',
  },
  'N.teens': {
    name: 'Seventeen to nineteen',
    use: 'The three numbers between seize and vingt are built, not learned: ten and a unit.',
    formation: 'dix, a hyphen, the unit: dix-sept, dix-huit, dix-neuf.',
    example: show([17, 18, 19]),
    unit: 'number',
  },
  'N.tens': {
    name: 'The tens',
    use: 'Twenty to ninety as words of their own, in the Swiss way: septante, huitante and nonante for seventy, eighty and ninety.',
    formation: 'vingt, trente, quarante, cinquante, soixante, septante, huitante, nonante. France says soixante-dix, quatre-vingts and quatre-vingt-dix instead: a bit of its own, for reading.',
    example: show([20, 30, 40, 50, 60, 70, 80, 90]),
    unit: 'number',
  },
  'N.tens-units': {
    name: 'A ten and a unit',
    use: 'Every number from twenty-two to ninety-nine that does not end in one.',
    formation: 'The ten, a hyphen, the unit: vingt-deux, quarante-cinq, nonante-neuf.',
    example: show([22, 45, 67, 84, 99]),
    unit: 'number',
  },
  'N.et-un': {
    name: 'Twenty-one and the other ones',
    use: 'A ten plus one is the exception in the row: et between the two, no hyphen in the traditional spelling.',
    formation: 'The ten, et, un: vingt et un, trente et un … nonante et un. Since the 1990 reform vingt-et-un with hyphens is right too; both are accepted. Before a feminine noun it is et une: vingt et une heures.',
    example: show([21, 31, 51, 71, 91]),
    unit: 'number',
  },
  'N.french-tens': {
    name: 'The French seventies, eighties and nineties',
    use: 'What France, Belgium\'s neighbours and every timetable say for seventy to ninety-nine. The Swiss forms are what you write; these you have to read and hear.',
    formation: 'Seventy is sixty plus a teen: soixante-dix, soixante et onze, soixante-douze … soixante-dix-neuf. Eighty is four twenties: quatre-vingts, with an s only when nothing follows; then quatre-vingt-un (no et), quatre-vingt-dix, quatre-vingt-dix-neuf.',
    example: [70, 71, 75, 80, 81, 90, 99].map((n) => `${n} ${words(n, 'fr')}`).join(' · '),
    unit: 'number',
  },
  'N.cent': {
    name: 'Hundreds',
    use: 'Prices, years and distances live here.',
    formation: 'cent alone is a hundred, never un cent. Multiplied it takes an s, but only when it ends the number: deux cents, deux cent un. What follows is simply added, with a space.',
    example: show([100, 101, 200, 201, 281, 999]),
    unit: 'number',
  },
  'N.mille': {
    name: 'Thousands',
    use: 'Years are read as thousands: deux mille vingt-six.',
    formation: 'mille never changes and never takes un: mille, deux mille, mille un, dix mille. What follows is added with a space.',
    example: show([1000, 1001, 2000, 2026, 10_000]),
    unit: 'number',
  },
  'N.million': {
    name: 'Millions',
    use: 'million and milliard are nouns, and behave like them.',
    formation: 'un million, deux millions — with un and with an s. Before what they count they take de: un million de personnes. What follows is added with a space: deux millions trois cent mille.',
    example: show([1_000_000, 2_000_000, 1_500_000, 2_300_000]),
    unit: 'number',
  },
};
