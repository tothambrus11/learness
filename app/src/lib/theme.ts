/** Colour themes: what one is, which ones ship, and how a screen gets its
 *  colours out of one.
 *
 *  Every screen is painted from a short list of tokens — the page, the panel,
 *  the ink, the accent, the four gender colours and so on — declared once on
 *  the root as CSS custom properties. A theme is a value for each of those
 *  tokens, and a note of whether it is a light or a dark one, which is what
 *  the browser needs to draw its own controls the right way round.
 *
 *  Two things make a theme survive the app changing under it (#66):
 *
 *  * **A token a theme does not name still has a value.** Each token says in
 *    `TOKENS` what to do when a theme is silent about it: a default for light
 *    and one for dark, or the name of another token to take. So a theme saved
 *    today is whole after a token is added next year, and adding a token is
 *    one row here, never a migration of what learners saved.
 *  * **The theme that ships and the learner's edit of it are one identity.**
 *    An edited built-in keeps the built-in's id, so "reset" is dropping the
 *    edit and "duplicate" is a new id that remembers where it came from. The
 *    edits and the copies are what is stored and synced; the built-ins are
 *    code.
 *
 *  Nothing here reaches a database or the document: themes.ts stores them
 *  and theme.svelte.ts paints with them. This file is the rules, and the
 *  server may import it.
 */
import type { Millis } from './units.js';

/** One colour a screen is painted with. The names are the CSS variables',
 *  camel-cased; the variable itself is in `TOKENS`. */
export type Token =
  | 'bg' | 'panel' | 'ink' | 'muted' | 'line'
  | 'accent' | 'good' | 'bad' | 'warn'
  | 'onAccent' | 'onGood' | 'onWarn' | 'ipa'
  | 'fem' | 'masc' | 'plur' | 'both';

/** Light or dark: what the browser is told, and which of a pair the system
 *  setting picks. A theme says which it is; nothing is inferred from its
 *  colours. */
export type ThemeMode = 'light' | 'dark';

/** Where a token's value comes from when the theme does not say: a default
 *  for each mode, or another token's value. The second is for tokens that
 *  were split off an existing one — "what is read on a good fill" used to be
 *  "what is read on the accent" — so a theme from before the split still
 *  reads right. */
export type Fallback = { light: string; dark: string } | { like: Token };

export interface TokenSpec {
  name: Token;
  /** The custom property the screens read. */
  variable: `--${string}`;
  /** What the settings page calls it. */
  label: string;
  /** Which row of the editor it sits in. */
  group: 'page' | 'text' | 'signal' | 'gender';
  fallback: Fallback;
}

/** Every token, in the order the editor shows them. Adding one here — with a
 *  fallback — is the whole of adding a colour to the app. */
export const TOKENS: readonly TokenSpec[] = [
  { name: 'bg', variable: '--bg', label: 'Page', group: 'page',
    fallback: { light: '#eef1f1', dark: '#000000' } },
  { name: 'panel', variable: '--panel', label: 'Panel', group: 'page',
    fallback: { light: '#ffffff', dark: '#0d1211' } },
  { name: 'line', variable: '--line', label: 'Lines', group: 'page',
    fallback: { light: '#d8e0de', dark: '#1e2a28' } },
  { name: 'ink', variable: '--ink', label: 'Text', group: 'text',
    fallback: { light: '#10201e', dark: '#ecf5f2' } },
  { name: 'muted', variable: '--muted', label: 'Quiet text', group: 'text',
    fallback: { light: '#5f7370', dark: '#8ba39e' } },
  { name: 'ipa', variable: '--ipa', label: 'Pronunciation', group: 'text',
    fallback: { like: 'warn' } },
  { name: 'accent', variable: '--accent', label: 'Accent', group: 'signal',
    fallback: { light: '#0b6c62', dark: '#27efd7' } },
  { name: 'good', variable: '--good', label: 'Good', group: 'signal',
    fallback: { like: 'accent' } },
  { name: 'bad', variable: '--bad', label: 'Bad', group: 'signal',
    fallback: { light: '#b91c1c', dark: '#ff7b7b' } },
  { name: 'warn', variable: '--warn', label: 'Warning', group: 'signal',
    fallback: { light: '#a15c07', dark: '#f0b95e' } },
  { name: 'onAccent', variable: '--on-accent', label: 'On the accent', group: 'signal',
    fallback: { light: '#ffffff', dark: '#001a16' } },
  { name: 'onGood', variable: '--on-good', label: 'On good', group: 'signal',
    fallback: { like: 'onAccent' } },
  { name: 'onWarn', variable: '--on-warn', label: 'On a warning', group: 'signal',
    fallback: { light: '#ffffff', dark: '#201502' } },
  { name: 'masc', variable: '--masc', label: 'Masculine', group: 'gender',
    fallback: { light: '#1d4ed8', dark: '#8ab4ff' } },
  { name: 'fem', variable: '--fem', label: 'Feminine', group: 'gender',
    fallback: { light: '#c81e4a', dark: '#ff8fa8' } },
  { name: 'plur', variable: '--plur', label: 'Plural', group: 'gender',
    fallback: { light: '#15803d', dark: '#7ee787' } },
  { name: 'both', variable: '--both', label: 'Either', group: 'gender',
    fallback: { light: '#7c3aed', dark: '#d0a9ff' } },
];

