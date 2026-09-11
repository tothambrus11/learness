/** How words are painted, kept where every screen can read it: read once when
 *  the app starts, and again whenever the settings page writes a dial. */

import { getSettings } from './db';
import { DEFAULT_DISPLAY } from './gender';
import type { DisplaySettings } from './types';

/** The live values. Read it in a component and it re-renders on a change. */
export const display = $state<DisplaySettings>({ ...DEFAULT_DISPLAY });

/** Take the display dials out of a full settings record. A dial the record
 *  does not carry keeps its default rather than becoming undefined, which is
 *  why the keys are copied one at a time rather than spread wholesale. The
 *  dials are read off the defaults, so adding one there is enough to have it
 *  applied. */
export function displayFrom(settings: Partial<DisplaySettings> = {}): DisplaySettings {
  const out: DisplaySettings = { ...DEFAULT_DISPLAY };
  const given: Record<string, unknown> = settings;
  for (const key of Object.keys(out)) {
    if (given[key] !== undefined) Object.assign(out, { [key]: given[key] });
  }
  return out;
}

/** Put a settings record's dials on screen, everywhere at once. */
export function applyDisplay(settings: Partial<DisplaySettings>): void {
  Object.assign(display, displayFrom(settings));
}

/** Read the settings and apply them. Never throws: a failure leaves the
 *  defaults in place and resolves with them. */
export async function loadDisplay(): Promise<DisplaySettings> {
  try {
    applyDisplay(await getSettings());
  } catch {
    /* the defaults are already in place */
  }
  return display;
}
