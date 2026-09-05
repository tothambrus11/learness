<script>
  /** The dials that matter for learning, and the way out.
   *
   *  The new-word count is derived, not set: you choose how much reviewing you
   *  want per day, and whatever room is left becomes new words. */
  import { exportProgress, setSetting } from '$lib/db.js';
  import { POLICIES, bulkPolicyLabel } from '$lib/syncpolicy.js';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Download from '@lucide/svelte/icons/download';

  let { settings, onChange = () => {} } = $props();
  let open = $state(false);
  let exported = $state('');

  async function set(name, value) {
    await setSetting(name, value);
    onChange();
  }

  const number = (name, { min, max, scale = 1 }) => (event) => {
    const raw = Number(event.target.value);
    if (!Number.isFinite(raw)) return;
    const v = Math.min(max, Math.max(min, raw)) / scale;
    set(name, v);
  };

  async function download() {
    const data = await exportProgress();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `frcog-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    exported = `${data.states.length} cards and ${data.reviews.length} reviews. Merge with: frcog import-app <file>`;
  }
</script>

<button class="toggle" onclick={() => (open = !open)} aria-expanded={open}>
  {#if open}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if} Settings
</button>

{#if open}
  <section class="panel">
    <h2>How much per day</h2>
    <label>
      <span>Reviews you are happy to do</span>
      <input type="number" min="10" max="1000" step="10" value={settings.targetReviews}
             onchange={number('targetReviews', { min: 10, max: 1000 })} />
    </label>
    <label>
      <span>New words at most</span>
      <input type="number" min="0" max="100" value={settings.maxNewPerDay}
             onchange={number('maxNewPerDay', { min: 0, max: 100 })} />
    </label>
    <label>
      <span>Cards in one sitting</span>
      <input type="number" min="10" max="300" step="10" value={settings.sessionLimit}
             onchange={number('sessionLimit', { min: 10, max: 300 })} />
    </label>
    <label>
      <span>Recall to aim for</span>
      <span class="unit">
        <input type="number" min="70" max="97" value={Math.round(settings.desiredRetention * 100)}
               onchange={number('desiredRetention', { min: 70, max: 97, scale: 100 })} />%
      </span>
    </label>
    <p class="muted small">
      New words per day are worked out from the room these leave, and slow down
      on their own in a week of forgetting. Aiming higher than 90% recall means
      reviewing much more often.
    </p>

    <h2>Audio downloads</h2>
    {#each POLICIES as p}
      <label class="radio">
        <input type="radio" name="bulk" value={p} checked={settings.bulkDownload === p}
               onchange={() => set('bulkDownload', p)} />
        {bulkPolicyLabel(p)}
      </label>
    {/each}

    <h2>Your data</h2>
    <p class="muted small">
      Everything you have learned is on this device{settings.syncToken ? ' and synced' : ''}.
      A file of it can be merged into the pipeline's database.
    </p>
    <button onclick={download}><Download size={15} /> Export progress</button>
    {#if exported}<p class="small">{exported}</p>{/if}
  </section>
{/if}

<style>
  .toggle { display: flex; justify-content: flex-start; width: 100%; text-align: left; border: none; background: none;
            color: var(--accent); padding: 8px 4px; font: inherit; font-size: 14px;
            cursor: pointer; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
           padding: 14px 16px; margin-bottom: 12px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
       color: var(--muted); margin: 14px 0 8px; }
  h2:first-child { margin-top: 0; }
  label { display: flex; justify-content: space-between; align-items: center; gap: 12px;
          padding: 5px 0; font-size: 14.5px; }
  label.radio { justify-content: flex-start; font-size: 13.5px; cursor: pointer; }
  input[type=number] { font: inherit; width: 5.5em; padding: 6px 8px; border-radius: 8px;
                       border: 1px solid var(--line); background: var(--bg); color: var(--ink);
                       text-align: right; }
  .unit { display: flex; align-items: center; gap: 4px; }
  button:not(.toggle) { font: inherit; font-weight: 600; padding: 9px 14px; border-radius: 10px;
                        border: 1px solid var(--line); background: var(--panel); color: var(--ink);
                        cursor: pointer; }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  p { margin: 6px 0; }
</style>
