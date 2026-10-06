/** Which word on the screen is being looked at, for the one popup that says
 *  what it is (components/WordPopup.svelte, drawn by the layout).
 *
 *  A word is opened two ways. Pointed at with a mouse, it opens after a
 *  moment and closes a moment after the pointer leaves both the word and
 *  the popup — long enough to cross the gap and press a button in it.
 *  Tapped or clicked, it opens at once and stays until something else is
 *  tapped, Escape is pressed, the page scrolls or the screen changes: a
 *  finger has no hover, and a popup that vanished as the finger lifted
 *  would be one nobody could read. One word at a time.
 *
 *  Kept apart from the component so the rules of when it opens and closes
 *  are a module, testable without a browser (tests/wordpopup.test.ts).
 */

/** A word opened: what was written, the form to look up, and where it is
 *  on the screen, for the popup to sit beside. */
export interface OpenWord {
  text: string;
  look: string;
  /** The word's box, in viewport pixels, when it was opened. */
  rect: { left: number; top: number; right: number; bottom: number };
  /** Opened by a tap or a click: stays until dismissed. */
  pinned: boolean;
}

export const wordPopup: { open: OpenWord | null } = $state({ open: null });

/** How long a pointer rests on a word before it opens, and how long the
 *  popup waits for the pointer to come back before it closes. */
export const HOVER_MS = 350;
export const LEAVE_MS = 250;

let opening: ReturnType<typeof setTimeout> | null = null;
let closing: ReturnType<typeof setTimeout> | null = null;
const cancel = (): void => {
  if (opening) clearTimeout(opening);
  if (closing) clearTimeout(closing);
  opening = null;
  closing = null;
};

const boxOf = (el: Element): OpenWord['rect'] => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

/** Open a word now, pinned: a tap or a click. The same word tapped again
 *  closes it. */
export function openWord(text: string, look: string, el: Element): void {
  cancel();
  const now = wordPopup.open;
  if (now?.pinned && now.look === look && now.text === text) { wordPopup.open = null; return; }
  wordPopup.open = { text, look, rect: boxOf(el), pinned: true };
}

/** A mouse came to rest on a word: open it in a moment, unless a word is
 *  pinned open, which only a tap elsewhere moves. */
export function hoverWord(text: string, look: string, el: Element): void {
  if (wordPopup.open?.pinned) return;
  cancel();
  opening = setTimeout(() => {
    opening = null;
    wordPopup.open = { text, look, rect: boxOf(el), pinned: false };
  }, HOVER_MS);
}

/** The pointer left a word or the popup: close in a moment, unless it
 *  comes back (`stayOpen`) or the word is pinned. */
export function leaveWord(): void {
  if (opening) { clearTimeout(opening); opening = null; }
  if (!wordPopup.open || wordPopup.open.pinned) return;
  if (closing) clearTimeout(closing);
  closing = setTimeout(() => { closing = null; if (!wordPopup.open?.pinned) wordPopup.open = null; }, LEAVE_MS);
}

/** The pointer is over the popup: it stays. */
export function stayOpen(): void {
  if (closing) { clearTimeout(closing); closing = null; }
}

/** Close whatever is open: Escape, a tap elsewhere, a scroll, a new screen. */
export function closeWord(): void {
  cancel();
  wordPopup.open = null;
}
