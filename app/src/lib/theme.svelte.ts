/** The theme in force, kept where every screen can read it, and painted on
 *  the root.
 *
 *  The screens read their colours off CSS custom properties on the root,
 *  so painting a theme is setting those seventeen properties, and every
 *  component picks them up without knowing a theme exists. The properties
 *  the layout declares in CSS are the defaults for the first paint, before
 *  the store has been read; this replaces them once it has.
 *
 *  Which theme is in force is a rule (pickTheme, in theme.ts) over the
 *  settings, the themes on offer and what the system says about the dark;
 *  this file only reads those three, watches the third, and re-reads the
 *  first two when a setting is written or a sync brings a theme in.
 */
import { getSettings } from './db.js';
import { onSync } from './sync.js';
import { display } from './display.svelte.js';
import { cssOf, pickTheme } from './theme.js';
import type { Theme } from './theme.js';
import { offeredThemes } from './themes.js';

const DARK = '(prefers-color-scheme: dark)';

/** The theme in force. Read it in a component and it re-renders on a change. */
export const theme: { current: Theme | null } = $state({ current: null });

/** Whether the system asks for the dark, as last heard. */
let systemDark = $state(false);

/** Read the settings and the store and settle on a theme. Safe to call from
 *  anywhere; a database that will not open leaves the layout's own colours
 *  in place. Resolves to what was chosen. */
export async function loadTheme(): Promise<Theme | null> {
  try {
    const [settings, offered] = await Promise.all([getSettings(), offeredThemes()]);
    theme.current = pickTheme(settings, offered, systemDark);
  } catch { /* the CSS defaults are already on the page */ }
  return theme.current;
}

/** Paint the theme on the document: its colours on the root, the learner's
 *  own gender colours over them, and the mode where the browser reads it.
 *  The meta tag is what a phone paints its status bar with. */
export function paintTheme(current: Theme | null, doc: Document = document): void {
  if (!current) return;
  const root = doc.documentElement;
  const vars = cssOf(current);
  const own: Record<string, string> = {
    '--masc': display.colourMasc, '--fem': display.colourFem,
    '--plur': display.colourPlur, '--both': display.colourBoth,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, own[name] || value);
  root.style.setProperty('color-scheme', current.mode);
  root.dataset.theme = current.mode;
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = vars['--bg'] ?? '';
  }
}

/** Follow the system's light and dark, and every change to the settings and
 *  the store that could move the theme: what a sync brings in, what the
 *  settings page writes. Returns the function that stops watching. The
 *  first read is started here too. */
export function watchTheme(win: Window = window): () => void {
  const query = win.matchMedia(DARK);
  systemDark = query.matches;
  const onChange = (e: MediaQueryListEvent): void => { systemDark = e.matches; void loadTheme(); };
  query.addEventListener('change', onChange);
  const stopSync = onSync((result) => { if (result.received.themes) void loadTheme(); });
  void loadTheme();
  return () => { query.removeEventListener('change', onChange); stopSync(); };
}
