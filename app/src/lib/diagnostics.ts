/** What went wrong, kept where the learner can see it.
 *
 *  A missing recording took a console to diagnose (#31), and the learner had
 *  no console: the button did nothing, twice, and the report said so and no
 *  more. So the things that go wrong — a recording that would not fetch, a
 *  voice that would not load, a sync that failed, the app failing to start —
 *  are written down here as they happen, shown on the settings screen, and
 *  put into the bug report the bar's button opens. Every "nothing happened"
 *  after this comes with its cause.
 *
 *  Kept small and plain: the last few notes, in memory, mirrored to the
 *  `meta` store so a reload does not lose the one that mattered. Reporting
 *  never throws and never waits — the store may be the thing that failed.
 */
import { version } from '$app/environment';
import { getMeta, setMeta } from './db.js';
import { nowMs } from './units.js';
import type { Millis } from './units.js';

/** One thing that went wrong: when, which part of the app, and what it said. */
export interface Note {
  at: Millis;
  where: string;
  what: string;
}

/** How many are kept. Enough for a session's worth; not a log. */
export const KEEP = 40;
const META = 'diagnostics';

/** Where a bug is reported: a new issue, which the bar's button opens with
 *  the notes and the environment already in it. */
export const ISSUES = 'https://github.com/tothambrus11/learness/issues/new';

const notes: Note[] = [];
const listeners = new Set<(notes: readonly Note[]) => void>();
let loaded: Promise<void> | null = null;

const tell = (): void => { for (const fn of listeners) fn(notes); };
/* Written after what an earlier load saved has been read in: a note reported
   before that would otherwise overwrite the one that mattered. */
const persist = (): void => { void load().then(() => setMeta(META, [...notes])).catch(() => {}); };

/** Write one down. The same note twice in a row is one note, dated the
 *  later time: a button pressed three times is one thing wrong, not three. */
export function report(where: string, what: string): void {
  const text = (what ?? '').trim();
  if (!text) return;
  const last = notes.at(-1);
  if (last && last.where === where && last.what === text) last.at = nowMs();
  else notes.push({ at: nowMs(), where, what: text });
  while (notes.length > KEEP) notes.shift();
  tell();
  persist();
}

const isNote = (x: unknown): x is Note =>
  !!x && typeof x === 'object' && typeof (x as Note).what === 'string'
  && typeof (x as Note).where === 'string' && typeof (x as Note).at === 'number';

/** The notes, with what an earlier load of the app wrote down in front of
 *  this one's. Read once; safe to call again. */
export function load(): Promise<readonly Note[]> {
  if (!loaded) {
    loaded = getMeta<unknown[]>(META).catch(() => null).then((saved) => {
      const before = Array.isArray(saved) ? saved.filter(isNote) : [];
      /* What was written before this load goes in front, and anything this
         load has already written stays where it is. */
      notes.unshift(...before.filter((old) => !notes.some((n) => n.at === old.at && n.what === old.what)));
      while (notes.length > KEEP) notes.shift();
      tell();
    });
  }
  return loaded.then(() => notes);
}

/** The notes as they stand, oldest first. */
export const all = (): readonly Note[] => notes;

export function clear(): void {
  notes.length = 0;
  tell();
  persist();
}

/** Called with the notes now and whenever one is added. */
export function onNotes(fn: (notes: readonly Note[]) => void): () => void {
  listeners.add(fn);
  fn(notes);
  return () => { listeners.delete(fn); };
}

/* ---------------------------------------------------------- the screen -- */

let situation = '';
const situationWatchers = new Set<(what: string) => void>();

/** Say what the learner is looking at, in one line, from the screen that
 *  knows: the card on the study screen and which way up it is, the word
 *  on its page, what the words screen is searching for. The bug button
 *  puts it in the report beside the notes, so a report about a card names
 *  the card and not only the screen (#98). Empty means nothing in
 *  particular; a screen says so on its way out. Never throws. */
export function situate(what: string): void {
  const text = (what ?? '').trim();
  if (text === situation) return;
  situation = text;
  notify(situationWatchers, situation, 'diagnostics', 'a watcher of the situation failed');
}

/** What the screen last said it was showing, or empty. */
export const situationNow = (): string => situation;

/** Called with the situation now and whenever a screen changes it. */
export function onSituation(fn: (what: string) => void): () => void {
  situationWatchers.add(fn);
  fn(situation);
  return () => { situationWatchers.delete(fn); };
}

/** Call every listener with a value. One that throws is written down under
 *  `where` — a listener is a screen, and a screen's bug must not silence the
 *  voice, the sync or the list — and the rest are still called. The three
 *  modules with listeners of their own each had a copy of this loop. */
export function notify<T>(
  to: Iterable<(value: T) => void>, value: T, where: string, what: string,
): void {
  for (const fn of to) {
    try { fn(value); } catch (err) {
      report(where, `${what}: ${(err as Error).message}`);
    }
  }
}

/** What a report is worth having beside the notes. Each piece is a plain
 *  string, gathered by the screen, because most of them are asked of the
 *  browser and not of this module. */
export interface Environment {
  /** SvelteKit's build id, so a report says which build it is about. */
  version?: string;
  agent?: string;
  online?: boolean;
  connection?: string;
  /** The on-device voice is here. */
  voice?: boolean;
  signedIn?: boolean;
  /** The screen the report was sent from, as `report.ts`'s `screenOf` spells
   *  it: path and query, never the origin. A report that said "the button
   *  did nothing" used to leave which screen to guesswork (#47). */
  page?: string;
  /** What was on the screen, as the screen said it (`situate`): the card
   *  and its face, the word, the search. A report about an exercise used
   *  to say "on /study/" and no more (#98). */
  situation?: string;
}

/** The body of a bug report: the notes, newest first, and the environment.
 *  Plain text, since it is going into a text box. */
export function reportBody(env: Environment, from: readonly Note[] = notes): string {
  const lines = [
    '', '', '---', '<!-- What the app wrote down before this report, newest first. -->',
    '```',
    ...from.toReversed().map((n) =>
      `${new Date(n.at).toISOString().slice(0, 19).replace('T', ' ')}  ${n.where}: ${n.what}`),
    '```',
    `build ${env.version ?? version} · ${env.online === false ? 'offline' : 'online'}`
    + (env.connection ? `, ${env.connection}` : '')
    + ` · voice ${env.voice ? 'on device' : 'not on device'}`
    + ` · ${env.signedIn ? 'signed in' : 'not signed in'}`
    + (env.page ? ` · on ${env.page}` : ''),
    ...(env.situation ? [`showing ${env.situation}`] : []),
    env.agent ?? '',
  ];
  return lines.join('\n').trimEnd();
}

/** A link that opens a new issue with the body filled in. A browser's
 *  address bar has a limit, so the notes are trimmed from the oldest until
 *  the link fits. */
export function issueUrl(env: Environment, from: readonly Note[] = notes, limit = 6000): string {
  let keep = [...from];
  for (;;) {
    const url = `${ISSUES}?body=${encodeURIComponent(reportBody(env, keep))}`;
    if (url.length <= limit || !keep.length) return url;
    keep = keep.slice(1);
  }
}
