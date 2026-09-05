<script>
  /** The tables the pipeline builds for a verb, shown the way they were meant
   *  to be read: the ending is what you memorise, so it is what stands out;
   *  a form whose stem departs from its tense is marked; a tense with no
   *  shared stem is shown whole rather than split into a lie; and two
   *  identical forms in one tense are flagged, since that is where listening
   *  comprehension breaks. */
  import TenseInfo from './TenseInfo.svelte';

  let { conj } = $props();

  /* Which tense's info popover is open: one at a time, closed by Escape or
     by a tap anywhere else. */
  let open = $state(null);
  function outside(e) {
    if (open && !e.target.closest?.('[data-tinfo]')) open = null;
  }
  function key(e) {
    if (e.key === 'Escape') open = null;
  }

  const CORE = ['pres', 'imp', 'fut', 'cond', 'subj', 'imper'];
  let core = $derived(conj.groups.filter((g) => CORE.includes(g.id)));
  let literary = $derived(conj.groups.filter((g) => !CORE.includes(g.id)));
  let showLiterary = $state(false);
  let showCompound = $state(false);
</script>

<svelte:document onclick={outside} onkeydown={key} />

<div class="conj">
  <p class="shape">
    <b>{conj.shape}</b> &middot; compound tenses take <b>{conj.aux}</b>{#if conj.aux === 'être'},
      and the participle agrees{/if}
  </p>

  <div class="impersonal">
    {#each conj.impersonal as x}
      <span><span class="label">{x.label}</span> <b>{x.form}</b>{#if x.hint}&nbsp;<span
        class="muted">({x.hint})</span>{/if}</span>
    {/each}
  </div>

  <div class="tenses">
    {#each core as g (g.id)}
      {@render tense(g)}
    {/each}
  </div>

  {#if literary.length}
    <button class="toggle" onclick={() => (showLiterary = !showLiterary)}>
      {showLiterary ? 'Hide' : 'Show'} literary tenses
    </button>
    {#if showLiterary}
      <div class="tenses">
        {#each literary as g (g.id)}
          {@render tense(g)}
        {/each}
      </div>
    {/if}
  {/if}

  {#if conj.compound?.length}
    <button class="toggle" onclick={() => (showCompound = !showCompound)}>
      {showCompound ? 'Hide' : 'Show'} compound tenses
    </button>
    {#if showCompound}
      <div class="compound-wrap">
      <table class="compound">
        <tbody>
          {#each conj.compound as c}
            <tr>
              <th><span class="th">{c.label}
                <TenseInfo {conj} tense={c.id} align="left" open={open === c.id}
                           onopen={() => (open = c.id)} onclose={() => (open = null)} /></span></th>
              <td><b>{c.example}</b></td>
              <td class="muted">{c.why}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
    {/if}
  {/if}

  {#if conj.links?.length}
    <ul class="links">
      {#each conj.links as l}<li>{@html l}</li>{/each}
    </ul>
  {/if}

  <p class="legend">
    <span><span class="e">ending</span></span>
    <span><span class="alt-mark">form</span> stem changes</span>
    <span>form<sup>=</sup> same as another</span>
  </p>
</div>

{#snippet tense(g)}
  <section class="tense" class:irregular={g.irregular}>
    <h4>
      {g.mood} &middot; {g.tense}
      {#if g.irregular}<span class="flag">irregular</span>
      {:else if g.stem}<span class="stem">{g.stem}-</span>{/if}
      <TenseInfo {conj} tense={g.id} shares={g.shares ?? []} open={open === g.id}
                 onopen={() => (open = g.id)} onclose={() => (open = null)} />
    </h4>
    <div class="rows" class:three={g.rows.length === 3}>
      {#each g.rows as r}
        {#if r}
          <div class="row">
            <span class="p">{r.p}</span>
            <span class="f" class:alt-mark={r.alt}>{#if r.s}<span class="s">{r.s}</span>{/if}<span
              class="e" class:whole={!r.s}>{r.e}</span>{#if r.dup}<sup>=</sup>{/if}</span>
            {#if r.also?.length}<span class="also">/ {r.also.join(' / ')}</span>{/if}
          </div>
        {:else}
          <div class="row empty">&mdash;</div>
        {/if}
      {/each}
    </div>
    {#if g.note}<p class="note">{g.note}</p>{/if}
  </section>
{/snippet}

<style>
  .conj { font-size: 14px; }
  .shape { margin: 0 0 10px; color: var(--muted); }
  .impersonal { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-bottom: 14px; }
  .label { color: var(--muted); font-size: 12px; }
  .muted { color: var(--muted); }
  .tenses { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 10px; }
  .tense { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
  .tense.irregular { border-style: dashed; }
  h4 { margin: 0 0 6px; font-size: 12px; font-weight: 600; text-transform: uppercase;
       letter-spacing: .05em; color: var(--muted); display: flex; gap: 8px;
       align-items: baseline; flex-wrap: wrap; }
  .stem { text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--ink);
          font-family: Georgia, serif; }
  .flag { text-transform: none; letter-spacing: 0; font-weight: 500; color: #b45309; }
  .rows { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, auto);
          grid-auto-flow: column; column-gap: 12px; row-gap: 2px; }
  .rows.three { grid-template-columns: 1fr; }
  .row { display: flex; gap: 6px; align-items: baseline; white-space: nowrap; }
  .row.empty { color: var(--line); }
  .also { color: var(--muted); font-size: 12.5px; }
  .p { color: var(--muted); font-size: 12.5px; min-width: 3.4em; }
  .f { font-size: 15px; }
  .e { color: var(--accent); font-weight: 650; }
  .e.whole { color: var(--ink); font-weight: 600; }
  .alt-mark { text-decoration: underline; text-decoration-color: #b45309;
              text-decoration-thickness: 2px; text-underline-offset: 3px; }
  .alt-mark .e { color: #b45309; }
  sup { font-size: 10px; color: var(--muted); margin-left: 1px; }
  .note { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
  .toggle { display: block; margin: 12px 0 0; font: inherit; font-size: 13px;
            color: var(--accent); background: none; border: none; padding: 0;
            cursor: pointer; }
  .toggle + .tenses, .toggle + .compound-wrap { margin-top: 10px; }
  .compound-wrap { position: relative; }
  .compound { border-collapse: collapse; width: 100%; }
  .compound th { text-align: left; font-weight: 500; color: var(--muted); font-size: 12.5px;
                 padding: 4px 8px 4px 0; white-space: nowrap; vertical-align: top; }
  .compound .th { display: inline-flex; gap: 4px; align-items: center; }
  .compound td { padding: 4px 8px 4px 0; vertical-align: top; }
  .links { margin: 12px 0 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
  .links li { margin-bottom: 3px; }
  .links :global(b) { color: var(--ink); }
  .legend { margin: 12px 0 0; font-size: 12px; color: var(--muted); display: flex;
            gap: 14px; flex-wrap: wrap; }
</style>
