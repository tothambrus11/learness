<script lang="ts">
  /** The theme picker and the theme editor, on the settings screen.
   *
   *  Three things, top to bottom: which way round the app is (with the
   *  system, or held light or dark); which theme it wears in each; and the
   *  editor, which paints the theme being edited on the whole app while it
   *  is open, so a colour is judged where it will be seen and not in a
   *  swatch. Every change is saved as it is made — there is no form to
   *  submit — and an edit to a theme that ships is kept under its name, with
   *  a reset back to what shipped, or a duplicate to keep both.
   *
   *  The rules — what a theme is, which is in force, what reset and copy
   *  give — are theme.ts and themes.ts; this file draws them.
   */
  import { onDestroy, onMount } from 'svelte';
  import { onSync } from '$lib/sync.js';
  import { setSetting } from '$lib/db.js';
  import { report } from '$lib/diagnostics.js';
  import { DEFAULT_DARK, DEFAULT_LIGHT, TOKENS, canReset, describeOrigin, hex6, isShipped,
    pickerName, resolveColours } from '$lib/theme.js';
  import type { Theme, ThemeMode, Token, TokenSpec } from '$lib/theme.js';
  import { loadTheme, theme } from '$lib/theme.svelte.js';
  import { copyTheme, offeredThemes, removeTheme, resetTheme, saveTheme } from '$lib/themes.js';
  import Copy from '@lucide/svelte/icons/copy';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  interface Props {
    /** Called after a choice — the mode, or the theme for a mode — has been
     *  written, so the page can re-read its settings. */
    onchange: () => void | Promise<void>;
  }
  let { onchange }: Props = $props();

  let offered = $state<Theme[]>([]);
  /** The theme on the editor, painted on the app while it is there. */
  let editing = $state<Theme | null>(null);
  let choice = $state<{ mode: 'system' | ThemeMode; light: string; dark: string }>(
    { mode: 'system', light: DEFAULT_LIGHT, dark: DEFAULT_DARK });
  let notice = $state('');

  const GROUPS: { name: TokenSpec['group']; label: string }[] = [
    { name: 'page', label: 'The page' },
    { name: 'text', label: 'Text' },
    { name: 'signal', label: 'Signals' },
    { name: 'gender', label: 'Gender' },
  ];

  const lights = $derived(offered.filter((t) => t.mode === 'light'));
  const darks = $derived(offered.filter((t) => t.mode === 'dark'));
  const colours = $derived(editing ? resolveColours(editing) : null);

  onMount(async () => {
    const { getSettings } = await import('$lib/db.js');
    const s = await getSettings();
    choice = {
      mode: s.themeMode ?? 'system',
      light: s.themeLight ?? DEFAULT_LIGHT,
      dark: s.themeDark ?? DEFAULT_DARK,
    };
    await refresh();
    /* The layout reads the theme on its own; on a cold load of this page it
       may not have finished, and an editor with nothing on it is not the
       answer. */
    editing = theme.current ?? await loadTheme();
    theme.current = editing;
  });
  /* A sync can bring a theme in, or an edit of the one on the editor, from
     the other device: the pickers learn of it, and the editor shows the
     record as it now is, still painted on the app. */
  const stopSync = onSync((result) => {
    if (result.received.themes) void refresh().then(() => { if (editing) theme.current = editing; });
  });
  /* Leaving the page drops the preview: the app goes back to the theme in
     force, whatever was on the editor. */
  onDestroy(() => { stopSync(); void loadTheme(); });

  async function refresh(): Promise<void> {
    offered = await offeredThemes();
    if (editing) editing = offered.find((t) => t.id === editing?.id) ?? null;
  }

  function failed(doing: string, err: unknown): void {
    const what = `${doing}: ${(err as Error).message ?? String(err)}`;
    report('theme', what);
    notice = `Could not ${doing}.`;
  }

  async function choose(name: 'themeMode' | 'themeLight' | 'themeDark', value: string):
    Promise<void> {
    try {
      if (name === 'themeMode') {
        const mode = value === 'light' || value === 'dark' ? value : 'system';
        await setSetting('themeMode', mode);
        choice.mode = mode;
      } else {
        await setSetting(name, value);
        if (name === 'themeLight') choice.light = value; else choice.dark = value;
      }
      await onchange();
      editing = theme.current;
    } catch (err) { failed('remember the choice', err); }
  }

  /** Put a theme on the editor, and on the app. */
  function edit(id: string): void {
    const found = offered.find((t) => t.id === id);
    if (!found) return;
    editing = found;
    theme.current = found;
  }

  async function change(patch: Partial<Pick<Theme, 'name' | 'mode' | 'colours'>>): Promise<void> {
    if (!editing) return;
    try {
      const saved = await saveTheme({ ...editing, ...patch });
      await refresh();
      editing = saved;
      theme.current = saved;
    } catch (err) { failed('save the theme', err); }
  }
  const setColour = (token: Token, value: string): Promise<void> =>
    change({ colours: { ...editing?.colours, [token]: value } });

  async function reset(): Promise<void> {
    if (!editing) return;
    try {
      const back = await resetTheme(editing);
      await refresh();
      if (back) { editing = back; theme.current = back; }
    } catch (err) { failed('reset the theme', err); }
  }
  async function copy(): Promise<void> {
    if (!editing) return;
    try {
      const made = await copyTheme(editing);
      await refresh();
      edit(made.id);
    } catch (err) { failed('copy the theme', err); }
  }
  async function remove(): Promise<void> {
    if (!editing) return;
    try {
      await removeTheme(editing);
      await refresh();
      await loadTheme();
      editing = theme.current;
    } catch (err) { failed('delete the theme', err); }
  }

