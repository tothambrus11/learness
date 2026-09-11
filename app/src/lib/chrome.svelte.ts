/** What the title bar says right now. Everything is optional, and the layout
 *  falls back to what nav.ts says about the route. */

/* The bar is drawn by the layout, which knows the path and nothing else, so a
   page with something to add — how many cards are left in this sitting — puts
   it here. It is reset on every navigation, so a page can never leave its
   subtitle behind on the next one. */

/** What a page may say about itself in the bar. */
export interface Chrome {
  /** The heading. Empty falls back to the route's own name. */
  title: string;
  /** The line under it, for something only the page knows. Empty hides it. */
  subtitle: string;
  /** How far through a flow the page is, 0..1, or null for no bar at all. */
  progress: number | null;
}

/** Nothing said: what the bar shows between pages. */
const EMPTY: Chrome = { title: '', subtitle: '', progress: null };

/** The live values. Read it in a component and it re-renders on a change. */
export const chrome = $state<Chrome>({ ...EMPTY });

/** Say one or more of the three things. Fields left out keep their value, so
 *  a page can update just its subtitle without restating its title. */
export function setChrome(patch: Partial<Chrome> = {}): void {
  Object.assign(chrome, patch);
}

/** Put the bar back to saying nothing. The layout calls this on every
 *  navigation, so nothing a page said can outlive it. */
export function resetChrome(): void {
  Object.assign(chrome, EMPTY);
}
