<script lang="ts">
  import { onMount } from 'svelte';
  import { index, meta } from '$lib/catalogue.js';
  import { coverageOf, percent } from '$lib/coverage.js';
  import Levels from '$lib/components/Levels.svelte';
  import { allCards, getSettings, reviewsSince } from '$lib/db.js';
  import { allowanceReason, isDue, newAllowance, retention } from '$lib/scheduler.js';
  import { dayStart, keysAnsweredBefore, metOn } from '$lib/progress.js';
  import { savedSitting, sitting } from '$lib/session.js';
  import { installAutoSync, syncConfig } from '$lib/sync.js';
  import { DEFAULT_SETTINGS } from '$lib/db.js';
  import SignIn from '$lib/components/SignIn.svelte';
  import { report } from '$lib/diagnostics.js';
  import { onInstallable, promptInstall } from '$lib/pwa.js';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import BookPlus from '@lucide/svelte/icons/book-plus';
  import CalendarCheck from '@lucide/svelte/icons/calendar-check';
  import List from '@lucide/svelte/icons/list';
  import Play from '@lucide/svelte/icons/play';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import type { CatalogueMeta } from '$lib/catalogue.js';
  import type { IndexEntry, Settings, StoredCard, Review } from '$lib/model.js';
  import type { SavedSitting } from '$lib/queue.js';
  import type { SyncConfig } from '$lib/sync.js';
  import { agoMs, WEEK_MS } from '$lib/units.js';

  let ready = $state(false);
  let installable = $state(false);
  let bootError = $state('');
  let slow = $state(false);          /* still loading after a while: say why it might be */
  let catalogue = $state<CatalogueMeta | null>(null);
  let idx = $state<IndexEntry[]>([]);
  let settings = $state<Settings | null>(null);
  let cards = $state<StoredCard[]>([]);
  let recent = $state<Review[]>([]);
  let syncInfo = $state<SyncConfig>(
    { api: '', token: '', cursor: 0, syncedAt: 0 as SyncConfig['syncedAt'], email: '' });
  let resume = $state<SavedSitting | null>(null);   /* a sitting left half-done today */
  let signedIn = $derived(!!syncInfo.token);

  let due = $derived(sitting(cards).filter((c) => isDue(c)).length);
  let met = $derived(new Set(cards.filter((c) => c.channel === 'written').map((c) => c.key)).size);
  let coverage = $derived(coverageOf(cards, idx));
  let known = $derived(coverage.known);
  let retention7d = $derived(retention(recent));
  let doneToday = $derived(recent.filter((r) => r.ts * 1000 >= dayStart()).length);
  /* New words already met today. The allowance is what is left of the day's
     ceiling, not the whole of it: a number that never moved as you studied was
     the app saying "20 new today" every time you came back to this screen, and
     dealing another 20 every time you started a sitting.

     `seenBefore` comes from the cards rather than from this week of the log,
     so a rung opened today on a word known for months is not counted as a word
     met today — see progress.ts. */
  let metToday = $derived(
    metOn(recent, { seenBefore: keysAnsweredBefore(cards, dayStart()) }).length);
  let allowance = $derived(settings
    ? newAllowance({ dueCount: due, retention7d, settings, introducedToday: metToday }) : 0);
  let reason = $derived(settings
    ? allowanceReason({ dueCount: due, retention7d, settings, allowance,
      introducedToday: metToday }) : '');
  let leftInSitting = $derived(resume ? resume.ids.length - resume.i : 0);

  /* Anything here failing used to leave the page on "Loading…" for ever with
     nothing said, which is how a missing sign-in button looked. Each piece is
     now allowed to fail on its own, and a real failure is shown. */
  onMount(() => {
    let stop = () => {};
    const stopInstall = onInstallable((v) => { installable = v; });
    const slowTimer = setTimeout(() => { slow = true; }, 6000);
    (async () => {
      try {
        const results = await Promise.allSettled([
          meta(), getSettings(), allCards(), reviewsSince(agoMs(WEEK_MS)), syncConfig(),
          index(), savedSitting(),
        ] as const);
        const [m, s, c, r, sc, ix, sit] = results;
        catalogue = m.status === 'fulfilled' ? m.value : null;
        idx = ix.status === 'fulfilled' ? ix.value : [];
        settings = s.status === 'fulfilled' ? s.value : { ...DEFAULT_SETTINGS };
        cards = c.status === 'fulfilled' ? c.value : [];
        recent = r.status === 'fulfilled' ? r.value : [];
        syncInfo = sc.status === 'fulfilled' ? sc.value
          : { api: '', token: '', cursor: 0, syncedAt: 0 as SyncConfig['syncedAt'], email: '' };
        resume = sit.status === 'fulfilled' ? sit.value : null;

        /* A missing catalogue is normal before `frcog app` has ever run, so
           those two are allowed to fail quietly; anything else is said. */
        const broken = results.find((x) => x.status === 'rejected' && x !== m && x !== ix);
        if (broken?.status === 'rejected') {
          const why = broken.reason as Error | undefined;
          bootError = String(why?.message || why);
          report('start', bootError);
        }
      } catch (err) {
        bootError = String((err as Error)?.message || err);
      } finally {
        clearTimeout(slowTimer);
        ready = true;      /* always render something, even a failure */
      }

      /* Automatic on wifi, explicit otherwise. Retaken whenever you come back
         to the app or the connection changes. */
      try {
        stop = installAutoSync({
          /* Whatever came in changes every number on this screen, so all three
             sources are re-read — the reviews included, or the day's new-word
             count would still be this device's own. */
          onResult: async (): Promise<void> => {
            [cards, recent, syncInfo] = await Promise.all([
              allCards(), reviewsSince(agoMs(WEEK_MS)), syncConfig(),
            ]);
          },
        });
      } catch { /* sync being unavailable must not stop the app working */ }
    })();
    return () => { stop(); stopInstall(); clearTimeout(slowTimer); };
  });
