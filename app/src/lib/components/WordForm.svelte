<script lang="ts">
  /** The form for a word of your own: adding one, or correcting one. The
   *  same fields either way, and the same warning before a word with no
   *  English is saved. What the fields mean is wordsview.ts's business. */
  import { NUMBERS, POS } from '$lib/words.js';
  import type { WordForm } from '$lib/wordsview.js';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  interface Props {
    form: WordForm;
    /** The warning given before saving, or empty; the submit button changes
     *  its word to "anyway" while it stands. */
    warning: string;
    busy: boolean;
    /** "Add word" or "Save". */
    action: string;
    onSubmit: () => void;
    onCancel: () => void;
    /** The English changed: the warning about it no longer applies. */
    onEnglish: () => void;
  }

  let { form = $bindable(), warning, busy, action, onSubmit, onCancel, onEnglish }: Props = $props();
</script>

<form onsubmit={(e) => { e.preventDefault(); onSubmit(); }}>
  <label>French <input type="text" bind:value={form.fr} required autocapitalize="none"
                       autocorrect="off" spellcheck="false" placeholder="le natel" /></label>
  <label>English <input type="text" bind:value={form.en} oninput={onEnglish}
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
