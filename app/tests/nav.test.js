import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABS, chromeFor, routeOf } from '../src/lib/nav.js';

test('a path becomes a route, whatever the base and the trailing slash', () => {
  assert.equal(routeOf('/'), '/');
  assert.equal(routeOf('/words'), '/words/');
  assert.equal(routeOf('/words/'), '/words/');
  assert.equal(routeOf('/app/words/', '/app'), '/words/');
  assert.equal(routeOf('/app', '/app'), '/');
  assert.equal(routeOf('/app/', '/app'), '/');
});

test('every tab has a page of its own, and that page lights it', () => {
  for (const tab of TABS) {
    const chrome = chromeFor(tab.href);
    assert.equal(chrome.tab, tab.id, `${tab.href} should light ${tab.id}`);
    assert.equal(chrome.tabs, true);
    assert.equal(chrome.back, '', 'a tab is a place, not somewhere you came from');
    assert.ok(chrome.title, `${tab.href} needs a title`);
  }
});

test('a sitting takes the screen: no tabs, and a way back', () => {
  const study = chromeFor('/study/');
  assert.equal(study.tabs, false);
  assert.equal(study.back, '/');
});

test('a page reached from another has both a back arrow and the tabs', () => {
  const cards = chromeFor('/cards/');
  assert.equal(cards.back, '/');
  assert.equal(cards.tabs, true);
});

test('the page that lets another app in has no chrome at all', () => {
  const connect = chromeFor('/connect/');
  assert.equal(connect.bare, true);
  assert.equal(connect.tabs, false);
});

test('an unknown path still gets a bar rather than an empty one', () => {
  const unknown = chromeFor('/nowhere/');
  assert.ok(unknown.title);
  assert.equal(unknown.tabs, true);
});