</script>

<div class="modes" role="radiogroup" aria-label="Light or dark">
  {#each [['system', 'With the system'], ['light', 'Light'], ['dark', 'Dark']] as [value, label] (value)}
    <label class="mode">
      <input type="radio" name="theme-mode" {value} checked={choice.mode === value}
             onchange={() => choose('themeMode', value ?? 'system')} />
      <span>{label}</span>
    </label>
  {/each}
</div>

<div class="picks">
  <label class="pick">
    <span>In the light</span>
    <select value={choice.light} onchange={(e) => choose('themeLight', e.currentTarget.value)}>
      {#each lights as t (t.id)}<option value={t.id}>{pickerName(t)}</option>{/each}
    </select>
  </label>
  <label class="pick">
    <span>In the dark</span>
    <select value={choice.dark} onchange={(e) => choose('themeDark', e.currentTarget.value)}>
      {#each darks as t (t.id)}<option value={t.id}>{pickerName(t)}</option>{/each}
    </select>
  </label>
</div>

<div class="editor">
  <label class="pick">
    <span>Edit</span>
    <select aria-label="Theme to edit" value={editing?.id ?? ''}
            onchange={(e) => edit(e.currentTarget.value)}>
      <optgroup label="Light">
        {#each lights as t (t.id)}<option value={t.id}>{pickerName(t)}</option>{/each}
      </optgroup>
      <optgroup label="Dark">
        {#each darks as t (t.id)}<option value={t.id}>{pickerName(t)}</option>{/each}
      </optgroup>
    </select>
  </label>

  {#if editing && colours}
    <p class="muted small">
      {describeOrigin(editing)} You are looking at it while you edit; the app goes back
      to your choice when you leave.
    </p>
    {#if !isShipped(editing)}
      <label class="pick">
        <span>Name</span>
        <input type="text" value={editing.name} aria-label="Theme name"
               onchange={(e) => change({ name: e.currentTarget.value.trim() || 'Untitled' })} />
      </label>
      <div class="modes" role="radiogroup" aria-label="This theme is">
        {#each [['light', 'A light theme'], ['dark', 'A dark theme']] as [value, label] (value)}
          <label class="mode">
            <input type="radio" name="theme-kind" {value} checked={editing.mode === value}
                   onchange={() => change({ mode: value === 'dark' ? 'dark' : 'light' })} />
            <span>{label}</span>
          </label>
        {/each}
      </div>
    {/if}

    {#each GROUPS as g (g.name)}
      <div class="group">
        <span class="group-name">{g.label}</span>
        <div class="swatches">
          {#each TOKENS.filter((t) => t.group === g.name) as t (t.name)}
            <label class="colour">
              <input type="color" value={hex6(colours[t.name])} aria-label={t.label}
                     onchange={(e) => setColour(t.name, e.currentTarget.value)} />
              <span>{t.label}</span>
            </label>
          {/each}
        </div>
      </div>
    {/each}

    <div class="actions">
      {#if canReset(editing)}
        <button onclick={reset}><RotateCcw size={14} /> Reset</button>
      {/if}
      <button onclick={copy}><Copy size={14} /> Duplicate</button>
      {#if !isShipped(editing)}
        <button onclick={remove}><Trash2 size={14} /> Delete</button>
      {/if}
    </div>
  {/if}
</div>

{#if notice}<p class="notice">{notice}</p>{/if}

<style>
  .modes { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0; }
  .mode { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
          border: 1px solid var(--line); border-radius: 999px; font-size: 14px;
          cursor: pointer; }
  .mode:has(input:checked) { border-color: var(--accent); color: var(--accent); }
  .mode input { margin: 0; }
  .picks { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 6px 0; }
  .pick { display: flex; align-items: center; gap: 8px; font-size: 14.5px; }
  .pick span { color: var(--muted); }
  .pick select, .pick input[type=text] { min-width: 0; }
  .editor { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line);
            display: flex; flex-direction: column; gap: 6px; }
  .group { display: flex; flex-direction: column; gap: 4px; }
  .group-name { font-size: 13px; color: var(--muted); }
  .swatches { display: flex; flex-wrap: wrap; gap: 10px 14px; }
  .colour { display: flex; flex-direction: column; align-items: center; gap: 4px;
            font-size: 12px; color: var(--muted); }
  .colour input[type=color] { width: 42px; height: 30px; padding: 0;
                              border: 1px solid var(--line); border-radius: 8px;
                              background: none; cursor: pointer; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 6px; }
  p { margin: 4px 0; }
</style>
