<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { index, meta } from '$lib/catalogue';
  import Levels from '$lib/components/Levels.svelte';
  import SignIn from '$lib/components/SignIn.svelte';
  import { coverageOf, percent } from '$lib/coverage';
  import { DEFAULT_SETTINGS, allCards, getSettings, reviewsSince } from '$lib/db';
  import { dayStart, metToday } from '$lib/progress';
  import { onInstallable, promptInstall } from '$lib/pwa';
  import { newAllowance, allowanceReason, retention } from '$lib/scheduler';
  import { savedSitting, sitting } from '$lib/session';
  import { installAutoSync, syncConfig } from '$lib/sync';
  import type {
    Card,
    CatalogueEntry,
    CatalogueMeta,
    Review,
    Settings,
    SittingSnapshot,
  } from '$lib/types';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import BookPlus from '@lucide/svelte/icons/book-plus';
  import CalendarCheck from '@lucide/svelte/icons/calendar-check';
  import List from '@lucide/svelte/icons/list';
  import Play from '@lucide/svelte/icons/play';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import { onMount } from 'svelte';

  /* The page starts before `syncConfig()` has answered and falls back to a bare
     object when it fails, and the screen only ever asks whether there is a
     token, so a half-filled record is enough. */
  /** As much of the sync configuration as this screen holds; everything but the
   *  API may be absent. */
  interface SyncInfo {
    /** Where the API is; `''` before it is known. */
    api: string;
    /** This device's bearer token. Empty or absent means not signed in. */
    token?: string;
    /** The server sequence this device has everything up to. */
    cursor?: number;
    /** Milliseconds at the last successful sync; 0 for never. */
    syncedAt: number;
    /** The account's email, where one has been read. */
    email?: string;
  }

  /** True once the first load has settled, however it settled. Nothing but the
   *  spinner is on screen until then. */
  let ready = $state(false);
  /** True while the browser is offering to install the app. */
  let installable = $state(false);
  /** What went wrong during boot, shown above everything else; `''` for a
   *  clean start. */
  let bootError = $state('');
  /** True once the first load has taken long enough to be worth explaining. */
  let slow = $state(false);
  /** The catalogue's header, or null when there is no catalogue yet — which is
   *  normal before `frcog app` has been run. */
  let catalogue = $state<CatalogueMeta | null>(null);
  /** The shipped index, in ranked order; empty when it could not be fetched. */
  let idx = $state<CatalogueEntry[]>([]);
  /** The settings as stored, or null until they have been read. */
  let settings = $state<Settings | null>(null);
  /** Every card on the device, retired ones included. */
  let cards = $state<Card[]>([]);
  /** The last week of the review log, which is all the headline sums need. */
  let recent = $state<Review[]>([]);
  /** What this device knows about syncing, as far as it has been read. */
  let syncInfo = $state<SyncInfo>({ api: '', syncedAt: 0 });
  /** Why an automatic sync failed; `''` when none has. */
  let syncNote = $state('');
  /** A sitting left half-done today, or null when there is none to carry on
   *  with. */
  let resume = $state<SittingSnapshot | null>(null);
  /** Whether there is a token, which is the whole of "signed in" here. */
  let signedIn = $derived(!!syncInfo.token);

  /** Seven days in milliseconds: how far back the recall figure looks. */
  const WEEK = 7 * 86400 * 1000;

  /** Cards that can be scheduled and whose due date has passed. */
  let due = $derived(sitting(cards).filter((c) => new Date(c.due) <= new Date()).length);
  /** Distinct words with a written card, which is what "met" means. */
  let met = $derived(
    new Set(cards.filter((c) => c.channel === 'written').map((c) => c.key)).size,
  );
  /** The headline sum: share of running French text, and the counts behind it. */
  let coverage = $derived(coverageOf(cards, idx));
  /** Words known well enough to read, out of `coverage`. */
  let known = $derived(coverage.known);
  /** Recall over the last week as 0..1, or null with nothing to measure. */
  let retention7d = $derived(retention(recent));
  /** Cards answered since local midnight. */
  let doneToday = $derived(recent.filter((r) => r.ts * 1000 >= dayStart()).length);
  /* The same sum the sitting makes. */
  /** How many new words there is room for today: what is left by the cards due,
   *  less the new words already met. 0 until the settings are known. */
  let allowance = $derived(
    settings
      ? newAllowance({
          dueCount: due,
          retention7d,
          settings,
          introducedToday: metToday(recent),
        })
      : 0,
  );
  /** Why the allowance came out as it did, in one sentence; `''` until the
   *  settings are known. */
  let reason = $derived(
    settings ? allowanceReason({ dueCount: due, retention7d, settings, allowance }) : '',
  );
  /** Cards still unanswered in a sitting left half-done, or 0 when there is
   *  none to carry on with. */
  let leftInSitting = $derived(resume ? resume.ids.length - resume.i : 0);

  /* Anything here failing used to leave the page on "Loading…" for ever with
     nothing said, which is how a missing sign-in button looked. Each piece is
     now allowed to fail on its own, and a real failure is shown. */
  onMount(() => {
    let stop = () => {};
    const stopInstall = onInstallable((v) => {
      installable = v;
    });
    const slowTimer = setTimeout(() => {
      slow = true;
    }, 6000);
    (async () => {
      try {
        const results = await Promise.allSettled([
          meta(),
          getSettings(),
          allCards(),
          reviewsSince(Date.now() - WEEK),
          syncConfig(),
          index(),
          savedSitting(),
        ]);
        const [m, s, c, r, sc, ix, sit] = results;
        catalogue = m.status === 'fulfilled' ? m.value : null;
        idx = ix.status === 'fulfilled' ? ix.value : [];
        settings = s.status === 'fulfilled' ? s.value : { ...DEFAULT_SETTINGS };
        cards = c.status === 'fulfilled' ? c.value : [];
        recent = r.status === 'fulfilled' ? r.value : [];
        syncInfo = sc.status === 'fulfilled' ? sc.value : { api: '', token: '', syncedAt: 0 };
        resume = sit.status === 'fulfilled' ? sit.value : null;

        const broken = results.find(
          (x): x is PromiseRejectedResult => x.status === 'rejected' && x !== m && x !== ix,
        ); /* a missing catalogue is normal before `frcog app` */
        if (broken) bootError = String(broken.reason?.message || broken.reason);
      } catch (err) {
        bootError = String((err as Error)?.message || err);
      } finally {
        clearTimeout(slowTimer);
        ready = true; /* always render something, even a failure */
      }

      /* Automatic when the policy allows, explicit otherwise. Retaken whenever
         you come back to the app or the connection changes — but never while
         a sitting is waiting to be carried on: a sync writes cards, and the
         sitting is about to. */
      try {
        stop = installAutoSync({
          isBusy: () => !!resume,
          onResult: async () => {
            syncNote = '';
            [cards, recent, syncInfo] = await Promise.all([
              allCards(),
              reviewsSince(Date.now() - WEEK),
              syncConfig(),
            ]);
          },
          onFailure: (res) => {
            syncNote = res.reason;
          },
        });
      } catch {
        /* sync being unavailable must not stop the app working */
      }
    })();
    return () => {
      stop();
      stopInstall();
      clearTimeout(slowTimer);
    };
  });
