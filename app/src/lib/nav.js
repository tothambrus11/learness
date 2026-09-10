/** The shape of the app around the page: a title bar and a row of tabs.
 *
 *  On a phone this is what makes an app an app rather than a website — a bar
 *  that says where you are, a back arrow where you came from somewhere, and
 *  the places you go often always within a thumb's reach at the bottom. The
 *  same rows sit in the top bar on a wide screen, where a bar pinned to the
 *  bottom of a monitor would be absurd.
 *
 *  Which chrome a page gets is decided here, from its path alone, so a page
 *  never has to draw its own header — and, more to the point, so that they
 *  cannot drift apart. A page that wants to say more (the card counter in a
 *  sitting) writes to chrome.svelte.js instead.
 */
export const TABS = [
  { id: 'home', href: '/', label: 'Home' },
  { id: 'words', href: '/words/', label: 'Words' },
  { id: 'progress', href: '/progress/', label: 'Today' },
  { id: 'settings', href: '/settings/', label: 'Settings' },
];

/** title: what the bar says. tab: which tab is lit. back: where the arrow goes.
 *  immersive: a flow rather than a place — no tabs, so the sitting has the
 *  screen. bare: no chrome at all, for a page that is not part of the app. */
const PAGES = {
  '/': { title: 'French Cognates', tab: 'home' },
  '/study/': { title: 'Study', back: '/', immersive: true },
  '/words/': { title: 'Your words', tab: 'words' },
  '/cards/': { title: 'Your cards', tab: 'home', back: '/' },
  '/progress/': { title: 'Today', tab: 'progress' },
  '/settings/': { title: 'Settings', tab: 'settings' },
  '/connect/': { title: 'Connect an app', bare: true },
};

/** The path as PAGES spells it: no base, one leading and one trailing slash. */
export function routeOf(pathname, base = '') {
  let path = String(pathname ?? '');
  if (base && path.startsWith(base)) path = path.slice(base.length);
  if (!path.startsWith('/')) path = `/${path}`;
  if (!path.endsWith('/')) path += '/';
  return path === '//' ? '/' : path;
}

export function chromeFor(pathname, base = '') {
  const route = routeOf(pathname, base);
  const page = PAGES[route] ?? { title: 'French Cognates' };
  return {
    route,
    title: page.title,
    tab: page.tab ?? '',
    back: page.back ?? '',
    tabs: !page.immersive && !page.bare,
    bare: !!page.bare,
  };
}
