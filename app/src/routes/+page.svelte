<script>
  import { onMount } from 'svelte';
  import { meta } from '$lib/catalogue.js';
  import { allCards, getSettings, reviewsSince } from '$lib/db.js';
  import { isMature, newAllowance, allowanceReason, retention } from '$lib/scheduler.js';
  import { installAutoSync, sync, syncConfig } from '$lib/sync.js';
  import { canDetectMetering, connectionState, describeConnection } from '$lib/network.js';
  import { POLICIES, policyLabel } from '$lib/syncpolicy.js';
  import { DEFAULT_SETTINGS, setSetting } from '$lib/db.js';
  import SignIn from '$lib/components/SignIn.svelte';
  import Account from '$lib/components/Account.svelte';

  let ready = $state(false);
  let bootError = $state('');
  let catalogue = $state(null);
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

  let due = $derived(cards.filter((c) => new Date(c.due) <= new Date()).length);
  let known = $derived(cards.filter((c) => c.direction === 'fr_en' && isMature(c)).length);
  let retention7d = $derived(retention(recent));
  let allowance = $derived(
    settings ? newAllowance({ dueCount: due, retention7d, settings }) : 0);
  let reason = $derived(
    settings ? allowanceReason({ dueCount: due, retention7d, settings, allowance }) : '');

  /* Anything here failing used to leave the page on "Loading…" for ever with
     nothing said, which is how a missing sign-in button looked. Each piece is
     now allowed to fail on its own, and a real failure is shown. */
  onMount(() => {
    let stop = () => {};
    (async () => {
      try {
        const results = await Promise.allSettled([
          meta(), getSettings(), allCards(), reviewsSince(Date.now() - WEEK), syncConfig(),
        ]);
        const [m, s, c, r, sc] = results;
        catalogue = m.status === 'fulfilled' ? m.value : null;
        settings = s.status === 'fulfilled' ? s.value : { ...DEFAULT_SETTINGS };
        cards = c.status === 'fulfilled' ? c.value : [];
        recent = r.status === 'fulfilled' ? r.value : [];
        syncInfo = sc.status === 'fulfilled' ? sc.value : { api: '', token: '', syncedAt: 0 };

        const broken = results.find((x) => x.status === 'rejected'
          && x !== m);   /* a missing catalogue is normal before `frcog app` */
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
    return () => stop();
  });

  async function setPolicy(value) {
    await setSetting('autoSync', value);
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
  <section class="panel">
    <div class="big">{known}</div>
    <div class="muted">words known</div>
  </section>

  <section class="row">
    <div class="stat"><b>{due}</b><span>due now</span></div>
    <div class="stat"><b>{allowance}</b><span>new today</span></div>
    <div class="stat">
      <b>{retention7d === null ? '—' : Math.round(retention7d * 100) + '%'}</b>
      <span>recall this week</span>
    </div>
  </section>
  <p class="muted small">{reason}</p>

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
        {syncing ? 'Syncing…' : 'Sync now'}
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
  .row { display: flex; gap: 10px; margin-bottom: 8px; }
  .stat { flex: 1; text-align: center; background: var(--panel);
          border: 1px solid var(--line); border-radius: 12px; padding: 10px 6px; }
  .stat b { display: block; font-size: 21px; }
  .stat span { font-size: 12px; color: var(--muted); }
  .muted { color: var(--muted); }
  .error { color: var(--bad); font-size: 13px; background: var(--panel);
           border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .small { font-size: 13px; }
  button { font: inherit; font-weight: 600; color: #fff; background: var(--accent);
           border: none; border-radius: 10px; padding: 10px 18px; cursor: pointer; }
  button:disabled { opacity: .6; cursor: progress; }
  fieldset { border: 1px solid var(--line); border-radius: 10px; margin: 14px 0 0;
             padding: 10px 12px; }
  legend { font-size: 12px; color: var(--muted); padding: 0 4px; }
  label { display: block; font-size: 13.5px; padding: 3px 0; cursor: pointer; }
</style>
