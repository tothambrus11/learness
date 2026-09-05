<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { index } from '$lib/catalogue.js';
  import { allCards, allReviews } from '$lib/db.js';
  import { activeUserWords, toStudyWord } from '$lib/words.js';
  import {
    SHORT, SORTS, dueText, sortRows, stateLabel, strengthBar, summarise, tally,
  } from '$lib/cardsview.js';
  import { CHANNEL_LABEL, RUNG_LABEL } from '$lib/keys.js';
  import Fr from '$lib/components/Fr.svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';

  let loading = $state(true);
  let error = $state('');
  let rows = $state([]);
  let sortBy = $state('weakest');
  let query = $state('');
  let open = $state(null);          /* key of the expanded row */

  let counts = $derived(tally(rows));
  let shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const hit = q ? rows.filter((r) => r.fr.toLowerCase().includes(q) || r.en.toLowerCase().includes(q)) : rows;
    return sortRows(hit, sortBy);
  });

  onMount(async () => {
    try {
      const [cards, reviews, ix, mine] = await Promise.all([
        allCards(), allReviews(), index(), activeUserWords(),
      ]);
      const words = new Map(ix.map((w) => [w.k, w]));
      for (const m of mine) if (!words.has(m.k)) words.set(m.k, toStudyWord(m));
      rows = summarise({ cards, reviews, wordOf: (k) => words.get(k) });
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  });

  const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const days = (d) => (d >= 365 ? `${(d / 365).toFixed(1)} y` : d >= 1 ? `${Math.round(d)} d` : d > 0 ? '<1 d' : '—');
  const ago = (ms) => {
    if (!ms) return 'never';
    const d = (Date.now() - ms) / 86400000;
    return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.round(d)} d ago`;
  };
</script>

<header>
  <button class="link" onclick={() => goto(`${base}/`)}><ArrowLeft size={14} /> Home</button>
  <h1>Your cards</h1>
</header>

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
        <button class="row" onclick={() => (open = open === r.key ? null : r.key)}
                aria-expanded={open === r.key}>
          <span class="word">
            <b><Fr text={r.fr} gender={r.gender} /></b> <span class="muted">{r.en}</span>
            {#if r.user}<span class="tag">yours</span>{:else}<span class="tag">L{r.lvl}</span>{/if}
          </span>
          <span class="bar" title="memory stability {days(r.strength)}">
            <span class="fill" class:known={r.label === 'known'} style:width="{100 * strengthBar(r.strength)}%"></span>
          </span>
          <span class="metrics">
            <span class="label" class:known={r.label === 'known'} class:weak={r.label === 'relearning' || r.lapses >= 2}>{r.label}</span>
            <span>{days(r.strength)}</span>
            <span>{pct(read?.accuracy ?? null)}</span>
            <span>{r.lapses ? `${r.lapses}×` : ''}</span>
            <span class="dirs">
              {#each r.open as ch}
                <span class="dir" class:mature={r.channels[ch].mature}
                      class:fresh={r.channels[ch].reps === 0}
                      title="{CHANNEL_LABEL[ch]}: {RUNG_LABEL[r.channels[ch].rung]}">{SHORT[r.channels[ch].rung]}</span>
              {/each}
            </span>
          </span>
        </button>

        {#if open === r.key}
          <table class="detail">
            <thead>
              <tr><th>rung</th><th>state</th><th>stability</th><th>difficulty</th>
                  <th>right</th><th>reps</th><th>lapses</th><th>next</th></tr>
            </thead>
            <tbody>
              {#each r.open as ch}
                {@const x = r.channels[ch]}
                <tr>
                  <td>{RUNG_LABEL[x.rung]}</td>
                  <td>{stateLabel(x)}{x.leech ? ' · leech' : ''}</td>
                  <td>{days(x.stability)}</td>
                  <td>{x.difficulty ? x.difficulty.toFixed(1) : '—'}<span class="muted">/10</span></td>
                  <td>{pct(x.accuracy)} <span class="muted">of {x.answers}</span></td>
                  <td>{x.reps}</td>
                  <td>{x.lapses}</td>
                  <td>{dueText(x.dueIn)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="muted tiny">
            Last seen {ago(r.lastReview)}. Stability is how long the memory is expected to
            last before recall drops to 90%; a word counts as known from 21 days.
          </p>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="muted tiny legend">
    columns: state · stability · right answers · times forgotten · the rung each channel is on
    (<span class="dir mature">solid</span> known, <span class="dir">outlined</span> in progress)
  </p>
{/if}

<style>
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  h1 { font-size: 20px; margin: 0; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px; }
  .centre { text-align: center; display: flex; flex-direction: column; gap: 12px; align-items: center; }
  .tally { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--muted);
           margin: 0 0 10px; }
  .tally b { color: var(--ink); }
  .tally .known b { color: var(--good); }
  .controls { display: flex; gap: 8px; margin-bottom: 10px; }
  input, select { font: inherit; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line);
                  background: var(--panel); color: var(--ink); }
  input { flex: 1; min-width: 0; }
  .list { list-style: none; margin: 0; padding: 0; background: var(--panel);
          border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  li { border-top: 1px solid var(--line); }
  li:first-child { border-top: none; }
  li.open { background: var(--bg); }
  .row { display: grid !important; grid-template-columns: 1fr; gap: 4px; width: 100%; text-align: left;
         padding: 10px 12px; border: none; background: none; color: var(--ink); font: inherit;
         cursor: pointer; }
  .word { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .tag { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px;
         padding: 0 6px; }
  .bar { display: block; height: 5px; background: var(--line); border-radius: 3px; overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--accent); }
  .fill.known { background: var(--good); }
  .metrics { display: grid; grid-template-columns: 5.5em 3.5em 3em 2.5em 1fr; gap: 6px;
             font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums;
             align-items: center; }
  .label.known { color: var(--good); }
  .label.weak { color: var(--bad); }
  .dirs { display: flex; gap: 4px; justify-content: flex-end; flex-wrap: wrap; }
  .dir { font-size: 10.5px; padding: 0 5px; border-radius: 999px; border: 1px solid var(--accent);
         color: var(--accent); line-height: 16px; }
  .dir.mature { background: var(--good); border-color: var(--good); color: #fff; }
  .dir.fresh { border-style: dashed; opacity: .7; }
  .detail { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 0 0 4px; }
  .detail th { text-align: left; font-weight: 500; color: var(--muted); padding: 2px 6px; }
  .detail td { padding: 3px 6px; border-top: 1px solid var(--line); white-space: nowrap; }
  .detail { display: block; overflow-x: auto; padding: 0 8px; }
  .muted { color: var(--muted); }
  .tiny { font-size: 12px; }
  li .tiny { margin: 4px 12px 10px; }
  .legend { margin-top: 10px; }
  .error { color: var(--bad); }
  button.primary { font: inherit; font-weight: 600; color: #fff; background: var(--accent);
                   border: none; border-radius: 10px; padding: 10px 18px; cursor: pointer; }
  button.link { border: none; background: none; color: var(--muted); padding: 4px 0;
                font-weight: 400; font-size: 13px; cursor: pointer; font-family: inherit; }
</style>