</script>

{#if !ready}
  <p class="muted">Loading…</p>
  {#if slow}
    <p class="muted small">
      This is taking longer than it should. The usual cause is the app being open in another tab
      or window on an older version — it holds the database, and this one is waiting for it.
      Close the other one, then reload here.
    </p>
  {/if}
{:else}
  {#if bootError}
    <p class="error">Something failed to start: {bootError}</p>
  {/if}
  <section class="panel headline">
    <div>
      <div class="big">{percent(coverage.share)}</div>
      <div class="muted">of French text you can read</div>
    </div>
    <div class="side">
      <b>{known}</b> <span class="muted">words you can read</span>
      <br /><b>{coverage.usable}</b> <span class="muted">you can use</span>
      {#if catalogue}
        <br /><span class="muted small"
          >{percent(catalogue.ceiling, 0)} when the catalogue is done</span
        >
      {/if}
    </div>
  </section>

  <button class="study" onclick={() => goto(`${base}/study/`)}>
    {#if leftInSitting}
      <Play size={18} /> Carry on: {leftInSitting} card{leftInSitting === 1 ? '' : 's'} left
    {:else}
      <BookOpen size={18} />
      {due > 0
        ? `Study ${due} due card${due === 1 ? '' : 's'}`
        : allowance > 0
          ? `Start ${allowance} new words`
          : 'Study'}
    {/if}
  </button>
  <button class="secondary" onclick={() => goto(`${base}/words/`)}
    ><BookPlus size={17} /> Add your own words</button
  >
  {#if syncNote}
    <p class="error">
      Automatic sync did not go through: {syncNote}. Progress is safe on this device; Settings
      has a Sync now button.
    </p>
  {/if}

  <section class="row">
    <div class="stat"><b>{due}</b><span>due now</span></div>
    <div class="stat"><b>{allowance}</b><span>new today</span></div>
    <div class="stat">
      <b>{retention7d === null ? '—' : Math.round(retention7d * 100) + '%'}</b>
      <span>recall this week</span>
    </div>
  </section>
  <p class="reason muted small">{reason}</p>
  <!-- Two places to go, as targets a thumb can hit. They were one sentence of
       13px links joined by middots, which on a phone wrapped mid-phrase and
       left nothing big enough to tap. -->
  <nav class="links">
    <a href="{base}/progress/">
      <CalendarCheck size={15} />
      {doneToday ? `Today: ${doneToday} done` : "Today's progress"}
    </a>
    {#if met > 0}
      <a href="{base}/cards/">
        <List size={15} />
        {met} word{met === 1 ? '' : 's'} met
      </a>
    {/if}
  </nav>

  {#if !signedIn}
    <SignIn
      onSignedIn={async () => {
        syncInfo = await syncConfig();
      }}
    />
  {/if}

  {#if idx.length && settings}
    <Levels
      levels={coverage.levels}
      {settings}
      onSettingsChanged={async () => {
        settings = await getSettings();
      }}
    />
  {/if}

  {#if installable}
    <section class="panel install">
      <div>
        <b>Install as an app</b>
        <p class="muted small">Works offline, opens from your home screen.</p>
      </div>
      <button onclick={promptInstall}><Smartphone size={15} /> Install</button>
    </section>
  {/if}

  {#if catalogue}
    <p class="muted small">
      Catalogue: {catalogue.words} words across {catalogue.levels.length} levels, reaching {(
        catalogue.ceiling * 100
      ).toFixed(1)}% of running French text.
    </p>
  {:else}
    <p class="muted small">No catalogue yet. Run <code>frcog app</code> to build it.</p>
  {/if}
{/if}

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px;
    margin-bottom: 12px;
  }
  .big {
    font-size: 44px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .headline {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }
  .side {
    text-align: right;
    font-size: 14px;
    line-height: 1.4;
  }
  .side b {
    font-size: 20px;
  }
  .row {
    display: flex;
    gap: 10px;
    margin-bottom: 8px;
  }
  .stat {
    flex: 1;
    text-align: center;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px 6px;
  }
  .stat b {
    display: block;
    font-size: 21px;
  }
  .stat span {
    font-size: 12px;
    color: var(--muted);
  }
  .install {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .install p {
    margin: 0;
  }
  .muted {
    color: var(--muted);
  }
  .reason {
    margin: 0 0 10px;
  }
  .links {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .links a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 auto;
    justify-content: center;
    min-height: 42px;
    padding: 8px 14px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    color: var(--accent);
    text-decoration: none;
    font-size: 14px;
    font-weight: 550;
  }
  .error {
    color: var(--bad);
    font-size: 13px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
  }
  .small {
    font-size: 13px;
  }
  button {
    font: inherit;
    font-weight: 600;
    color: var(--on-accent);
    background: var(--accent);
    border: none;
    border-radius: 10px;
    padding: 10px 18px;
    cursor: pointer;
  }
  button.study {
    display: flex;
    width: 100%;
    font-size: 17px;
    padding: 15px;
    margin-bottom: 12px;
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    border-radius: 14px;
    font-weight: 650;
  }
  button.secondary {
    display: flex;
    width: 100%;
    font-size: 16px;
    padding: 13px;
    margin-bottom: 12px;
    background: var(--panel);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 14px;
  }
</style>
