/** How words are painted, kept where every screen can read it.
 *
 *  The gender cues are settings, and a word is drawn in a dozen places, so
 *  threading them through as props would mean touching every screen to change
 *  one dial. They are read once when the app starts and again whenever the
 *  settings page writes one, and the components that draw words read this.
 *
 *  The rules themselves are in gender.js, which knows nothing about Svelte and
 *  is tested on its own.
 */
import { DEFAULT_DISPLAY } from './gender.js';
import { getSettings } from './db.js';
import type { DisplaySettings, Settings } from './model.js';

const KEYS = Object.keys(DEFAULT_DISPLAY) as (keyof DisplaySettings)[];

/** The live values. Read it in a component and it re-renders on a change. */
export const display: DisplaySettings = $state({ ...DEFAULT_DISPLAY });

/** Take the display dials out of a full settings record. */
export function displayFrom(settings: Partial<Settings> = {}): DisplaySettings {
  const out = { ...DEFAULT_DISPLAY };
  for (const k of KEYS) {
    const value = settings[k];
    if (value !== undefined) Object.assign(out, { [k]: value });
  }
  return out;
}

export function applyDisplay(settings: Partial<Settings>): void {
  Object.assign(display, displayFrom(settings));
}

/** Read the settings and apply them. Safe to call from anywhere; a database
 *  that will not open must not stop words being drawn. */
export async function loadDisplay(): Promise<DisplaySettings> {
  try {
    applyDisplay(await getSettings());
  } catch { /* the defaults are already in place */ }
  return display;
}