/** A theme, as it is stored and as it travels between devices. */
export interface Theme {
  /** A built-in's id when this is the learner's edit of it; otherwise a uuid.
   *  The id is the identity: two devices editing "Minuit" are editing one
   *  thing, and the later edit wins. */
  id: string;
  name: string;
  mode: ThemeMode;
  /** Only the tokens the theme sets; `resolveColours` fills the rest. */
  colours: Partial<Record<Token, string>>;
  /** The built-in this was copied from, so "reset" has somewhere to go. */
  basedOn?: string;
  updatedAt: Millis;
  /** A tombstone, so a deletion travels instead of being resurrected. */
  deleted?: boolean;
}

const shipped = (id: string, name: string, mode: ThemeMode,
  colours: Partial<Record<Token, string>>): Theme =>
  ({ id, name, mode, colours, updatedAt: 0 as Millis });

/** The themes that ship, each named for a French word, in the order they
 *  are offered. The first light and the first dark are the defaults.
 *
 *  Aube and Minuit are the app's own: the logo's turquoise, at full strength
 *  on black in the dark and deepened until it can be read in the light.
 *  Parchemin and Ardoise are the pair the app wore before that — blue,
 *  because a default was blue — kept for whoever preferred them. */
export const BUILT_IN: readonly Theme[] = [
  shipped('aube', 'Aube', 'light', {
    bg: '#eef1f1', panel: '#ffffff', line: '#d8e0de', ink: '#10201e', muted: '#5f7370',
    ipa: '#8a5a12', accent: '#0b6c62', good: '#0f766e', bad: '#b91c1c', warn: '#a15c07',
    onAccent: '#ffffff', onGood: '#ffffff', onWarn: '#ffffff',
    masc: '#1d4ed8', fem: '#c81e4a', plur: '#15803d', both: '#7c3aed',
  }),
  shipped('minuit', 'Minuit', 'dark', {
    bg: '#000000', panel: '#0d1211', line: '#1e2a28', ink: '#ecf5f2', muted: '#8ba39e',
    ipa: '#ecc178', accent: '#27efd7', good: '#27efd7', bad: '#ff7b7b', warn: '#f0b95e',
    onAccent: '#001a16', onGood: '#001a16', onWarn: '#201502',
    masc: '#8ab4ff', fem: '#ff8fa8', plur: '#7ee787', both: '#d0a9ff',
  }),
  shipped('parchemin', 'Parchemin', 'light', {
    bg: '#fbfaf7', panel: '#ffffff', line: '#e6e3dc', ink: '#1c1c1a', muted: '#6b6a66',
    ipa: '#8a5a12', accent: '#1d4ed8', good: '#15803d', bad: '#b91c1c', warn: '#b45309',
    onAccent: '#ffffff', onGood: '#ffffff', onWarn: '#ffffff',
    masc: '#1d4ed8', fem: '#dc2626', plur: '#15803d', both: '#7c3aed',
  }),
  shipped('ardoise', 'Ardoise', 'dark', {
    bg: '#16171a', panel: '#1f2125', line: '#2e3136', ink: '#e9e8e4', muted: '#9a9892',
    ipa: '#ecc178', accent: '#7ea2ff', good: '#6ee7a0', bad: '#fca5a5', warn: '#fbbf24',
    onAccent: '#0b1220', onGood: '#06281a', onWarn: '#201502',
    masc: '#7ea2ff', fem: '#f87171', plur: '#6ee7a0', both: '#d0a9ff',
  }),
  shipped('lavande', 'Lavande', 'light', {
    bg: '#f4f1fa', panel: '#ffffff', line: '#dcd5ea', ink: '#1e1a2e', muted: '#665e7d',
    ipa: '#8a5a12', accent: '#5b3fb8', good: '#2f7d5a', bad: '#b42a4a', warn: '#9a5b10',
    onAccent: '#ffffff', onGood: '#ffffff', onWarn: '#ffffff',
    masc: '#2f52c7', fem: '#c2266a', plur: '#2f7d5a', both: '#7c3aed',
  }),
  shipped('foret', 'Forêt', 'dark', {
    bg: '#0b1410', panel: '#142019', line: '#22342a', ink: '#e6f0e8', muted: '#8fa896',
    ipa: '#e6c98a', accent: '#7fd6a0', good: '#7fd6a0', bad: '#ff8a8a', warn: '#f2c26b',
    onAccent: '#062012', onGood: '#062012', onWarn: '#201502',
    masc: '#93b8ff', fem: '#ff9db0', plur: '#8fe39a', both: '#d5b3ff',
  }),
  shipped('crepuscule', 'Crépuscule', 'dark', {
    bg: '#120c08', panel: '#1e1510', line: '#332519', ink: '#f3e9df', muted: '#a89383',
    ipa: '#ecc178', accent: '#f2a94c', good: '#7ee0a0', bad: '#ff8f7a', warn: '#f2c26b',
    onAccent: '#221200', onGood: '#06281a', onWarn: '#201502',
    masc: '#8fb8ff', fem: '#ff9aa8', plur: '#8fe39a', both: '#d5b3ff',
  }),
];

