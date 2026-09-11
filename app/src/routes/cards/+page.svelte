<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import {
    SHORT,
    SORTS,
    dueText,
    sortRows,
    stateLabel,
    strengthBar,
    summarise,
    tally,
  } from '$lib/cardsview';
  import { index } from '$lib/catalogue';
  import Fr from '$lib/components/Fr.svelte';
  import { allCards, allReviews } from '$lib/db';
  import { CHANNEL_LABEL, RUNG_LABEL } from '$lib/keys';
  import type { CatalogueEntry, StudyWord, WordKey } from '$lib/types';
  import { activeUserWords, toStudyWord } from '$lib/words';
  import { onMount } from 'svelte';

  /** One row of this screen: a word, its channels, and the numbers in front of
   *  them. Taken from `summarise()` rather than restated, so the two cannot
   *  drift apart. */
  type Row = ReturnType<typeof summarise>[number];

  /** True until the cards and the log have been read. */
  let loading = $state(true);
  /** What went wrong reading them; `''` when nothing did. */
  let error = $state('');
  /** Every word met, one row each, in whatever order `summarise()` built them;
   *  `shown` is what the list actually renders. */
  let rows = $state<Row[]>([]);
  /** Which ordering the list is in — a key of SORTS, which is what the select
   *  offers and what `sortRows()` accepts. */
  let sortBy = $state<keyof typeof SORTS>('weakest');
  /** What is typed in the filter box, matched against the French and English. */
  let query = $state('');
  let open = $state<WordKey | null>(null); /* key of the expanded row */

  /** How the words met are spread across new, learning, review and known. */
  let counts = $derived(tally(rows));
  /** The rows as the list shows them: filtered by the box, then sorted. */
  let shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const hit = q
      ? rows.filter((r) => r.fr.toLowerCase().includes(q) || r.en.toLowerCase().includes(q))
      : rows;
    return sortRows(hit, sortBy);
  });

  onMount(async () => {
    try {
      const [cards, reviews, ix, mine] = await Promise.all([
        allCards(),
        allReviews(),
        index(),
        activeUserWords(),
      ]);
      const words = new Map<WordKey, CatalogueEntry | StudyWord>(ix.map((w) => [w.k, w]));
      for (const m of mine) if (!words.has(m.k)) words.set(m.k, toStudyWord(m));
      rows = summarise({ cards, reviews, wordOf: (k) => words.get(k) });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  });

  /** A 0..1 proportion as a whole percentage, or an em dash where there was
   *  nothing to measure. */
  const pct = (x: number | null): string => (x === null ? '—' : `${Math.round(x * 100)}%`);
  /** A span in days, said in the unit that reads best at that size: years past
   *  a year, whole days past one, "<1 d" for anything shorter, an em dash for
   *  nothing at all. */
  const days = (d: number): string =>
    d >= 365
      ? `${(d / 365).toFixed(1)} y`
      : d >= 1
        ? `${Math.round(d)} d`
        : d > 0
          ? '<1 d'
          : '—';
  /** How long ago a moment in milliseconds was, in words. 0 — never answered —
   *  reads as "never" rather than as fifty-six years. */
  const ago = (ms: number): string => {
    if (!ms) return 'never';
    const d = (Date.now() - ms) / 86400000;
    return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.round(d)} d ago`;
  };
</script>

{#if loading}
  <p class="muted">Reading your cards…</p>
{:else if error}
  <p class="error">{error}</p>
{:else if !rows.length}
  <section class="panel centre">
    <p class="muted">Nothing met yet. Study a few words and they show up here.</p>
    <button class="primary" onclick={() => goto(`${base}/study/`)}>Study</button>
  </section>
{:else}
  <p class="tally">
    <span><b>{rows.length}</b> met</span>
    <span class="known"><b>{counts.known}</b> known</span>
    <span><b>{counts.review}</b> in review</span>
    <span><b>{counts.learning}</b> learning</span>
    <span><b>{counts.new}</b> new</span>
  </p>

  <div class="controls">
    <input type="search" bind:value={query} placeholder="filter…" autocapitalize="none" />
    <select bind:value={sortBy} aria-label="Sort">
      {#each Object.entries(SORTS) as [k, label]}<option value={k}>{label}</option>{/each}
    </select>
  </div>

  <ul class="list">
    {#each shown as r (r.key)}
      {@const read = r.channels.written}
      <li class:open={open === r.key}>
        <button
          class="row"
          onclick={() => (open = open === r.key ? null : r.key)}
          aria-expanded={open === r.key}
        >
          <span class="word">
            <b><Fr text={r.fr} gender={r.gender} /></b> <span class="muted">{r.en}</span>
            {#if r.user}<span class="tag">yours</span>{:else}<span class="tag">L{r.lvl}</span
              >{/if}
          </span>
          <span class="bar" title="memory stability {days(r.strength)}">
            <span
              class="fill"
              class:known={r.label === 'known'}
              style:width="{100 * strengthBar(r.strength)}%"
            ></span>
          </span>
          <span class="metrics">
            <span
              class="label"
              class:known={r.label === 'known'}
              class:weak={r.label === 'relearning' || r.lapses >= 2}>{r.label}</span
            >
            <span>{days(r.strength)}</span>
            <span>{pct(read?.accuracy ?? null)}</span>
            <span>{r.lapses ? `${r.lapses}×` : ''}</span>
            <span class="dirs">
              {#each r.open as ch}
                <span
                  class="dir"
                  class:mature={r.channels[ch].mature}
                  class:fresh={r.channels[ch].reps === 0}
                  title="{CHANNEL_LABEL[ch]}: {RUNG_LABEL[r.channels[ch].rung]}"
                  >{SHORT[r.channels[ch].rung]}</span
                >
              {/each}
            </span>
          </span>
        </button>

        {#if open === r.key}
          <table class="detail">
            <thead>
              <tr
                ><th>rung</th><th>state</th><th>stability</th><th>difficulty</th>
                <th>right</th><th>reps</th><th>lapses</th><th>next</th></tr
              >
            </thead>
            <tbody>
              {#each r.open as ch}
                {@const x = r.channels[ch]}
                <tr>
                  <td>{RUNG_LABEL[x.rung]}</td>
                  <td>{stateLabel(x)}{x.leech ? ' · leech' : ''}</td>
                  <td>{days(x.stability)}</td>
                  <td
                    >{x.difficulty ? x.difficulty.toFixed(1) : '—'}<span class="muted">/10</span
                    ></td
                  >
                  <td>{pct(x.accuracy)} <span class="muted">of {x.answers}</span></td>
                  <td>{x.reps}</td>
                  <td>{x.lapses}</td>
                  <td>{dueText(x.dueIn)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="muted tiny">
            Last seen {ago(r.lastReview)}. Stability is how long the memory is expected to last
            before recall drops to 90%; a word counts as known from 21 days.
          </p>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="muted tiny legend">
    columns: state · stability · right answers · times forgotten · the rung each channel is on (<span
      class="dir mature">solid</span
    >
    known, <span class="dir">outlined</span> in progress)
  </p>
{/if}

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px;
  }
  .centre {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
  }
  .tally {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    font-size: 13px;
    color: var(--muted);
    margin: 0 0 10px;
  }
  .tally b {
    color: var(--ink);
  }
  .tally .known b {
    color: var(--good);
  }
  .controls {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }
  input,
  select {
    font: inherit;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
  }
  input {
    flex: 1;
    min-width: 0;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
  }
  li {
    border-top: 1px solid var(--line);
  }
  li:first-child {
    border-top: none;
  }
  li.open {
    background: var(--bg);
  }
  .row {
    display: grid !important;
    grid-template-columns: 1fr;
    gap: 4px;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border: none;
    background: none;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .word {
    display: flex;
    gap: 6px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .tag {
    font-size: 11px;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 6px;
  }
  .bar {
    display: block;
    height: 5px;
    background: var(--line);
    border-radius: 3px;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .fill.known {
    background: var(--good);
  }
  .metrics {
    display: grid;
    grid-template-columns: 5.5em 3.5em 3em 2.5em 1fr;
    gap: 6px;
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    align-items: center;
  }
  .label.known {
    color: var(--good);
  }
  .label.weak {
    color: var(--bad);
  }
  .dirs {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .dir {
    font-size: 10.5px;
    padding: 0 5px;
    border-radius: 999px;
    border: 1px solid var(--accent);
    color: var(--accent);
    line-height: 16px;
  }
  .dir.mature {
    background: var(--good);
    border-color: var(--good);
    color: var(--on-good);
  }
  .dir.fresh {
    border-style: dashed;
    opacity: 0.7;
  }
  .detail {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
    margin: 0 0 4px;
  }
  .detail th {
    text-align: left;
    font-weight: 500;
    color: var(--muted);
    padding: 2px 6px;
  }
  .detail td {
    padding: 3px 6px;
    border-top: 1px solid var(--line);
    white-space: nowrap;
  }
  .detail {
    display: block;
    overflow-x: auto;
    padding: 0 8px;
  }
  .muted {
    color: var(--muted);
  }
  .tiny {
    font-size: 12px;
  }
  li .tiny {
    margin: 4px 12px 10px;
  }
  .legend {
    margin-top: 10px;
  }
  .error {
    color: var(--bad);
  }
  button.primary {
    font: inherit;
    font-weight: 600;
    color: var(--on-accent);
    background: var(--accent);
    border: none;
    border-radius: 10px;
    padding: 10px 18px;
    cursor: pointer;
  }
</style>