</script>

{#if !ready}
  <p class="muted">Loading…</p>
  {#if slow}
    <p class="muted small">
      This is taking longer than it should. The usual cause is the app being
      open in another tab or window on an older version — it holds the
      database, and this one is waiting for it. Close the other one, then
      reload here.
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
        <br /><span class="muted small">{percent(catalogue.ceiling, 0)} when the catalogue is done</span>
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
        : allowance > 0 ? `Start ${allowance} new words` : 'Study'}
    {/if}
  </button>
  <button class="second" onclick={() => goto(`${base}/words/`)}><BookPlus size={17} /> Add your own words</button>

  <section class="row">
    <div class="stat"><b>{due}</b><span>due now</span></div>
    <div class="stat"><b>{allowance}</b><span>new left today</span></div>
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
        <List size={15} /> {met} word{met === 1 ? '' : 's'} met
      </a>
    {/if}
  </nav>

  {#if !signedIn}
    <SignIn onSignedIn={async () => { syncInfo = await syncConfig(); }} />
  {/if}

  {#if idx.length && settings}
    <Levels levels={coverage.levels} {settings}
            onSettingsChanged={async () => { settings = await getSettings(); }} />
  {/if}

  {#if installable}
    <section class="panel install">
      <div>
        <b>Install as an app</b>
        <p class="muted small">Works offline, opens from your home screen.</p>
      </div>
      <button class="primary" onclick={promptInstall}><Smartphone size={15} /> Install</button>
    </section>
  {/if}

  {#if catalogue}
    <p class="muted small">
      Catalogue: {catalogue.words} words across {catalogue.levels.length} levels,
      reaching {(catalogue.ceiling * 100).toFixed(1)}% of running French text.
    </p>
  {:else}
    <p class="muted small">No catalogue yet. Run <code>frcog app</code> to build it.</p>
  {/if}
{/if}

<style>
  .big { font-size: 44px; font-weight: 700; letter-spacing: -.03em; line-height: 1; }
  .headline { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px;
              flex-wrap: wrap; }
  .side { text-align: right; font-size: 14px; line-height: 1.4; }
  .side b { font-size: 20px; }
  .row { display: flex; gap: 10px; margin-bottom: 8px; }
  .install { display: flex; align-items: center; justify-content: space-between;
             gap: 12px; }
  .install p { margin: 0; }
  .reason { margin: 0 0 10px; }
  .links { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .links a {
    display: inline-flex; align-items: center; gap: 6px; flex: 1 1 auto;
    justify-content: center; min-height: 42px; padding: 8px 14px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    color: var(--accent); text-decoration: none; font-size: 14px; font-weight: 550;
  }
  .error { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
           padding: 10px 12px; }
  button.study { display: flex; width: 100%; font-size: 17px; padding: 15px;
                 margin-bottom: 12px; background: var(--accent); color: var(--on-accent);
                 border: none; border-radius: 14px; font-weight: 650; }
  button.second { display: flex; width: 100%; font-size: 16px; padding: 13px;
                  margin-bottom: 12px; background: var(--panel); color: var(--ink);
                  border: 1px solid var(--line); border-radius: 14px; }
</style>
