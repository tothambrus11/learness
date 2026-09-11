/** What the title bar says right now.
 *
 *  The bar is drawn by the layout, which knows the path and nothing else, so a
 *  page with something to add — how many cards are left in this sitting — puts
 *  it here. Everything is optional, and the layout falls back to what nav.js
 *  says about the route. Reset on every navigation, so a page can never leave
 *  its subtitle behind on the next one.
 */
const EMPTY = { title: '', subtitle: '', progress: null };

export const chrome = $state({ ...EMPTY });

export function setChrome(patch = {}) {
  Object.assign(chrome, patch);
}

export function resetChrome() {
  Object.assign(chrome, EMPTY);
}