export const DEFAULT_LIGHT = 'aube';
export const DEFAULT_DARK = 'minuit';

/** The built-in with this id, untouched by any edit. */
export const builtIn = (id: string): Theme | undefined => BUILT_IN.find((t) => t.id === id);

/** What a colour must look like to be stored: a hex colour, the one shape
 *  a colour input produces and every browser reads. Nothing else — a theme
 *  is data that came over the wire, and `url(...)` is not a colour. */
export const isColour = (value: unknown): value is string =>
  typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

/** The colour as a colour input wants it: six hex digits, no alpha. A
 *  theme may hold `#abc` or `#rrggbbaa`, both colours; an input holds one
 *  shape only, and given another shows black. */
export function hex6(value: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (!m) return '#000000';
  const h = m[1]!;
  if (h.length === 3 || h.length === 4) {
    return `#${h.slice(0, 3).split('').map((c) => c + c).join('')}`.toLowerCase();
  }
  return `#${h.slice(0, 6)}`.toLowerCase();
}

/** Every token's value under this theme: what it sets, and for the rest,
 *  what `TOKENS` says — another token's value, followed as far as it goes,
 *  or the default for the theme's mode. Total: a screen never reads an
 *  undefined colour. */
export function resolveColours(theme: Pick<Theme, 'mode' | 'colours'>): Record<Token, string> {
  const out = {} as Record<Token, string>;
  const valueOf = (name: Token, seen: Set<Token>): string => {
    const set = theme.colours[name];
    if (isColour(set)) return set;
    const spec = TOKENS.find((t) => t.name === name)!;
    if (!('like' in spec.fallback)) return spec.fallback[theme.mode];
    /* A chain of "like" ends at a token with defaults; a loop would be a
       mistake in TOKENS, which the tests forbid, and is grey rather than a
       stack overflow. */
    if (seen.has(name)) return '#808080';
    return valueOf(spec.fallback.like, seen.add(name));
  };
  for (const t of TOKENS) out[t.name] = valueOf(t.name, new Set());
  return out;
}

/** The theme as the root's custom properties: variable to value. */
export function cssOf(theme: Pick<Theme, 'mode' | 'colours'>): Record<string, string> {
  const colours = resolveColours(theme);
  return Object.fromEntries(TOKENS.map((t) => [t.variable, colours[t.name]]));
}

/** A theme as it comes out of the store or off the wire, trusted in one
 *  place: the id, name and mode must be what they say, and of the colours
 *  every entry holding a colour is kept and every other dropped. A token
 *  this build does not know is kept too: a theme edited on a newer build and
 *  pulled here must not lose it. Null is a record that is not a theme. */
export function trustTheme(raw: unknown): Theme | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.name !== 'string') return null;
  if (r.mode !== 'light' && r.mode !== 'dark') return null;
  const colours: Record<string, string> = {};
  if (r.colours && typeof r.colours === 'object') {
    for (const [k, v] of Object.entries(r.colours as Record<string, unknown>)) {
      if (isColour(v)) colours[k] = v;
    }
  }
  const out: Theme = {
    id: r.id, name: r.name, mode: r.mode, colours,
    updatedAt: (typeof r.updatedAt === 'number' ? r.updatedAt : 0) as Millis,
  };
  if (typeof r.basedOn === 'string') out.basedOn = r.basedOn;
  if (r.deleted === true) out.deleted = true;
  return out;
}

