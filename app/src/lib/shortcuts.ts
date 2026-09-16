/** The sitting's keyboard, as one table.
 *
 *  A shortcut used to be two things written in two places: an `if` in the
 *  study screen's key handler, and a `<kbd>` typed by hand next to whichever
 *  button it stood for. The two drifted. The speaker on a dictation card said
 *  `s` while the cursor sat in the answer box, where an `s` is a letter, so
 *  the hint was a lie (#28); and there was no way to say "press this instead
 *  while you are typing" because nothing knew which keys were taken (#35).
 *
 *  So the table is the only place a key is named. `resolve` reads a keypress
 *  against it and says which shortcut, if any, is meant; `hint` reads the same
 *  row back as the keys to draw beside the button. They cannot disagree,
 *  because there is nothing to disagree with — and `tests/shortcuts.test.ts`
 *  presses every hint and checks it lands on the row it was read from.
 *
 *  The one rule about the answer box: while it is open, every letter belongs
 *  to it, so the sitting's letters are reached with Alt held — `alt` `s` —
 *  and that is what the hint shows for as long as the box is on the card.
 *  Alt is accepted everywhere, so a hand that has learned `alt` `s` in the box
 *  can keep using it after the flip. Enter is the box's own submit and needs
 *  no Alt; Shift+Enter stays as the older way of hearing the prompt again.
 *
 *  Everything here is pure, and knows nothing about the DOM but the shape of a
 *  keypress.
 */
import { CHOSEN, HEARD_FIRST, TYPED } from './keys.js';
import type { Rung } from './keys.js';
import type { Grade } from './scheduler.js';

/** What a shortcut does. The screen maps each to a function; the table only
 *  says when it may fire and which key reaches it. */
export type ShortcutId =
  | 'older'         /* look back one card */
  | 'newer'         /* forward through the history */
  | 'continue'      /* back to the live card from looking back */
  | 'show'          /* flip a card that is not typed */
  | 'check'         /* submit the answer box */
  | 'replay'        /* the card's own question, again — never the answer */
  | 'playModel'     /* the French: the sentence on a "use it" card */
  | 'playNative'    /* a human reading the word */
  | 'cue'           /* the English */
  | 'again' | 'hard' | 'good' | 'easy'
  | 'pick1' | 'pick2' | 'pick3' | 'pick4'   /* an option on a tap card, before the flip */
  | 'flagSaid'      /* "I said it wrong" */
  | 'toggleDefs'    /* the definitions drawer */
  | 'edit';         /* correct the word on the live card, in a popup */

export const GRADE_OF: Partial<Record<ShortcutId, Grade>> = {
  again: 1, hard: 2, good: 3, easy: 4,
};

/** Which option of a tap card a shortcut means, counting from zero. */
export const OPTION_OF: Partial<Record<ShortcutId, number>> = {
  pick1: 0, pick2: 1, pick3: 2, pick4: 3,
};

/** What the sitting looks like at the moment of a keypress: enough to say
 *  which shortcuts make sense. Built by the screen from its own state, so a
 *  test can build one from nothing. */
export interface KeyContext {
  /** No card to act on: still loading, or the sitting is over. */
  idle: boolean;
  /** Looking back at an answered card rather than at the live one. */
  browsing: boolean;
  /** The back of the card on screen is showing. */
  revealed: boolean;
  rung: Rung | null;
  /** There is an older card to look back at. */
  canOlder: boolean;
  /** Which sounds the card on screen has. */
  has: { fr: boolean; native: boolean };
  /** The device can say this card's sentence itself. */
  spoken: boolean;
  /** The English can be heard, by recording or by the device. */
  canCue: boolean;
  /** How many options the card offers to tap, or zero on any other card. */
  options?: number;
  /** The word on the card is being corrected in a popup. Every key is the
   *  popup's then, and nothing on the card behind it may fire: a space on
   *  its Cancel button would otherwise turn the card over. */
  editing?: boolean;
}

/** A keypress, as the table reads it: the key, the physical key beneath it,
 *  the modifiers, and whether it landed in a text field. */
export interface KeyPress {
  key: string;
  /** `KeyboardEvent.code`: "KeyS" for the S key whatever it typed. */
  code: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  inField: boolean;
}

interface Row {
  id: ShortcutId;
  key: string;
  shift?: boolean;
  /** Fires from inside the answer box without Alt held — the box's own keys. */
  bare?: boolean;
  when: (ctx: KeyContext) => boolean;
}

/** The answer box is on the card: a typed rung, live, before the flip. */
export const fieldOpen = (ctx: KeyContext): boolean =>
  !ctx.idle && !ctx.browsing && !ctx.revealed && !!ctx.rung && TYPED.has(ctx.rung);

const live = (ctx: KeyContext): boolean => !ctx.idle && !ctx.browsing;
/** A tap card, face down, with at least this many options: the digits are
 *  the options until the flip, and the grades after it. */
const choosing = (ctx: KeyContext): boolean => !!ctx.rung && CHOSEN.has(ctx.rung);
const optionOpen = (n: number) => (ctx: KeyContext): boolean =>
  live(ctx) && !ctx.revealed && choosing(ctx) && (ctx.options ?? 0) >= n;
const heardFirst = (ctx: KeyContext): boolean => !!ctx.rung && HEARD_FIRST.has(ctx.rung);
/** The French may be played: after the flip, or on a card whose question it
 *  is. Before the flip on a "write it" card it is the answer. */
