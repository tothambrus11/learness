<script lang="ts">
  /** Everything you can change, in one place.
   *
   *  It used to be a fold-out at the bottom of the home screen, next to the
   *  sync panel and the account panel, which meant the home screen was half
   *  settings and none of it was findable. Home answers "what should I do
   *  now"; this answers "how should it work".
   */
  import { onMount } from 'svelte';
  import { DEFAULT_SETTINGS, exportProgress, getSettings, setSetting } from '$lib/db.js';
  import { DEFAULT_DISPLAY } from '$lib/gender.js';
  import { applyDisplay } from '$lib/display.svelte.js';
  import { POLICIES, bulkPolicyLabel, policyLabel } from '$lib/syncpolicy.js';
  import { canDetectMetering, connectionState, describeConnection } from '$lib/network.js';
  import { sync, syncConfig } from '$lib/sync.js';
  import { ENGINE_LABEL, MODEL_MB, forgetModel, modelCached } from '$lib/tts.js';
  import { clear as clearNotes, load as loadNotes, onNotes } from '$lib/diagnostics.js';
  import type { Note } from '$lib/diagnostics.js';
  import { environment, issueUrl } from '$lib/report.js';
  import Bug from '@lucide/svelte/icons/bug';
  import Account from '$lib/components/Account.svelte';
  import Fr from '$lib/components/Fr.svelte';
  import SignIn from '$lib/components/SignIn.svelte';
  import Download from '@lucide/svelte/icons/download';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { ConnectionState } from '$lib/network.js';
  import type { Gender, GrammaticalNumber, Settings } from '$lib/model.js';
  import type { SyncConfig } from '$lib/sync.js';
  import type { Millis } from '$lib/units.js';

  let settings = $state<Settings>({ ...DEFAULT_SETTINGS, ...DEFAULT_DISPLAY });
  let ready = $state(false);
  let exported = $state('');
  let syncInfo = $state<SyncConfig>(
    { api: '', token: '', cursor: 0, syncedAt: 0 as Millis, email: '' });
  let syncing = $state(false);
  let syncMessage = $state('');
  let connection = $state<ConnectionState>('unknown');
  let detectable = $state(false);
  let voiceOnDevice = $state(false);
  let voiceNote = $state('');
  /* What went wrong on this device, newest first, and the report link that
     carries it. */
  let notes = $state<readonly Note[]>([]);
  let reportLink = $state(issueUrl({}));
  let signedIn = $derived(!!syncInfo.token);

  let stopNotes: () => void = () => {};
  onMount(() => {
    void boot();
    return () => stopNotes();
  });

  async function boot(): Promise<void> {
    settings = await getSettings();
    syncInfo = await syncConfig();
    connection = connectionState();
    detectable = canDetectMetering();
    voiceOnDevice = await modelCached();
    readTheme();
    ready = true;
    await loadNotes();
    stopNotes = onNotes(async (all) => {
      notes = all.toReversed();
      reportLink = issueUrl(await environment(), all);
    });
  }

  const when = (at: number): string =>
    new Date(at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric',
      month: 'short' });

  async function set<K extends keyof Settings>(name: K, value: Settings[K]): Promise<void> {
    await setSetting(name, value);
    settings = await getSettings();
    applyDisplay(settings);            /* the colours are live on every screen */
    readTheme();
  }

  /** A numeric dial, clamped to what it means, in the unit it is shown in.
   *  `scale` is how many of the shown unit make one stored one — a retention
   *  dial shown as a percentage is stored as a fraction. */
  const number = (
    name: keyof Settings, { min, max, scale = 1 }: { min: number; max: number; scale?: number },
  ) => (event: Event): void => {
    const raw = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    void set(name, (Math.min(max, Math.max(min, raw)) / scale) as Settings[typeof name]);
  };

  async function runSync(): Promise<void> {
    syncing = true; syncMessage = '';
    try {
      syncMessage = (await sync()).summary;
      syncInfo = await syncConfig();
    } catch (err) { syncMessage = (err as Error).message; } finally { syncing = false; }
  }

  async function dropVoice(): Promise<void> {
    voiceNote = '';
    try {
      await forgetModel();
      voiceOnDevice = false;
      voiceNote = `The voice is gone. It comes back as a ${MODEL_MB} MB download the next `
        + 'time a word of yours needs audio.';
    } catch (err) { voiceNote = (err as Error).message; }
  }

  async function download(): Promise<void> {
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
    exported = `${data.states.length} cards and ${data.reviews.length} reviews. `
      + 'Merge with: frcog import-app <file>';
  }

  /* One word of each kind, painted with the settings as they stand, so a
     choice can be seen rather than imagined. */
  const SAMPLES: { text: string; gender: Gender; number?: GrammaticalNumber }[] = [
    { text: 'le train', gender: 'm' },
    { text: 'la source', gender: 'f' },
    { text: 'les gens', gender: 'm', number: 'pl' },
    { text: 'le/la ministre', gender: 'mf' },
    { text: "l'ami", gender: 'mf' },
  ];
  /* The swatch of a colour you have not changed shows the theme's own, read off
     the root rather than written down twice: the dark theme's blue is not the
     light theme's. */
  interface Swatch {
    name: 'colourMasc' | 'colourFem' | 'colourPlur' | 'colourBoth';
    label: string;
    /** The custom property the theme defines it in. */
    variable: string;
  }

  const COLOURS: Swatch[] = [
    { name: 'colourMasc', label: 'Masculine', variable: '--masc' },
    { name: 'colourFem', label: 'Feminine', variable: '--fem' },
    { name: 'colourPlur', label: 'Plural', variable: '--plur' },
    { name: 'colourBoth', label: 'Either', variable: '--both' },
  ];
  let themeColours = $state<Record<string, string>>({});
  const swatch = (c: Swatch): string =>
    settings[c.name] || themeColours[c.name] || '#888888';

  /* Read with your own colour lifted off the root for the length of one style
     recalculation, which never reaches the screen: otherwise a colour you have
     set is what the swatch reports as the theme's. */
  function readTheme(): void {
    const root = document.documentElement;
    themeColours = Object.fromEntries(COLOURS.map((c) => {
      const mine = root.style.getPropertyValue(c.variable);
      if (mine) root.style.removeProperty(c.variable);
      const value = getComputedStyle(root).getPropertyValue(c.variable).trim();
      if (mine) root.style.setProperty(c.variable, mine);
      return [c.name, value];
    }));
  }
  const PLURALS: [Settings['pluralStyle'], string][] = [
    ['plural', 'Its own colour'],
    ['gender', 'The gender’s colour'],
    ['both', 'Plural, underlined in the gender’s colour'],
  ];
