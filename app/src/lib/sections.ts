/** Which of a card's fold-away sections are open.
 *
 *  The definitions on the back of a card and a verb's forms each hide behind
 *  a chevron. Whether they are open used to be a variable on the study
 *  screen, which is to say it lasted exactly as long as the screen did: close
 *  the definitions, reload for a new version, and they were open again (#64).
 *  So it is a setting now, written the moment a chevron is pressed and read
 *  by every screen that has the section — the study card and the word page
 *  show the same forms table, and it would be odd for it to be open on one
 *  and closed on the other.
 */
import { getSettings, setSetting } from './db.js';
import { report } from './diagnostics.js';
import type { Section, Settings } from './model.js';

/** How each section stands until the learner has touched it: the
 *  definitions open, because they are what the back of the card is for; the
 *  forms closed, because a table under every verb is a wall. */
export const OPEN_BY_DEFAULT: Readonly<Record<Section, boolean>> = { defs: true, forms: false };

/** Every section's state, as the settings have it, with the defaults under
 *  what was stored. Never absent: a screen can read `.defs` without asking. */
export function sectionsOf(settings: Pick<Settings, 'openSections'>): Record<Section, boolean> {
  const stored = settings.openSections ?? {};
  return {
    defs: stored.defs ?? OPEN_BY_DEFAULT.defs,
    forms: stored.forms ?? OPEN_BY_DEFAULT.forms,
  };
}

/** Write down that a section was opened or closed, leaving the others as
 *  they were. The record written is a fresh plain object, never the screen's
 *  own state: a `$state` proxy does not survive the structured clone
 *  IndexedDB makes (the same DataCloneError `setSetting` guards against for
 *  lists). A store that will not take it is written down (diagnostics.ts) and
 *  the section stays as the screen has it: the learner is not stopped over a
 *  chevron. Resolves to what was said, false when it was not kept. */
export async function rememberSection(section: Section, open: boolean): Promise<boolean> {
  try {
    const current = (await getSettings()).openSections ?? {};
    await setSetting('openSections', { ...current, [section]: open });
    return true;
  } catch (e) {
    report('sections', `could not remember the ${section} being ${open ? 'open' : 'closed'}: ${String(e)}`);
    return false;
  }
}
