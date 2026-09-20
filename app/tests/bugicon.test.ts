/** The bug on the report button, and the gait it walks on hover.
 *
 *  A leg swinging about the wrong point, or a leg reaching forward while the
 *  two it shares a tripod with push back, is not something a type can catch
 *  and not something that throws: it just stops looking like an insect. So
 *  the drawing is read here — where each leg meets the shell, and which three
 *  move together — and the rules the gait is built on are asserted over it.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import BugIcon from '../src/lib/components/BugIcon.svelte';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/lib/components/BugIcon.svelte', import.meta.url)), 'utf8');
const CSS = SOURCE.slice(SOURCE.indexOf('<style>'), SOURCE.lastIndexOf('</style>'));

/** Every `<path>` of the drawn icon, as its classes and its `d`. */
function paths(): { classes: string[]; d: string }[] {
  const html = render(BugIcon).body;
  return [...html.matchAll(/<path\b[^>]*>/g)].map((m) => ({
    /* Svelte's own scoping class is not part of the drawing. */
    classes: (/class="([^"]*)"/.exec(m[0])?.[1] ?? '')
      .split(' ').filter((c) => c && !c.startsWith('svelte-')),
    d: /\bd="([^"]*)"/.exec(m[0])?.[1] ?? '',
  }));
}

const legs = () => paths().filter((p) => p.classes.includes('leg'));

/** Which leg it is: `fore left`, and not how it is animated. */
const which = (leg: { classes: string[] }): string =>
  leg.classes.filter((c) => c !== 'leg' && c !== 'off').join(' ');

/** The numbers of a path command, in order: `a4 4 0 0 1-3.55 3.97` is seven. */
const numbers = (s: string): number[] => (s.match(/-?\d*\.?\d+/g) ?? []).map(Number);

/** A leg's two ends, drawn first to last. One of them is the joint on the
 *  shell and the other is the foot; which is which is what the test decides. */
function ends(d: string): [number, number][] {
  const start = /^M\s*(-?[\d.]+)[ ,](-?[\d.]+)/.exec(d.trim());
  assert.ok(start, `${d} begins somewhere`);
  const from: [number, number] = [Number(start[1]), Number(start[2])];
  const rest = d.trim().slice(start[0].length).trim();
  if (rest.startsWith('a')) {
    /* The last two numbers of an arc are where it ends, relative to its start. */
    const n = numbers(rest);
    assert.equal(n.length, 7, `${rest} is one arc`);
    return [from, [from[0] + n[5]!, from[1] + n[6]!]];
  }
  if (rest.startsWith('H')) return [from, [numbers(rest)[0]!, from[1]]];
  if (rest.startsWith('h')) return [from, [from[0] + numbers(rest)[0]!, from[1]]];
  throw new Error(`${rest} is not a leg's one stroke`);
}

/** A point, to the hundredth the drawing is written to: adding an arc's own
 *  numbers up is not exact, and the stylesheet is not written in binary. */
const at = ([x, y]: [number, number]): string => `${x.toFixed(2)} ${y.toFixed(2)}`;

/** Where the stylesheet turns each leg, by its pair of classes. */
function joints(): Map<string, [number, number]> {
  const found = new Map<string, [number, number]>();
  for (const m of CSS.matchAll(
    /\.leg\.(fore|mid|hind)\.(left|right)\s*\{[^}]*transform-origin:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/g)) {
    found.set(`${m[1]} ${m[2]}`, [Number(m[3]), Number(m[4])]);
  }
  return found;
}

/** The rotations of a `@keyframes` block, by the percentage they land on. */
function turns(name: string): [string, number][] {
  const from = CSS.indexOf(`@keyframes ${name} {`);
  assert.notEqual(from, -1, `${name} is declared`);
  const block = CSS.slice(from, CSS.indexOf('\n  }', from));
  return [...block.matchAll(/(\d+%)[^}]*?rotate:\s*(-?[\d.]+)deg/g)]
    .map((m) => [m[1]!, Number(m[2])]);
}