</script>

{#if ready}
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
  </section>

  <section class="panel">
    <h2>How words are shown</h2>
    <div class="preview">
      {#each SAMPLES as s}
        <span><Fr text={s.text} gender={s.gender} number={s.number ?? ''} /></span>
      {/each}
    </div>

    <label class="switch">
      <span>Colour the article by gender</span>
      <input type="checkbox" checked={settings.genderColour !== false}
             onchange={(e) => set('genderColour', e.currentTarget.checked)} />
    </label>

    {#if settings.genderColour !== false}
      <div class="colours">
        {#each COLOURS as c}
          <label class="colour">
            <input type="color" value={swatch(c)}
                   onchange={(e) => set(c.name, e.currentTarget.value)} />
            <span>{c.label}</span>
          </label>
        {/each}
        <button class="link" onclick={() => COLOURS.forEach((c) => set(c.name, ''))}>
          Back to the defaults
        </button>
      </div>
      <p class="muted small">
        A colour you choose is used in both the light and the dark theme; the
        defaults are a pair, one for each. A noun that is either gender —
        <i>l&rsquo;ami</i> — takes the violet between the two, and always says
        <i>(m/f)</i> beside itself, since no single colour can mean
        &ldquo;either&rdquo; on its own.
      </p>
    {/if}

    <label class="switch">
      <span>
        Underline the article too
        <small>A shape as well as a colour, for a red/green eye</small>
      </span>
      <input type="checkbox" checked={settings.genderPattern === 'underline'}
             onchange={(e) => set('genderPattern', e.currentTarget.checked ? 'underline' : 'none')} />
    </label>
    <label class="switch">
      <span>
        Write the gender beside the word
        <small>&ldquo;le train (m)&rdquo;, which reads the same in any colour</small>
      </span>
      <input type="checkbox" checked={settings.genderMark === 'letter'}
             onchange={(e) => set('genderMark', e.currentTarget.checked ? 'letter' : 'none')} />
    </label>

    <h3>A word taught in the plural</h3>
    {#each PLURALS as [value, label]}
      <label class="radio">
        <input type="radio" name="plural" checked={(settings.pluralStyle ?? 'plural') === value}
               onchange={() => set('pluralStyle', value)} />
        {label}
      </label>
    {/each}
    <p class="muted small">
      Some words are worth learning in the plural — <i>les gens</i>, <i>les
      vacances</i> — and they still have a gender that the singular would show.
      Mark a word of your own as plural when you add or correct it.
    </p>
  </section>

  <section class="panel">
    <h2>Audio</h2>
    {#each POLICIES as p}
      <label class="radio">
        <input type="radio" name="bulk" checked={settings.bulkDownload === p}
               onchange={() => set('bulkDownload', p)} />
        {bulkPolicyLabel(p)}
      </label>
    {/each}
    <p class="muted small">
      Words from the catalogue come with recordings. Words you add yourself are
      spoken by {ENGINE_LABEL} on this device, which is a one-time {MODEL_MB} MB
      download {voiceOnDevice ? 'that is already here' : 'you will be asked about first'}.
    </p>
    <label class="switch">
      <span>
        Make audio before it is asked for
        <small>
          The forms of a verb in today&rsquo;s queue are spoken ahead of time,
          so pointing at one in the table plays it at once. Off, each is made
          the first time you point at it — a second or so of waiting, and no
          work this device was not asked for.
        </small>
      </span>
      <input type="checkbox" checked={settings.eagerVoice !== false}
             onchange={(e) => set('eagerVoice', e.currentTarget.checked)} />
    </label>
    {#if !voiceOnDevice}
      <p class="muted small">
        Either way nothing is made until the voice is on this device: until
        then a verb&rsquo;s forms are read by the browser&rsquo;s own voice.
      </p>
    {/if}
    {#if voiceOnDevice}
      <button onclick={dropVoice}><Trash2 size={15} /> Remove the voice from this device</button>
    {/if}
    {#if voiceNote}<p class="small">{voiceNote}</p>{/if}
  </section>

  <section class="panel">
    <h2>Sync</h2>
    {#if signedIn}
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
      <h3>When to sync on its own</h3>
      {#each POLICIES as p}
        <label class="radio">
          <input type="radio" name="autosync" checked={settings.autoSync === p}
                 onchange={() => set('autoSync', p)} />
          {policyLabel(p, detectable)}
        </label>
      {/each}
      {#if !detectable}
        <p class="muted small">
          This browser will not say whether the connection is metered, so
          &ldquo;automatically when unmetered&rdquo; never fires here.
        </p>
      {/if}
    {:else}
      <p class="muted small">
        Sign in to keep your progress on more than one device. Everything works
        without it; nothing leaves this phone until you do.
      </p>
      <SignIn onSignedIn={async () => { syncInfo = await syncConfig(); }} />
    {/if}
  </section>

  {#if signedIn}
    <Account email={syncInfo.email}
             onSignedOut={async () => { syncInfo = await syncConfig(); }} />
  {/if}

  <section class="panel">
    <h2>What went wrong</h2>
    {#if notes.length}
      <!-- A recording that would not fetch, a voice that would not load, a
           sync that failed: each written down as it happened, so a report
           can say why rather than that a button did nothing (#31). -->
      <ul class="notes">
        {#each notes as note (note.at + note.what)}
          <li><span class="when">{when(note.at)}</span> <b>{note.where}</b> {note.what}</li>
        {/each}
      </ul>
      <div class="row">
        <a class="button" href={reportLink} target="_blank" rel="noopener noreferrer">
          <Bug size={15} /> Report a problem
        </a>
        <button onclick={clearNotes}>Clear</button>
      </div>
    {:else}
      <p class="muted small">
        Nothing so far. Anything that fails — a recording that will not play, a
        sync that does not go through — is written down here, and goes into the
        report the bug button opens.
      </p>
      <a class="button" href={reportLink} target="_blank" rel="noopener noreferrer">
        <Bug size={15} /> Report a problem
      </a>
    {/if}
  </section>

  <section class="panel">
    <h2>Your data</h2>
    <p class="muted small">
      Everything you have learned is on this device{signedIn ? ' and synced' : ''}.
      A file of it can be merged into the pipeline's database.
    </p>
    <button onclick={download}><Download size={15} /> Export progress</button>
    {#if exported}<p class="small">{exported}</p>{/if}
  </section>
{:else}
  <p class="muted">Loading…</p>
{/if}

<style>
  h3 { font-size: 13px; font-weight: 600; margin: 16px 0 6px; }
  label { display: flex; justify-content: space-between; align-items: center; gap: 12px;
          padding: 6px 0; font-size: 14.5px; }
  label.radio, label.switch { cursor: pointer; }
  label.radio { justify-content: flex-start; gap: 8px; font-size: 13.5px; }
  label.switch span { display: flex; flex-direction: column; gap: 2px; }
  label.switch small { font-size: 12px; color: var(--muted); }
  input[type=number] { width: 5.5em; padding: 6px 8px; border-radius: 8px; text-align: right; }
  .unit { display: flex; align-items: center; gap: 4px; }
  .preview { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 19px; font-weight: 650;
             padding: 12px; margin-bottom: 8px; background: var(--bg);
             border: 1px solid var(--line); border-radius: 12px; }
  .colours { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 4px 0 8px; }
  .colour { flex-direction: column; gap: 4px; padding: 0; font-size: 12px; color: var(--muted); }
  input[type=color] { width: 42px; height: 30px; padding: 0; border: 1px solid var(--line);
                      border-radius: 8px; background: none; cursor: pointer; }
  button.link { font-size: 13px; padding: 4px; }
  .notes { list-style: none; margin: 0 0 10px; padding: 0; font-size: 13.5px; }
  .notes li { padding: 5px 0; border-top: 1px solid var(--line); line-height: 1.4; }
  .notes li:first-child { border-top: none; }
  .notes .when { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 6px; }
  .notes b { font-weight: 600; margin-right: 4px; }
  .row { display: flex; gap: 8px; align-items: center; }
  /* A link drawn as a button, since it opens a page rather than doing a thing. */
  a.button { display: inline-flex; align-items: center; gap: 6px; font-weight: 600;
             padding: 10px 16px; border-radius: 10px; border: 1px solid var(--line);
             background: var(--panel); color: var(--ink); text-decoration: none; }
  p { margin: 6px 0; }
  :global(.spin) { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
