<script>
  /** Today, read back out of the review log.
   *
   *  The home screen answers "what should I do now"; this answers "what did I
   *  do". They want different shapes: one number to be proud of, then the
   *  detail that makes it real — when you sat down, what you got wrong, which
   *  words you met for the first time.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { index } from '$lib/catalogue.js';
  import { allCards, allReviews, getSettings } from '$lib/db.js';
  import { activeUserWords, toStudyWord } from '$lib/words.js';
  import { exerciseLabel } from '$lib/keys.js';
  import { isDue, retention } from '$lib/scheduler.js';
  import { sitting } from '$lib/session.js';
  import {
    RATING_KEYS, RATING_LABEL, clockTime, comparison, dailyCounts, dayContract, humanMinutes,
    streak, summariseDay,
  } from '$lib/progress.js';
  import Fr from '$lib/components/Fr.svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import Flame from '@lucide/svelte/icons/flame';

  let loading = $state(true);
  let error = $state('');
  let reviews = $state([]);
  let cards = $state([]);
  let settings = $state(null);
  let words = $state(new Map());

  const WEEK = 7 * 86400 * 1000;

  let day = $derived(summariseDay({ reviews }));
  let history = $derived(dailyCounts(reviews, { days: 14 }));
  let run = $derived(streak(reviews));
  let versus = $derived(comparison(history));
  /* The finish line: what was due, capped at what you are happy to do, and the
     new words there was room for. Not a clock, not a quota. */
  let dueRemaining = $derived(sitting(cards).filter((c) => isDue(c)).length);
  let retention7d = $derived(retention(reviews.filter((r) => r.ts * 1000 >= Date.now() - WEEK)));
  let contract = $derived(dayContract({
    dueRemaining, reviewedToday: day.dueAnswered, metToday: day.met.length, retention7d, settings,
  }));
  const share = (part) => (part.target ? Math.min(100, (part.done / part.target) * 100) : 100);
  let busiest = $derived(Math.max(1, ...history.map((d) => d.reviews)));
  let peakHour = $derived(Math.max(1, ...day.hourly));
  /* Empty pre-dawn and small-hours columns are noise; show the span that has
     something in it, always including the working day. */
  let firstHour = $derived(Math.min(6, ...day.hourly.flatMap((n, h) => (n ? [h] : []))));
  let lastHour = $derived(Math.max(22, ...day.hourly.flatMap((n, h) => (n ? [h] : []))));
  let hours = $derived(
    Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i));
  let metWords = $derived(day.met.map((k) => words.get(k) ?? { k, fr: k.split('|')[0] }));

  const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
  const dayName = (ms) => new Date(ms).toLocaleDateString([], { weekday: 'narrow' });
  const today = new Date().toLocaleDateString([], {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  onMount(async () => {
    try {
      const [r, c, s, ix, mine] = await Promise.all([
        allReviews(), allCards(), getSettings(), index().catch(() => []),
        activeUserWords().catch(() => []),
      ]);
      reviews = r;
      cards = c;
      settings = s;
      const map = new Map(ix.map((w) => [w.k, w]));
      for (const m of mine) if (!map.has(m.k)) map.set(m.k, toStudyWord(m));
      words = map;
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  });
</script>

<header>
  <button class="link" onclick={() => goto(`${base}/`)}><ArrowLeft size={14} /> Home</button>
  <h1>Today</h1>
  <p class="muted small date">{today}</p>
</header>

{#if loading}
  <p class="muted">Reading your review log…</p>
{:else if error}
  <p class="error">{error}</p>
{:else if day.reviews === 0}
  <!-- A day not studied yet is still worth opening: what is owed and the
       run-up behind it are the reason to start, so both stay on screen. -->
  {@render finishLine()}
  <section class="panel empty">
    <p class="big">Nothing yet today</p>
    <p class="muted">
      {#if run > 0}
        You have studied {run} day{run === 1 ? '' : 's'} in a row. Keep it going.
      {:else if reviews.length}
        Your last session was
        {new Date(Math.max(...reviews.map((r) => r.ts * 1000))).toLocaleDateString()}.
      {:else}
        Once you answer your first card, this page fills in.
      {/if}
    </p>
  </section>
  {@render fortnight()}
{:else}
  <section class="panel headline">
    <div>
      <div class="big">{day.reviews}</div>
      <div class="muted">card{day.reviews === 1 ? '' : 's'} answered today</div>
    </div>
    <div class="side">
      {#if day.firstAt !== null}
        <b>{clockTime(day.firstAt)}–{clockTime(day.lastAt)}</b><br />
      {/if}
      <span class="muted small">{humanMinutes(day.minutes)} answering</span>
      {#if versus && versus.ratio !== null}
        <br /><span class="muted small">
          {versus.ratio >= 1.05 ? `${(versus.ratio).toFixed(1)}× your usual day`
            : versus.ratio <= 0.95 ? `${Math.round(versus.ratio * 100)}% of a usual day`
              : 'about a usual day'}
        </span>
      {/if}
    </div>
  </section>

  {@render finishLine()}

  <section class="row">
    <div class="stat"><b>{pct(day.accuracy)}</b><span>recalled</span></div>
    <div class="stat"><b>{day.met.length}</b><span>new word{day.met.length === 1 ? '' : 's'}</span></div>
    {#if day.promoted !== null}
      <div class="stat"><b>{day.promoted}</b><span>moved up</span></div>
    {:else if day.learned !== null}
      <div class="stat"><b>{day.learned}</b><span>now known</span></div>
    {:else}
      <div class="stat"><b>{run}</b><span>day streak</span></div>
    {/if}
  </section>

  <section class="panel">
    <h2>How it went</h2>
    <div class="mix">
      {#each RATING_KEYS as k}
        {#if day.counts[k]}
          <div class="seg {k}" style="flex:{day.counts[k]}"
               title="{RATING_LABEL[k]}: {day.counts[k]}"></div>
        {/if}
      {/each}
    </div>
    <ul class="legend">
      {#each RATING_KEYS as k}
        <li><i class="dot {k}"></i>{RATING_LABEL[k]} <b>{day.counts[k]}</b></li>
      {/each}
    </ul>
    {#if day.accuracy !== null}
      <p class="muted small">
        {pct(day.accuracy)} of the {day.recalled} card{day.recalled === 1 ? '' : 's'}
        that tested a memory came back. First meetings are not counted.
      </p>
    {/if}
  </section>

  <section class="panel">
    <h2>When you studied</h2>
    <div class="hours">
      {#each hours as h}
        <div class="hour" title="{h}:00 — {day.hourly[h]} card{day.hourly[h] === 1 ? '' : 's'}">
          <div class="bar" style="height:{(day.hourly[h] / peakHour) * 100}%"
               class:none={!day.hourly[h]}></div>
          <span class="tick">{h % 6 === 0 ? h : ''}</span>
        </div>
      {/each}
    </div>
  </section>

  {#if day.byDirection.length}
    <section class="panel">
      <h2>By exercise</h2>
      {#each day.byDirection as d}
        <div class="dir">
          <span class="name">{exerciseLabel(d.direction)}</span>
          <span class="track small-track">
            <span class="fill" style="width:{(d.reviews / day.reviews) * 100}%"></span>
          </span>
          <span class="num">{d.reviews}</span>
          <span class="num muted">{d.recalled ? pct(d.right / d.recalled) : '—'}</span>
        </div>
      {/each}
    </section>
  {/if}

  {#if metWords.length}
    <section class="panel">
      <h2>Met for the first time</h2>
      <ul class="chips">
        {#each metWords as w}
          <li><Fr text={w.fr} gender={w.gender ?? ''} /></li>
        {/each}
      </ul>
    </section>
  {/if}

  {@render fortnight()}
{/if}

{#snippet finishLine()}
  {#if contract}
    <section class="panel contract" class:complete={contract.complete}>
      {#if contract.complete}
        <p class="done-title">Done for today</p>
        <p class="muted small">
          Everything that was due is cleared and the day's new words are in.
          Anything more belongs to tomorrow.
        </p>
      {:else}
        <h2>Left today</h2>
      {/if}
      <div class="bar-row" title="cards that were due when the day began, capped at what you are happy to do">
        <span class="label">Due cards</span>
        <span class="track"><span class="fill" style="width:{share(contract.debt)}%"></span></span>
        <span class="num">{contract.debt.done}<span class="muted">/{contract.debt.target}</span></span>
      </div>
      <div class="bar-row" title="new words there was room for today, given what was due and how recall has been going">
        <span class="label">New words</span>
        <span class="track"><span class="fill gain" style="width:{share(contract.gain)}%"></span></span>
        <span class="num">
          {#if contract.gain.target === 0}<span class="muted">none today</span>
          {:else}{contract.gain.done}<span class="muted">/{contract.gain.target}</span>{/if}
        </span>
      </div>
      {#if !contract.complete}
        <button class="study" onclick={() => goto(`${base}/study/`)}>
          <BookOpen size={18} /> {day.reviews ? 'Continue' : 'Start studying'}
        </button>
      {/if}
    </section>
  {/if}
{/snippet}

{#snippet fortnight()}
  {#if reviews.length}
    <section class="panel">
      <h2>The last two weeks</h2>
      <div class="days">
        {#each history as d, i}
          <div class="day" title="{new Date(d.date).toLocaleDateString()} — {d.reviews} cards">
            <div class="bar" class:today={i === history.length - 1}
                 class:none={!d.reviews}
                 style="height:{(d.reviews / busiest) * 100}%"></div>
            <span class="tick">{dayName(d.date)}</span>
          </div>
        {/each}
      </div>
      {#if run > 0}
        <p class="muted small"><Flame size={13} /> {run} day{run === 1 ? '' : 's'} in a row</p>
      {/if}
    </section>
  {/if}
{/snippet}

<style>
  header { margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 8px 0 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
       color: var(--muted); margin: 0 0 10px; }
  .date { margin: 0; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
           padding: 16px; margin-bottom: 12px; }
  .big { font-size: 44px; font-weight: 700; letter-spacing: -.03em; line-height: 1; margin: 0; }
  .headline { display: flex; justify-content: space-between; align-items: flex-end;
              gap: 12px; flex-wrap: wrap; }
  .side { text-align: right; font-size: 14px; line-height: 1.45; }
  .empty { text-align: center; }
  .empty .big { font-size: 26px; margin-bottom: 6px; }
  .empty p { margin: 0 0 14px; }

  .contract.complete { border-color: var(--good); }
  .done-title { font-size: 22px; font-weight: 700; margin: 0 0 2px; color: var(--good); }
  .contract .small { margin-bottom: 12px; }
  .bar-row { display: flex; align-items: center; gap: 12px; padding: 5px 0; font-size: 14px; }
  .bar-row .label { flex: 0 0 84px; }
  .bar-row .num { flex: 0 0 84px; text-align: right; font-variant-numeric: tabular-nums;
                  font-weight: 600; white-space: nowrap; }
  .track { display: block; flex: 1; height: 8px; border-radius: 99px; background: var(--line);
           overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--accent); border-radius: 99px;
          transition: width .3s; }
  .fill.gain { background: var(--good); }
  .contract .study { margin-top: 12px; width: 100%; display: flex; }

  .row { display: flex; gap: 10px; margin-bottom: 12px; }
  .stat { flex: 1; text-align: center; background: var(--panel);
          border: 1px solid var(--line); border-radius: 12px; padding: 10px 6px; }
  .stat b { display: block; font-size: 21px; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 12px; color: var(--muted); }

  .mix { display: flex; height: 14px; border-radius: 99px; overflow: hidden; gap: 2px; }
  .seg { min-width: 3px; }
  .again, .dot.again { background: var(--bad); }
  .hard, .dot.hard { background: var(--warn); }
  .good, .dot.good { background: var(--accent); }
  .easy, .dot.easy { background: var(--good); }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; list-style: none;
            padding: 0; margin: 10px 0 0; font-size: 13px; }
  .legend li { display: flex; align-items: center; gap: 6px; }
  .legend b { font-variant-numeric: tabular-nums; }
  .dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }

  .hours, .days { display: flex; align-items: flex-end; gap: 3px; height: 92px; }
  .hour, .day { flex: 1; display: flex; flex-direction: column; align-items: center;
                justify-content: flex-end; height: 100%; }
  .hour .bar, .day .bar { width: 100%; min-height: 2px; background: var(--accent);
                          border-radius: 3px 3px 0 0; }
  .bar.none { background: var(--line); }
  .day .bar.today { background: var(--good); }
  .tick { font-size: 10px; color: var(--muted); height: 12px; line-height: 12px;
          font-variant-numeric: tabular-nums; }

  .dir { display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 4px 0; }
  .dir .name { flex: 0 0 42%; }
  .small-track { flex: 1; }
  .dir .num { flex: 0 0 40px; text-align: right; font-variant-numeric: tabular-nums; }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 0; }
  .chips li { border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px;
              font-size: 14px; background: var(--bg); }

  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  .error { color: var(--bad); font-size: 13px; background: var(--panel);
           border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  button.link { background: none; border: none; color: var(--accent); font: inherit;
                font-size: 13px; padding: 0; cursor: pointer; }
  button.study { font: inherit; font-weight: 600; color: #fff; background: var(--accent);
                 border: none; border-radius: 12px; padding: 12px 20px; cursor: pointer; }
</style>
