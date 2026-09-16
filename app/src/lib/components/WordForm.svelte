<script lang="ts">
  /** The form for a word of your own: adding one, or correcting one — on the
   *  words screen, and in the popup over a card. The same fields either way,
   *  and the same warning before a word with no English is saved.
   *
   *  It owns what is being typed and the one warning, and hands back the form
   *  when it is saved. The words screen used to hold that state itself, once
   *  for adding and once for correcting, and the card's popup would have been
   *  a third copy. What the fields mean is wordsview.ts's business; what
   *  saving does is the screen's. */
  import type { Snippet } from 'svelte';
  import { NUMBERS, POS } from '$lib/words.js';
  import { guardSave } from '$lib/wordsview.js';
  import type { WordForm } from '$lib/wordsview.js';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  interface Props {
    /** What the fields start with: an empty form, or a word laid out for
     *  correcting. Read once, when the form opens, and copied. */
    initial: WordForm;
    /** "Add word" or "Save". */
    action: string;
    /** Save what was typed, as the form holds it — `fromForm` turns it into
     *  a record. Awaited, with the buttons disabled meanwhile; the form stays
     *  open until the screen closes it, so a save that failed can be tried
     *  again. Never called with an empty French. */
    onSave: (form: WordForm) => Promise<void>;
    onCancel: () => void;
    /** A line under the buttons: what saving keeps, say. */
    children?: Snippet;
  }

  let { initial, action, onSave, onCancel, children }: Props = $props();

  /* `initial` is read once by design: each opening of the form is a new
     instance, so a fresh copy is right, and a copy is what keeps the
     screen's own record untouched until it is saved. */
  // svelte-ignore state_referenced_locally
  let form = $state<WordForm>({ ...initial });
  let warning = $state('');
  let busy = $state(false);

  /** The warning is given once; the second press saves anyway. */
  async function submit(): Promise<void> {
    if (!form.fr.trim()) return;
    const verdict = guardSave(form, warning);
    warning = verdict.warning;
    if (!verdict.proceed) return;
    busy = true;
    try {
      await onSave($state.snapshot(form));
    } finally {
      busy = false;
    }
  }
</script>

<form onsubmit={(e) => { e.preventDefault(); void submit(); }}>
  <label>French <input type="text" bind:value={form.fr} required autocapitalize="none"
                       autocorrect="off" spellcheck="false" placeholder="le natel" /></label>
  <!-- The English changed: the warning about it no longer applies. -->
  <label>English <input type="text" bind:value={form.en} oninput={() => (warning = '')}
                        placeholder="mobile phone, cell phone" /></label>
  <div class="row">
    <label>Part of speech
      <select bind:value={form.pos}>{#each POS as p (p)}<option value={p}>{p}</option>{/each}</select>
    </label>
    {#if form.pos === 'noun'}
      <label>Gender
        <select bind:value={form.gender}>
          <option value="">unknown</option><option value="m">m</option>
          <option value="f">f</option><option value="mf">either</option>
        </select>
      </label>
      <label>Number
        <select bind:value={form.number}>
          {#each NUMBERS as n (n)}<option value={n}>{n === 'pl' ? 'plural' : 'singular'}</option>{/each}
        </select>
      </label>
    {/if}
  </div>
  <label>Note <input type="text" bind:value={form.note} placeholder="optional" /></label>
  {#if warning}<p class="warning"><TriangleAlert size={15} /> {warning}</p>{/if}
  <div class="actions">
    <button type="submit" class="primary" disabled={busy}>
      {warning ? 'Save anyway' : action}
    </button>
    <button type="button" onclick={onCancel}>Cancel</button>
  </div>
  {@render children?.()}
</form>

<style>
  form { width: 100%; }
  input, select { width: 100%; }
  label { display: block; font-size: 13px; color: var(--muted); margin-top: 10px; }
  label input, label select { margin-top: 4px; color: var(--ink); font-size: 15px; }
  .row { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
  .row label { flex: 1; min-width: 7em; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .warning { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--warn);
             background: color-mix(in srgb, var(--warn) 10%, transparent);
             border: 1px solid var(--warn); border-radius: 10px; padding: 9px 11px;
             margin: 12px 0 0; }
</style>
