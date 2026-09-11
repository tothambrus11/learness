/** The chrome a page gets, decided from its path alone. */
import { expect, test } from 'vitest';

import { chromeFor, routeOf, TABS } from '../src/lib/nav';

test('a path becomes a route, whatever the base and the trailing slash', () => {
  expect(routeOf('/')).toBe('/');
  expect(routeOf('/words')).toBe('/words/');
  expect(routeOf('/words/')).toBe('/words/');
  expect(routeOf('/app/words/', '/app')).toBe('/words/');
  expect(routeOf('/app', '/app')).toBe('/');
  expect(routeOf('/app/', '/app')).toBe('/');
});

test('every tab has a page of its own, and that page lights it', () => {
  for (const tab of TABS) {
    const chrome = chromeFor(tab.href);
    expect(chrome.tab, `${tab.href} should light ${tab.id}`).toBe(tab.id);
    expect(chrome.tabs).toBe(true);
    expect(chrome.back, 'a tab is a place, not somewhere you came from').toBe('');
    expect(chrome.title, `${tab.href} needs a title`).toBeTruthy();
  }
});

test('a sitting takes the screen: no tabs, and a way back', () => {
  const study = chromeFor('/study/');
  expect(study.tabs).toBe(false);
  expect(study.back).toBe('/');
});

test('a page reached from another has both a back arrow and the tabs', () => {
  const cards = chromeFor('/cards/');
  expect(cards.back).toBe('/');
  expect(cards.tabs).toBe(true);
});

test('the page that lets another app in has no chrome at all', () => {
  const connect = chromeFor('/connect/');
  expect(connect.bare).toBe(true);
  expect(connect.tabs).toBe(false);
});

test('an unknown path still gets a bar rather than an empty one', () => {
  const unknown = chromeFor('/nowhere/');
  expect(unknown.title).toBeTruthy();
  expect(unknown.tabs).toBe(true);
});
