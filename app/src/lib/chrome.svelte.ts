/** What the title bar says right now.
 *
 *  The bar is drawn by the layout, which knows the path and nothing else, so a
 *  page with something to add — how many cards are left in this sitting — puts
 *  it here. Everything is optional, and the layout falls back to what nav.js
 *  says about the route. Reset on every navigation, so a page can never leave
 *  its subtitle behind on the next one.
 */
/** What a page has to add to the bar. Absent fields fall back to the route. */
export interface Chrome {
  title: string;
  subtitle: string;
  /** 0..1 through a sitting, or null for no bar. */
  progress: number | null;
}

const EMPTY: Chrome = { title: '', subtitle: '', progress: null };

export const chrome: Chrome = $state({ ...EMPTY });

export function setChrome(patch: Partial<Chrome> = {}): void {
  Object.assign(chrome, patch);
}

export function resetChrome(): void {
  Object.assign(chrome, EMPTY);
}
