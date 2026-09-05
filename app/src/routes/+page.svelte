<script>
  import { onMount } from 'svelte';
  import { index, meta } from '$lib/catalogue.js';
  import { coverageOf, percent } from '$lib/coverage.js';
  import Levels from '$lib/components/Levels.svelte';
  import Settings from '$lib/components/Settings.svelte';
  import { allCards, getSettings, reviewsSince } from '$lib/db.js';
  import { newAllowance, allowanceReason, retention } from '$lib/scheduler.js';
  import { dayStart } from '$lib/progress.js';
  import { sitting } from '$lib/session.js';
  import { installAutoSync, sync, syncConfig } from '$lib/sync.js';
  import { canDetectMetering, connectionState, describeConnection } from '$lib/network.js';
  import { POLICIES, policyLabel } from '$lib/syncpolicy.js';
  import { DEFAULT_SETTINGS, setSetting } from '$lib/db.js';
  import SignIn from '$lib/components/SignIn.svelte';
  import Account from '$lib/components/Account.svelte';
  import { onInstallable, promptInstall } from '$lib/pwa.js';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import BookPlus from '@lucide/svelte/icons/book-plus';
  import Footprints from '@lucide/svelte/icons/footprints';
  import CalendarCheck from '@lucide/svelte/icons/calendar-check';
  import List from '@lucide/svelte/icons/list';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';

  let ready = $state(false);
  let installable = $state(false);
  let bootError = $state('');
  let catalogue = $state(null);
  let idx = $state([]);
  let settings = $state(null);
  let cards = $state([]);
  let recent = $state([]);
  let syncInfo = $state({ api: '', syncedAt: 0 });
  let syncing = $state(false);
  let syncMessage = $state('');
  let connection = $state('unknown');
  let detectable = $state(false);
  let signedIn = $derived(!!syncInfo.token);

  async function afterSignIn() {
    syncInfo = await syncConfig();
    runSync();
  }

  async function afterSignOut() {
    syncInfo = await syncConfig();
  }

  const WEEK = 7 * 86400 * 1000;

  let due = $derived(sitting(cards).filter((c) => new Date(c.due) <= new Date()).length);
  let met = $derived(new Set(cards.filter((c) => c.channel === 'written').map((c) => c.key)).size);
  let coverage = $derived(coverageOf(cards, idx));
  let known = $derived(coverage.known);
  let retention7d = $derived(retention(recent));
  let doneToday = $derived(recent.filter((r) => r.ts * 1000 >= dayStart()).length);
  let allowance = $derived(
    settings ? newAllowance({ dueCount: due, retention7d, settings }) : 0);
  let reason = $derived(
    settings ? allowanceReason({ dueCount: due, retention7d, settings, allowance }) : '');

  /* Anything here failing used to leave the page on "Loading…" for ever with
     nothing said, which is how a missing sign-in button looked. Each piece is
     now allowed to fail on its own, and a real failure is shown. */
  onMount(() => {
    let stop = () => {};
    const stopInstall = onInstallable((v) => { installable = v; });
    (async () => {
      try {
        const results = await Promise.allSettled([
          meta(), getSettings(), allCards(), reviewsSince(Date.now() - WEEK), syncConfig(),
          index(),
        ]);
        const [m, s, c, r, sc, ix] = results;
        catalogue = m.status === 'fulfilled' ? m.value : null;
        idx = ix.status === 'fulfilled' ? ix.value : [];
        settings = s.status === 'fulfilled' ? s.value : { ...DEFAULT_SETTINGS };
        cards = c.status === 'fulfilled' ? c.value : [];
        recent = r.status === 'fulfilled' ? r.value : [];
        syncInfo = sc.status === 'fulfilled' ? sc.value : { api: '', token: '', syncedAt: 0 };

        const broken = results.find((x) => x.status === 'rejected'
          && x !== m && x !== ix);   /* a missing catalogue is normal before `frcog app` */
        if (broken) bootError = String(broken.reason?.message || broken.reason);

        connection = connectionState();
        detectable = canDetectMetering();
      } catch (err) {
        bootError = String(err?.message || err);
      } finally {
        ready = true;      /* always render something, even a failure */
      }

      /* Automatic on wifi, explicit otherwise. Retaken whenever you come back
         to the app or the connection changes. */
      try {
        stop = installAutoSync({
          isBusy: () => syncing,
          onResult: async (res) => {
            syncMessage = `${res.summary} (automatic)`;
            cards = await allCards();
            syncInfo = await syncConfig();
          },
        });
      } catch { /* sync being unavailable must not stop the app working */ }
    })();
    return () => { stop(); stopInstall(); };
  });

  async function setPolicy(value) {
    await setSetting('autoSync', value);
    settings = await getSettings();
  }

  async function reloadSettings() {
    settings = await getSettings();
  }

  async function runSync() {
    syncing = true;
    syncMessage = '';
    try {
      const res = await sync();
      syncMessage = res.summary;
      cards = await allCards();
      syncInfo = await syncConfig();
    } catch (err) {
      syncMessage = err.message;
    } finally {
      syncing = false;
    }
  }
</script>

<header>
  <h1>French Cognates</h1>
</header>