test('the bug has six legs, three a side, and each is its own stroke', () => {
  /* Lucide draws the bug as one flat set of strokes; a leg that is not a path
     of its own cannot be swung, and a leg sharing a path with another cannot
     be swung apart from it. */
  assert.deepEqual(legs().map(which).sort(), [
    'fore left', 'fore right', 'hind left', 'hind right', 'mid left', 'mid right',
  ]);
});

test('a leg turns about the end that is attached to the body, not about its foot', () => {
  /* The joint is the only point a leg can swing around and stay attached: turn
     one about its foot and the leg walks away from the shell. */
  const origins = joints();
  assert.equal(origins.size, 6, 'every leg is given a joint');
  for (const leg of legs()) {
    const [a, b] = ends(leg.d);
    /* Of the two ends, the joint is the one on the body: nearer the midline. */
    const joint = Math.abs(a![0] - 12) < Math.abs(b![0] - 12) ? a! : b!;
    assert.equal(at(origins.get(which(leg))!), at(joint), `${which(leg)} swings from its joint`);
  }
});

test('the three legs that swing together are the alternating tripod', () => {
  /* An insect never falls over because the three feet still down are always a
     triangle around it: one side's front and back, and the other side's
     middle. Two legs next to each other lifting together is a stumble. */
  const sets = new Map<boolean, { row: string; side: string }[]>([[false, []], [true, []]]);
  for (const leg of legs()) {
    sets.get(leg.classes.includes('off'))!.push({
      row: leg.classes.find((c) => ['fore', 'mid', 'hind'].includes(c))!,
      side: leg.classes.find((c) => ['left', 'right'].includes(c))!,
    });
  }
  for (const [, tripod] of sets) {
    assert.equal(tripod.length, 3, 'a tripod is three legs');
    assert.deepEqual(tripod.map((l) => l.row).sort(), ['fore', 'hind', 'mid'],
      'one from each row, so no two lift side by side');
    const middle = tripod.find((l) => l.row === 'mid')!;
    for (const other of tripod.filter((l) => l.row !== 'mid')) {
      assert.notEqual(other.side, middle.side, 'the middle leg is the far one');
    }
  }
  /* And the second tripod is the first one half a stride ago. */
  assert.match(CSS, /\.leg\.off\s*\{\s*animation-delay:\s*calc\(var\(--stride\) \/ -2\)/);
});

test('a leg on the right reaches forward when its tripod does', () => {
  /* Turning a left leg towards the head and a right leg by the same amount
     turns the right one towards the tail: the sides are mirrored, so the
     right legs run the mirror of the cycle. Run them the same and the bug
     walks with its two sides fighting each other. */
  assert.match(CSS, /\.leg\.right\s*\{\s*animation-name:\s*step-mirror/);
  const left = turns('step');
  const right = turns('step-mirror');
  assert.ok(left.length >= 4, 'the cycle was read at all');
  assert.deepEqual(right.map(([moment]) => moment), left.map(([moment]) => moment),
    'read at the same moments of the cycle');
  for (const [i, [moment, deg]] of left.entries()) {
    assert.equal(right[i]![1] + deg, 0, `at ${moment} the right legs are the mirror`);
  }
});

test('the bug walks when what it sits in is hovered, not when the bug is', () => {
  /* Nineteen pixels of bug in a thirty-four pixel button: keyed to itself, the
     walk would cut out with the pointer still on the button. */
  assert.match(CSS, /:global\(:hover\) > \.bug/);
  assert.match(CSS, /:global\(:focus-visible\) > \.bug/);
  assert.doesNotMatch(CSS, /\.bug:hover/);
});

test('asked for stillness, nothing moves', () => {
  const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(reduced, 'the preference is answered');
  assert.match(reduced, /--walk:\s*paused/);
});
