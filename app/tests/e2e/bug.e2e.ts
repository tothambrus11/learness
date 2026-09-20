/** The bug on the report button, walking.

 *  Everything below this line can say that the six legs are six paths and
 *  that the right three are told to swing half a stride after the left. Only
 *  a browser can say that any of it moves: that the hover reaches the icon
 *  from the button around it, that the joints the stylesheet names are the
 *  points the legs actually turn about, and that the two tripods are on
 *  opposite sides of the stride at every instant rather than marching in
 *  step. That is the whole of the feature, and none of it throws when it is
 *  wrong.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { findChromium } from './browser.js';
import { serveBuild } from './serve.js';
import type { Serving } from './serve.js';

const executablePath = findChromium();
const run = executablePath ? test : test.skip;

let site: Serving;
let browser: Browser;

beforeAll(async () => {
  if (!executablePath) return;
  site = await serveBuild();
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
});
afterAll(async () => { await browser?.close(); await site?.close(); });

/** How far forward each leg is reaching, in degrees, right now.
 *
 *  Positive is towards the head for every leg. A turn that carries a left
 *  leg forward carries a right leg back — the sides are mirrored — so the
 *  right legs' angles are negated to make the six numbers comparable, which
 *  is the whole point: a tripod is three legs reaching the same way.
 */
const reach = (page: Page): Promise<Record<string, number>> => page.evaluate(() => {
  const out: Record<string, number> = {};
  for (const leg of document.querySelectorAll('.report .leg')) {
    const name = [...leg.classList].filter((c) => !c.startsWith('svelte-') && c !== 'leg').join(' ');
    const deg = Number(/(-?[\d.]+)deg/.exec(getComputedStyle(leg).rotate)?.[1] ?? 0);
    out[name.replace(' off', '')] = name.includes('right') ? -deg : deg;
  }
  return out;
});

/** A few instants of the walk, far enough apart to land in different parts
 *  of a stride of well under a second. */
async function stride(page: Page, samples = 10): Promise<Record<string, number>[]> {
  const taken: Record<string, number>[] = [];
  for (let i = 0; i < samples; i++) {
    taken.push(await reach(page));
    await page.waitForTimeout(37);
  }
  return taken;
}

run('the bug holds still until the button it sits in is hovered, then walks', async () => {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${site.url}/`);
  await page.locator('.report .leg').first().waitFor();

  const still = await stride(page, 4);
  expect(Object.keys(still[0]!).sort()).toEqual([
    'fore left', 'fore right', 'hind left', 'hind right', 'mid left', 'mid right',
  ]);
  for (const sample of still) {
    for (const [leg, deg] of Object.entries(sample)) {
      expect(`${leg} at rest: ${deg}`).toBe(`${leg} at rest: 0`);
    }
  }

  /* The far edge of the button, not the middle: the bug is nineteen pixels
     inside thirty-four, and the walk is keyed to the button so that the
     pointer coming to rest beside the bug keeps the legs going. Eleven
     pixels out is past the icon and still inside the round button — which
     is round for the pointer too, so its square corners are nobody's. */
  const button = (await page.locator('.report').boundingBox())!;
  await page.mouse.move(button.x + button.width / 2 + 11, button.y + button.height / 2);

  const walking = await stride(page);
  for (const leg of Object.keys(walking[0]!)) {
    const swept = walking.map((s) => s[leg]!);
    expect(`${leg} swings: ${Math.max(...swept) - Math.min(...swept) > 6}`)
      .toBe(`${leg} swings: true`);
  }

  /* At every instant, the near front, far middle and near hind leg are
     reaching one way and the other three the other: the alternating tripod,
     which is what keeps three feet on the ground in a triangle. Only the
     instants where the legs are clear of the crossing point can say which
     side of it they are on. */
  let told = 0;
  for (const sample of walking) {
    const tripod = ['fore left', 'mid right', 'hind left'].map((leg) => sample[leg]!);
    const other = ['fore right', 'mid left', 'hind right'].map((leg) => sample[leg]!);
    if ([...tripod, ...other].some((deg) => Math.abs(deg) < 3)) continue;
    told++;
    const sign = (deg: number): string => (deg > 0 ? 'forward' : 'back');
    expect(new Set(tripod.map(sign)).size).toBe(1);
    expect(new Set(other.map(sign)).size).toBe(1);
    expect(sign(tripod[0]!)).not.toBe(sign(other[0]!));
  }
  expect(told).toBeGreaterThan(1);

  /* And the legs are still attached: each turns about its joint on the shell,
     so the six feet are the only ends that have moved. */
  const joints = await page.evaluate(() => {
    const at = (leg: Element, end: number): [number, number] => {
      const path = leg as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() * end);
      const m = path.getScreenCTM()!;
      return [p.x * m.a + p.y * m.c + m.e, p.x * m.b + p.y * m.d + m.f];
    };
    return [...document.querySelectorAll('.report .leg')]
      .map((leg) => [at(leg, 0), at(leg, 1)] as const);
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const rested = await page.evaluate(() => {
    const at = (leg: Element, end: number): [number, number] => {
      const path = leg as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() * end);
      const m = path.getScreenCTM()!;
      return [p.x * m.a + p.y * m.c + m.e, p.x * m.b + p.y * m.d + m.f];
    };
    return [...document.querySelectorAll('.report .leg')]
      .map((leg) => [at(leg, 0), at(leg, 1)] as const);
  });
  /* One end of each leg stayed within a pixel of where it was mid-stride:
     the joint. A leg turning about its foot, or about the middle of the
     icon, would have moved both. */
  for (const [i, [a, b]] of joints.entries()) {
    const moved = ([x, y]: readonly [number, number], [u, v]: readonly [number, number]): number =>
      Math.hypot(x - u, y - v);
    const held = Math.min(moved(a, rested[i]![0]), moved(b, rested[i]![1]));
    expect(`leg ${i} held by one end: ${held < 1}`).toBe(`leg ${i} held by one end: true`);
  }
  await context.close();
});