/** The themes on offer: the built-ins, each replaced by the learner's edit
 *  of it where there is one, then the learner's own, by name. Deleted ones
 *  are not offered. */
export function themesInUse(stored: readonly Theme[]): Theme[] {
  const live = stored.filter((t) => !t.deleted);
  const byId = new Map(live.map((t) => [t.id, t]));
  /* By name as a French reader sorts: Éclair beside Aube, not after Zeta. */
  const own = live.filter((t) => !builtIn(t.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.id.localeCompare(b.id));
  return [...BUILT_IN.map((t) => byId.get(t.id) ?? t), ...own];
}

/** True of a built-in the learner has changed: the stored record with the
 *  built-in's id. Such a theme can be reset; a copy cannot. */
export const isEdited = (theme: Theme): boolean => !!builtIn(theme.id) && theme.updatedAt > 0;

/** Whether the theme is one that ships, edited or not. */
export const isShipped = (theme: Theme): boolean => !!builtIn(theme.id);

/** Whether "reset" means anything for this theme: an edited built-in goes
 *  back to what shipped, a copy goes back to what it was copied from, and a
 *  built-in as it ships, or a theme from nowhere, has nowhere to go. */
export const canReset = (theme: Theme): boolean =>
  !!resetOf(theme) && (isEdited(theme) || !isShipped(theme));

/** Where the theme stands, in a sentence for the editor. */
export function describeOrigin(theme: Theme): string {
  if (isEdited(theme)) return 'Edited from the theme that ships.';
  if (isShipped(theme)) return 'As it ships. Change a colour and it is yours, under this name.';
  const from = theme.basedOn ? builtIn(theme.basedOn) : undefined;
  return from ? `Your own, from ${from.name}.` : 'Your own.';
}

/** The name as a picker shows it: marked when it is an edit of what ships. */
export const pickerName = (theme: Theme): string =>
  `${theme.name}${isEdited(theme) ? ' (edited)' : ''}`;

/** A copy of the theme under a new id, named after it, remembering which
 *  built-in it descends from. */
export function duplicate(theme: Theme, { id, now }: { id: string; now: Millis }): Theme {
  const from = builtIn(theme.id) ? theme.id : theme.basedOn;
  const out: Theme = {
    id, name: `${theme.name} (copy)`, mode: theme.mode, colours: { ...theme.colours },
    updatedAt: now,
  };
  if (from) out.basedOn = from;
  return out;
}

/** What "reset" gives: the built-in this theme is, or descends from, with
 *  this theme's name kept when it is a copy. Null when there is nothing to
 *  go back to. */
export function resetOf(theme: Theme): Theme | null {
  const origin = builtIn(theme.id) ?? (theme.basedOn ? builtIn(theme.basedOn) : undefined);
  if (!origin) return null;
  if (origin.id === theme.id) return origin;
  const out: Theme = { ...theme, mode: origin.mode, colours: { ...origin.colours } };
  return out;
}

/** How the theme is chosen. Each device keeps its own: a phone in the dark
 *  and a desk in the light are not a disagreement. */
export interface ThemeChoice {
  /** Follow the system, or hold one mode. Absent: the system. */
  themeMode?: 'system' | ThemeMode;
  /** The light theme's id and the dark's. Absent, or not on offer: the
   *  default for that mode. */
  themeLight?: string;
  themeDark?: string;
}

/** The theme to paint with: the one chosen for the mode in force — the
 *  system's, unless the learner held one — falling back to the default for
 *  that mode when the chosen one is not on offer (deleted on another device,
 *  say). Pure; `systemDark` is what the media query said. */
export function pickTheme(
  choice: ThemeChoice, offered: readonly Theme[], systemDark: boolean,
): Theme {
  const mode: ThemeMode = choice.themeMode === 'light' || choice.themeMode === 'dark'
    ? choice.themeMode
    : systemDark ? 'dark' : 'light';
  const wanted = mode === 'dark' ? choice.themeDark : choice.themeLight;
  const fallback = mode === 'dark' ? DEFAULT_DARK : DEFAULT_LIGHT;
  const found = offered.find((t) => t.id === wanted && t.mode === mode)
    ?? offered.find((t) => t.id === fallback)
    ?? builtIn(fallback)!;
  return found;
}
