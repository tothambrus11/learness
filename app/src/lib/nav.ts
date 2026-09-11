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

/** One place in the tab bar. */
export interface Tab {
  /** What the tab is called in code, and what `chromeFor()` lights. */
  id: string;
  /** Where it goes, as a route with its trailing slash. Every href here has a
   *  page in PAGES that lights this same tab. */
  href: string;
  /** What it says under the icon. */
  label: string;
}

/** The places within a thumb's reach, in the order the bar shows them. Four at
 *  most: a fifth stops being a place you know where to find. */
export const TABS = [
  { id: 'home', href: '/', label: 'Home' },
  { id: 'words', href: '/words/', label: 'Words' },
  { id: 'progress', href: '/progress/', label: 'Today' },
  { id: 'settings', href: '/settings/', label: 'Settings' },
] as const satisfies readonly Tab[];

/** Which tab a page lights, taken from the list itself so that a tab cannot be
 *  named here and missing from the bar. */
export type TabId = (typeof TABS)[number]['id'];

/** title: what the bar says. tab: which tab is lit. back: where the arrow goes.
 *  immersive: a flow rather than a place — no tabs, so the sitting has the
 *  screen. bare: no chrome at all, for a page that is not part of the app.
 *
 *  A place you reach from the tabs keeps the app's own name: the lit tab
 *  already says which one you are on, and a title that changes under a logo
 *  that does not makes the bar read as four different apps. A screen you were
 *  pushed into does say what it is, because nothing else does. */
interface Page {
  /** What the bar says on this page. */
  title: string;
  /** Which tab this page lights; absent where it lights none. */
  tab?: TabId;
  /** Where the back arrow goes; absent where the page shows none. */
  back?: string;
  /** A flow rather than a place: the tabs are hidden. */
  immersive?: boolean;
  /** Not part of the app at all: no bar and no tabs. */
  bare?: boolean;
}

/** The app's own name, which is what the bar says on every page reached from
 *  a tab. */
const NAME = 'Learness';

/** The chrome each route asks for. A route that is not here gets the name and
 *  the tabs, which is the safe default for a page nobody has thought about. */
const PAGES: Record<string, Page> = {
  '/': { title: NAME, tab: 'home' },
  '/study/': { title: 'Study', back: '/', immersive: true },
  '/words/': { title: NAME, tab: 'words' },
  '/cards/': { title: 'Your cards', tab: 'home', back: '/' },
  '/progress/': { title: NAME, tab: 'progress' },
  '/settings/': { title: NAME, tab: 'settings' },
  '/connect/': { title: 'Connect an app', bare: true },
};

/** The path as PAGES spells it: no base, one leading and one trailing slash. */
export function routeOf(pathname: string | null | undefined, base: string = ''): string {
  let path = pathname ?? '';
  if (base && path.startsWith(base)) path = path.slice(base.length);
  if (!path.startsWith('/')) path = `/${path}`;
  if (!path.endsWith('/')) path += '/';
  return path === '//' ? '/' : path;
}

/** What the layout draws around a page. Every field is settled, so the layout
 *  never has to decide anything itself: `tab` and `back` are `''` rather than
 *  absent where there is none. */
export interface Chrome {
  /** The route the path resolved to, as PAGES spells it. */
  route: string;
  /** What the bar says. */
  title: string;
  /** Which tab is lit; `''` where none is. */
  tab: TabId | '';
  /** Where the back arrow goes; `''` where there is no arrow. */
  back: string;
  /** Whether the tab bar is shown at all. */
  tabs: boolean;
  /** No chrome whatsoever: the page is on its own. */
  bare: boolean;
}

/** The chrome for a path, which is all the layout needs to draw itself. An
 *  unknown path still gets a bar and the tabs rather than nothing. */
export function chromeFor(pathname: string | null | undefined, base: string = ''): Chrome {
  const route = routeOf(pathname, base);
  const page = PAGES[route] ?? { title: NAME };
  return {
    route,
    title: page.title,
    tab: page.tab ?? '',
    back: page.back ?? '',
    tabs: !page.immersive && !page.bare,
    bare: !!page.bare,
  };
}