{#if !ready}
  <p class="muted">Loading…</p>
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
    <BookOpen size={18} />
    {due > 0
      ? `Study ${due} due card${due === 1 ? '' : 's'}`
      : allowance > 0 ? `Start ${allowance} new words` : 'Study'}
  </button>
  {#if met > 0}
    <button class="walk" onclick={() => goto(`${base}/study/?walk=1`)}>
      <Footprints size={17} /> Walk: the same cards, no keyboard
    </button>
  {/if}
  <button class="walk" onclick={() => goto(`${base}/words/`)}><BookPlus size={17} /> Add your own words</button>

  <section class="row">
    <div class="stat"><b>{due}</b><span>due now</span></div>
    <div class="stat"><b>{allowance}</b><span>new today</span></div>
    <div class="stat">
      <b>{retention7d === null ? '—' : Math.round(retention7d * 100) + '%'}</b>
      <span>recall this week</span>
    </div>
  </section>
  <p class="muted small">
    {reason}
    &middot; <a href="{base}/progress/"><CalendarCheck size={13} />
      {doneToday ? `today: ${doneToday} done` : "today's progress"}</a>
    {#if met > 0}&middot; <a href="{base}/cards/"><List size={13} /> see all {met} words you have met</a>{/if}
  </p>

  {#if signedIn}
    <Account email={syncInfo.email} onSignedOut={afterSignOut} />

    <section class="panel">
      <h2>Sync</h2>
      <p class="muted small">
        {syncInfo.syncedAt
          ? `Last synced ${new Date(syncInfo.syncedAt).toLocaleString()}`
          : 'Never synced on this device'}
        &middot; {describeConnection(connection)}
      </p>
      <button onclick={runSync} disabled={syncing}>
        <RefreshCw size={15} class={syncing ? 'spin' : ''} /> {syncing ? 'Syncing…' : 'Sync now'}
      </button>
      {#if syncMessage}<p class="small">{syncMessage}</p>{/if}

      <fieldset>
        <legend>When to sync on its own</legend>
        {#each POLICIES as p}
          <label>
            <input type="radio" name="autosync" value={p}
                   checked={settings.autoSync === p}
                   onchange={() => setPolicy(p)} />
            {policyLabel(p, detectable)}
          </label>
        {/each}
        {#if !detectable}
          <p class="muted small">
            This browser will not say whether the connection is metered, so
            &ldquo;automatically when unmetered&rdquo; never fires here. Choose
            one of the other two.
          </p>
        {/if}
      </fieldset>
    </section>
  {:else}
    <SignIn onSignedIn={afterSignIn} />
  {/if}

  {#if idx.length}
    <Levels levels={coverage.levels} {settings} onSettingsChanged={reloadSettings} />
  {/if}
  <Settings {settings} onChange={reloadSettings} />

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
      Catalogue: {catalogue.words} words across {catalogue.levels.length} levels,
      reaching {(catalogue.ceiling * 100).toFixed(1)}% of running French text.
    </p>
  {:else}
    <p class="muted small">No catalogue yet. Run <code>frcog app</code> to build it.</p>
  {/if}
{/if}

<style>
  h1 { font-size: 20px; margin: 4px 0 16px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
       color: var(--muted); margin: 0 0 8px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
           padding: 16px; margin-bottom: 12px; }
  .big { font-size: 44px; font-weight: 700; letter-spacing: -.03em; line-height: 1; }
  .headline { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px;
              flex-wrap: wrap; }
  .side { text-align: right; font-size: 14px; line-height: 1.4; }
  .side b { font-size: 20px; }
  .row { display: flex; gap: 10px; margin-bottom: 8px; }
  .stat { flex: 1; text-align: center; background: var(--panel);
          border: 1px solid var(--line); border-radius: 12px; padding: 10px 6px; }
  .stat b { display: block; font-size: 21px; }
  .stat span { font-size: 12px; color: var(--muted); }
  .install { display: flex; align-items: center; justify-content: space-between;
             gap: 12px; }
  .install p { margin: 0; }
  .muted { color: var(--muted); }
  a { color: var(--accent); }
  :global(.spin) { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error { color: var(--bad); font-size: 13px; background: var(--panel);
           border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .small { font-size: 13px; }
  button { font: inherit; font-weight: 600; color: #fff; background: var(--accent);
           border: none; border-radius: 10px; padding: 10px 18px; cursor: pointer; }
  button:disabled { opacity: .6; cursor: progress; }
  button.study { display: flex; width: 100%; font-size: 17px; padding: 15px;
                 margin-bottom: 12px; background: var(--accent); color: #fff;
                 border: none; border-radius: 14px; font-weight: 650; }
  button.walk { display: flex; width: 100%; font-size: 16px; padding: 13px;
                margin-bottom: 12px; background: var(--panel); color: var(--ink);
                border: 1px solid var(--line); border-radius: 14px; }
  fieldset { border: 1px solid var(--line); border-radius: 10px; margin: 14px 0 0;
             padding: 10px 12px; }
  legend { font-size: 12px; color: var(--muted); padding: 0 4px; }
  label { display: block; font-size: 13.5px; padding: 3px 0; cursor: pointer; }
</style>