const frenchAllowed = (ctx: KeyContext): boolean => ctx.revealed || heardFirst(ctx);
/** The English may be played: after the flip, or on a card whose question it
 *  is. On a "listen, recall the English" card, before the flip, it is the
 *  answer. */
const englishAllowed = (ctx: KeyContext): boolean => ctx.revealed || !heardFirst(ctx);

/* Order matters only where two rows share a key: the first whose `when` holds
   wins, which is how Enter is "check" in the box, "show" on a card without
   one, and "continue" while looking back. */
const TABLE: readonly Row[] = [
  { id: 'older', key: 'ArrowLeft', when: (c) => !c.idle && c.canOlder },
  { id: 'newer', key: 'ArrowRight', when: (c) => !c.idle && c.browsing },
  { id: 'continue', key: ' ', when: (c) => !c.idle && c.browsing },
  { id: 'continue', key: 'Enter', when: (c) => !c.idle && c.browsing },
  { id: 'check', key: 'Enter', bare: true, when: fieldOpen },
  { id: 'replay', key: 'Enter', shift: true, bare: true, when: fieldOpen },
  /* A tap card is turned by finding the right option, never by looking. */
  { id: 'show', key: ' ', when: (c) => live(c) && !c.revealed && !fieldOpen(c) && !choosing(c) },
  { id: 'show', key: 'Enter', when: (c) => live(c) && !c.revealed && !fieldOpen(c) && !choosing(c) },
  { id: 'playModel', key: 's', when: (c) => !c.idle && (c.has.fr || c.spoken) && frenchAllowed(c) },
  { id: 'playNative', key: 'n', when: (c) => !c.idle && c.has.native && frenchAllowed(c) },
  { id: 'cue', key: 'e', when: (c) => !c.idle && c.canCue && englishAllowed(c) },
  { id: 'pick1', key: '1', when: optionOpen(1) },
  { id: 'pick2', key: '2', when: optionOpen(2) },
  { id: 'pick3', key: '3', when: optionOpen(3) },
  { id: 'pick4', key: '4', when: optionOpen(4) },
  { id: 'again', key: '1', when: (c) => live(c) && c.revealed },
  { id: 'hard', key: '2', when: (c) => live(c) && c.revealed },
  { id: 'good', key: '3', when: (c) => live(c) && c.revealed },
  { id: 'easy', key: '4', when: (c) => live(c) && c.revealed },
  { id: 'flagSaid', key: 'p', when: (c) => live(c) && c.revealed && c.has.fr },
  /* A view, not an answer: the drawer opens on a card looked back at too,
     and so its hint is the same on both — the browser suite compares them. */
  { id: 'toggleDefs', key: 'd', when: (c) => !c.idle && c.revealed },
  /* The word itself, either side up — but only the live card's: a card
     looked back at is a record of an answer, and the word is corrected where
     it is being asked. `c` is the letter the app uses for it ("correct"),
     and, like every letter, needs Alt while the answer box is open. */
  { id: 'edit', key: 'c', when: live },
];

/** The physical key a row's letter sits on, for a press with Alt held: on a
 *  Mac, Alt+S types "ß" and the `key` says so, but the `code` still says
 *  KeyS. Letters and digits only; the named keys are the same either way. */
const codeOf = (key: string): string =>
  /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key;

/** Which shortcut a keypress means in this context, or null for none.
 *
 *  Ctrl and Meta are the browser's and never ours. In a text field a bare
 *  key is a letter being typed and reaches only the rows marked `bare`; with
 *  Alt held it reaches everything, matched on the physical key. */
export function resolve(press: KeyPress, ctx: KeyContext): ShortcutId | null {
  if (press.ctrl || press.meta || ctx.editing) return null;
  for (const row of TABLE) {
    if (!row.when(ctx)) continue;
    if (!!row.shift !== press.shift) continue;
    const hit = press.alt ? press.code === codeOf(row.key) : press.key === row.key;
    if (!hit) continue;
    if (press.inField && !press.alt && !row.bare) continue;
    return row.id;
  }
  return null;
}

/** Whether a shortcut can fire at all right now — what a button reads to
 *  decide if it is worth drawing a hint beside itself. */
export const available = (id: ShortcutId, ctx: KeyContext): boolean =>
  !ctx.editing && TABLE.some((row) => row.id === id && row.when(ctx));

const LABEL: Record<string, string> = {
  ' ': 'space', Enter: 'enter', ArrowLeft: '←', ArrowRight: '→',
};

/** The keys to draw beside a button for this shortcut, in this context: the
 *  first row that can fire, with `alt` in front of it while the answer box is
 *  open and the row is not one of the box's own. Empty where nothing fires. */
export function hint(id: ShortcutId, ctx: KeyContext): string[] {
  const row = ctx.editing ? undefined : TABLE.find((r) => r.id === id && r.when(ctx));
  if (!row) return [];
  const keys = [LABEL[row.key] ?? row.key];
  if (row.shift) keys.unshift('shift');
  else if (fieldOpen(ctx) && !row.bare) keys.unshift('alt');
  return keys;
}

/** A DOM event as the table reads it. The one place the DOM is looked at. */
export function pressOf(event: KeyboardEvent): KeyPress {
  const t = event.target as HTMLElement | null;
  const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
    || t.tagName === 'SELECT' || t.isContentEditable);
  return {
    key: event.key, code: event.code, alt: event.altKey, ctrl: event.ctrlKey,
    meta: event.metaKey, shift: event.shiftKey, inField,
  };
}
