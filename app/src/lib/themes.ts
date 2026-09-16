/** The learner's themes, in the store.
 *
 *  theme.ts says what a theme is; this file is the few things a screen does
 *  with one — save an edit, make a copy, take one away — against the
 *  database, and what the sync then carries. Every write sets `updatedAt`,
 *  because that is how the other device knows which of two edits is the
 *  later one, and a deletion is a tombstone for the same reason.
 */
import { allThemes, putTheme } from './db.js';
import { builtIn, duplicate, isEdited, resetOf, themesInUse, trustTheme } from './theme.js';
import type { Theme } from './theme.js';
import { nowMs } from './units.js';

/** The themes on offer on this device: the built-ins, each replaced by its
 *  edit where there is one, then the learner's own. Rows that are not
 *  themes are left out, not guessed at. */
export async function offeredThemes(): Promise<Theme[]> {
  const rows = await allThemes();
  return themesInUse(rows.map(trustTheme).filter((t) => t !== null));
}

/** Write a theme as the learner has it now — an edit of a built-in under
 *  the built-in's id, or one of their own — stamped with the moment. */
export async function saveTheme(theme: Theme): Promise<Theme> {
  const out: Theme = { ...theme, colours: { ...theme.colours }, updatedAt: nowMs() };
  delete out.deleted;
  await putTheme(out);
  return out;
}

/** A copy of the theme, stored, named after it, remembering the built-in it
 *  descends from. The id is minted here, not chosen. */
export async function copyTheme(theme: Theme): Promise<Theme> {
  const out = duplicate(theme, { id: crypto.randomUUID(), now: nowMs() });
  await putTheme(out);
  return out;
}

/** Put the theme back the way it shipped. For an edited built-in that is
 *  dropping the edit — a tombstone, so the other device drops it too. For a
 *  copy it is the built-in's colours under the copy's own name. Resolves to
 *  what is on offer under that id afterwards, or null when there was
 *  nothing to go back to. */
export async function resetTheme(theme: Theme): Promise<Theme | null> {
  const back = resetOf(theme);
  if (!back) return null;
  if (builtIn(theme.id)) {
    if (isEdited(theme)) await putTheme({ ...theme, updatedAt: nowMs(), deleted: true });
    return back;
  }
  return saveTheme(back);
}

/** Take one of the learner's own themes away. A built-in cannot go; reset
 *  it instead. The record stays as a tombstone so the deletion travels. */
export async function removeTheme(theme: Theme): Promise<void> {
  if (builtIn(theme.id)) return;
  await putTheme({ ...theme, updatedAt: nowMs(), deleted: true });
}
