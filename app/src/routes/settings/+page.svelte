<script lang="ts">
  /** Everything you can change, in one place. */

  /* It used to be a fold-out at the bottom of the home screen, next to the sync
     panel and the account panel, which meant the home screen was half settings
     and none of it was findable. Home answers "what should I do now"; this
     answers "how should it work". */

  import Account from '$lib/components/Account.svelte';
  import Fr from '$lib/components/Fr.svelte';
  import SignIn from '$lib/components/SignIn.svelte';
  import { DEFAULT_SETTINGS, exportProgress, getSettings, setSetting } from '$lib/db';
  import { applyDisplay } from '$lib/display.svelte';
  import { DEFAULT_DISPLAY } from '$lib/gender';
  import type { ConnectionState } from '$lib/network';
  import { canDetectMetering, connectionState, describeConnection } from '$lib/network';
  import { sync, syncConfig } from '$lib/sync';
  import { POLICIES, bulkPolicyLabel, policyLabel } from '$lib/syncpolicy';
  import { ENGINE_LABEL, MODEL_MB, forgetModel, modelCached } from '$lib/tts';
  import type { Settings } from '$lib/types';
  import Download from '@lucide/svelte/icons/download';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { onMount } from 'svelte';

  /* Derived from Settings rather than listed, so a setting that changes type
     cannot leave a box writing the wrong thing. */
  /** The keys of Settings whose value is a number, which are the only ones the
   *  number boxes may write to. */
  type NumericSetting = {
    [K in keyof Settings]-?: Settings[K] extends number ? K : never;
  }[keyof Settings];

  /** What a number box accepts, in the units shown on screen. */
  interface Bounds {
    /** Smallest value the box may write. Anything lower is clamped to it. */
    min: number;
    /** Largest value the box may write. Anything higher is clamped to it. */
    max: number;
    /** What the shown number is divided by before it is stored: 100 for a
     *  percentage typed as 90 and kept as 0.9. Defaults to 1. */
    scale?: number;
  }

  /* Nothing here shows the cursor and the starting value leaves it out;
     everything else is read on screen. */
  /** As much of the sync configuration as this screen holds. */
  interface SyncInfo {
    /** Where the API is; `''` before it is known. */
    api: string;
    /** This device's bearer token. Empty means not signed in. */
    token: string;
    /** The server sequence this device has everything up to. */
    cursor?: number;
    /** Milliseconds at the last successful sync; 0 for never. */
    syncedAt: number;
    /** The account's email, for the Devices panel to name. */
    email: string;
  }

  /** The settings as they stand, defaults until they have been read back. */
  let settings = $state<Settings>({ ...DEFAULT_SETTINGS, ...DEFAULT_DISPLAY });
  /** True once the first read has finished; nothing is drawn before it, so a
   *  box never shows a default and then jumps. */
  let ready = $state(false);
  /** What the last export wrote, said after the file is saved; `''` before. */
  let exported = $state('');
  /** What this device knows about syncing. */
  let syncInfo = $state<SyncInfo>({ api: '', token: '', syncedAt: 0, email: '' });
  /** True while a sync is in flight, which disables the button. */
  let syncing = $state(false);
  /** The last sync's summary, or the reason it failed; shown verbatim. */
  let syncMessage = $state('');
  /** What the browser says about the connection, for the policy explanation. */
  let connection = $state<ConnectionState>('unknown');
  /** Whether this browser will say if the connection is metered at all. */
  let detectable = $state(false);
  /** True once the voice model has been fetched onto this device. */
  let voiceOnDevice = $state(false);
  /** What happened when the voice was removed, or why it could not be. */
  let voiceNote = $state('');
  /** Whether there is a token, which is the whole of "signed in" here. */
  let signedIn = $derived(!!syncInfo.token);

  onMount(async () => {
    settings = await getSettings();
    syncInfo = await syncConfig();
    connection = connectionState();
    detectable = canDetectMetering();
    voiceOnDevice = await modelCached();
    readTheme();
    ready = true;
  });

  /** Write one setting, then read the whole lot back, so what is shown is
   *  always what would be read on the next load. */
  async function set<K extends keyof Settings>(name: K, value: Settings[K]): Promise<void> {
    /* Read back rather than patching the copy on screen: the store fills in
       defaults. */
    await setSetting(name, value);
    settings = await getSettings();
    applyDisplay(settings); /* the colours are live on every screen */
    readTheme();
  }

  /** A change handler for one number box: clamps to the box's own range and
   *  divides by its scale before storing. A value that is not a number at all
   *  writes nothing, so clearing the box leaves the setting alone. */
  const number =
    (name: NumericSetting, { min, max, scale = 1 }: Bounds) =>
    (event: Event) => {
      const raw = Number((event.target as HTMLInputElement).value);
      if (!Number.isFinite(raw)) return;
      set(name, Math.min(max, Math.max(min, raw)) / scale);
    };

  /** Sync now, on purpose. The summary or the failure is shown either way. */
  async function runSync(): Promise<void> {
    /* A sync that silently does nothing is the one thing worse than a slow one. */
    syncing = true;
    syncMessage = '';
    try {
      syncMessage = (await sync()).summary;
      syncInfo = await syncConfig();
    } catch (err) {
      syncMessage = (err as Error).message;
    } finally {
      syncing = false;
    }
  }

  /** Delete the voice model from this device, and say what that costs: it
   *  comes back as the same download the first time a word of yours needs it. */
  async function dropVoice(): Promise<void> {
    voiceNote = '';
    try {
      await forgetModel();
      voiceOnDevice = false;
      voiceNote =
        `The voice is gone. It comes back as a ${MODEL_MB} MB download the next ` +
        'time a word of yours needs audio.';
    } catch (err) {
      voiceNote = (err as Error).message;
    }
  }

  /** Save everything learned as a JSON file, and say what went into it. */
  async function download(): Promise<void> {
    /* The anchor is made, clicked and removed here because there is no server
       to link to: the file exists only as a blob in this tab. */
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
    exported =
      `${data.states.length} cards and ${data.reviews.length} reviews. ` +
      'Merge with: frcog import-app <file>';
  }

  /** One of the words in the preview strip. */
  interface Sample {
    /** The French, article and all, exactly as a card would show it. */
    text: string;
    /** `m` | `f` | `mf`, which is what the colouring is keyed to. */
    gender: string;
    /** `pl` on the one word taught in the plural, absent on the rest. */
    number?: string;
  }

  /* Painted with the settings as they stand, so a choice can be seen rather
     than imagined. */
  /** The preview strip: one word of each kind a card can show. */
  const SAMPLES: readonly Sample[] = [
    { text: 'le train', gender: 'm' },
    { text: 'la source', gender: 'f' },
    { text: 'les gens', gender: 'm', number: 'pl' },
    { text: 'le/la ministre', gender: 'mf' },
  ];
  /* The swatch of a colour you have not changed shows the theme's own, read off
     the root rather than written down twice: the dark theme's blue is not the
     light theme's. */
  /** The three rows of the colour picker, in the order they are drawn. */
  const COLOURS = [
    { name: 'colourMasc', label: 'Masculine', variable: '--masc' },
    { name: 'colourFem', label: 'Feminine', variable: '--fem' },
    { name: 'colourPlur', label: 'Plural', variable: '--plur' },
  ] as const;

  /** One row of the colour picker: which setting it writes, what it is called,
   *  and the CSS custom property the theme's own value is read from. */
  type ColourChoice = (typeof COLOURS)[number];

  /* A theme colour is only visible while yours is off the root, so it cannot be
     read once and kept. */
  /** The theme's own value for each colour variable, keyed by setting name.
   *  Reread after every change. */
  let themeColours = $state<Record<string, string>>({});
  /** What the colour input shows: yours if you set one, otherwise the theme's,
   *  and a neutral grey only if neither could be read. */
  const swatch = (c: ColourChoice): string =>
    settings[c.name] || themeColours[c.name] || '#888888';

  /** Read each theme colour into `themeColours`. */
  function readTheme(): void {
    /* Read with your own colour lifted off the root for the length of one style
       recalculation, which never reaches the screen: otherwise a colour you have
       set is what the swatch reports as the theme's. */
    const root = document.documentElement;
    themeColours = Object.fromEntries(
      COLOURS.map((c) => {
        const mine = root.style.getPropertyValue(c.variable);
        if (mine) root.style.removeProperty(c.variable);
        const value = getComputedStyle(root).getPropertyValue(c.variable).trim();
        if (mine) root.style.setProperty(c.variable, mine);
        return [c.name, value];
      }),
    );
  }

  /** The three ways a word taught in the plural can be painted, as the stored
   *  value and the label beside its radio button. */
  const PLURALS = [
    ['plural', 'Its own colour'],
    ['gender', 'The gender’s colour'],
    ['both', 'Plural, underlined in the gender’s colour'],
  ] as const satisfies readonly (readonly [Settings['pluralStyle'], string])[];
</script>

{#if ready}
  <section class="panel">
    <h2>How much per day</h2>
    <label>
      <span>Reviews you are happy to do</span>
      <input
        type="number"
        min="10"
        max="1000"
        step="10"
        value={settings.targetReviews}
        onchange={number('targetReviews', { min: 10, max: 1000 })}
      />
    </label>
    <label>
      <span>New words at most</span>
      <input
        type="number"
        min="0"
        max="100"
        value={settings.maxNewPerDay}
        onchange={number('maxNewPerDay', { min: 0, max: 100 })}
      />
    </label>
    <label>
      <span>Cards in one sitting</span>
      <input
        type="number"
        min="10"
        max="300"
        step="10"
        value={settings.sessionLimit}
        onchange={number('sessionLimit', { min: 10, max: 300 })}
      />
    </label>
    <label>
      <span>Recall to aim for</span>
      <span class="unit">
        <input
          type="number"
          min="70"
          max="97"
          value={Math.round(settings.desiredRetention * 100)}
          onchange={number('desiredRetention', { min: 70, max: 97, scale: 100 })}
        />%
      </span>
    </label>
    <p class="muted small">
      New words per day are worked out from the room these leave, and slow down on their own in
      a week of forgetting. Aiming higher than 90% recall means reviewing much more often.
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
      <input
        type="checkbox"
        checked={settings.genderColour !== false}
        onchange={(e) => set('genderColour', e.currentTarget.checked)}
      />
    </label>

    {#if settings.genderColour !== false}
      <div class="colours">
        {#each COLOURS as c}
          <label class="colour">
            <input
              type="color"
              value={swatch(c)}
              onchange={(e) => set(c.name, e.currentTarget.value)}
            />
            <span>{c.label}</span>
          </label>
        {/each}
        <button class="link" onclick={() => COLOURS.forEach((c) => set(c.name, ''))}>
          Back to the defaults
        </button>
      </div>
      <p class="muted small">
        A colour you choose is used in both the light and the dark theme; the defaults are a
        pair, one for each.
      </p>
    {/if}

    <label class="switch">
      <span>
        Underline the article too
        <small>A shape as well as a colour, for a red/green eye</small>
      </span>
      <input
        type="checkbox"
        checked={settings.genderPattern === 'underline'}
        onchange={(e) => set('genderPattern', e.currentTarget.checked ? 'underline' : 'none')}
      />
    </label>
    <label class="switch">
      <span>
        Write the gender beside the word
        <small>&ldquo;le train (m)&rdquo;, which reads the same in any colour</small>
      </span>
      <input
        type="checkbox"
        checked={settings.genderMark === 'letter'}
        onchange={(e) => set('genderMark', e.currentTarget.checked ? 'letter' : 'none')}
      />
    </label>

    <h3>A word taught in the plural</h3>
    {#each PLURALS as [value, label]}
      <label class="radio">
        <input
          type="radio"
          name="plural"
          checked={(settings.pluralStyle ?? 'plural') === value}
          onchange={() => set('pluralStyle', value)}
        />
        {label}
      </label>
    {/each}
    <p class="muted small">
      Some words are worth learning in the plural — <i>les gens</i>, <i>les vacances</i> — and they
      still have a gender that the singular would show. Mark a word of your own as plural when you
      add or correct it.
    </p>
  </section>

  <section class="panel">
    <h2>Audio</h2>
    {#each POLICIES as p}
      <label class="radio">
        <input
          type="radio"
          name="bulk"
          checked={settings.bulkDownload === p}
          onchange={() => set('bulkDownload', p)}
        />
        {bulkPolicyLabel(p)}
      </label>
    {/each}
    <p class="muted small">
      Words from the catalogue come with recordings. Words you add yourself are spoken by {ENGINE_LABEL}
      on this device, which is a one-time {MODEL_MB} MB download {voiceOnDevice
        ? 'that is already here'
        : 'you will be asked about first'}.
    </p>
    {#if voiceOnDevice}
      <button onclick={dropVoice}><Trash2 size={15} /> Remove the voice from this device</button
      >
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
        <RefreshCw size={15} class={syncing ? 'spin' : ''} />
        {syncing ? 'Syncing…' : 'Sync now'}
      </button>
      {#if syncMessage}<p class="small">{syncMessage}</p>{/if}
      <h3>When to sync on its own</h3>
      {#each POLICIES as p}
        <label class="radio">
          <input
            type="radio"
            name="autosync"
            checked={settings.autoSync === p}
            onchange={() => set('autoSync', p)}
          />
          {policyLabel(p, detectable)}
        </label>
      {/each}
      {#if !detectable}
        <p class="muted small">
          This browser will not say whether the connection is metered, so &ldquo;automatically
          when unmetered&rdquo; never fires here.
        </p>
      {/if}
    {:else}
      <p class="muted small">
        Sign in to keep your progress on more than one device. Everything works without it;
        nothing leaves this phone until you do.
      </p>
      <SignIn
        onSignedIn={async () => {
          syncInfo = await syncConfig();
        }}
      />
    {/if}
  </section>

  {#if signedIn}
    <Account
      email={syncInfo.email}
      onSignedOut={async () => {
        syncInfo = await syncConfig();
      }}
    />
  {/if}

  <section class="panel">
    <h2>Your data</h2>
    <p class="muted small">
      Everything you have learned is on this device{signedIn ? ' and synced' : ''}. A file of it
      can be merged into the pipeline's database.
    </p>
    <button onclick={download}><Download size={15} /> Export progress</button>
    {#if exported}<p class="small">{exported}</p>{/if}
  </section>
{:else}
  <p class="muted">Loading…</p>
{/if}

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 14px 16px;
    margin-bottom: 12px;
  }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 0 0 10px;
  }
  h3 {
    font-size: 13px;
    font-weight: 600;
    margin: 16px 0 6px;
  }
  label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
    font-size: 14.5px;
  }
  label.radio,
  label.switch {
    cursor: pointer;
  }
  label.radio {
    justify-content: flex-start;
    gap: 8px;
    font-size: 13.5px;
  }
  label.switch span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  label.switch small {
    font-size: 12px;
    color: var(--muted);
  }
  input[type='number'] {
    font: inherit;
    width: 5.5em;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
    text-align: right;
  }
  .unit {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .preview {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    font-size: 19px;
    font-weight: 650;
    padding: 12px;
    margin-bottom: 8px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .colours {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    padding: 4px 0 8px;
  }
  .colour {
    flex-direction: column;
    gap: 4px;
    padding: 0;
    font-size: 12px;
    color: var(--muted);
  }
  input[type='color'] {
    width: 42px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: none;
    cursor: pointer;
  }
  button {
    font: inherit;
    font-weight: 600;
    padding: 9px 14px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    cursor: pointer;
  }
  button.link {
    border: none;
    background: none;
    color: var(--accent);
    font-weight: 500;
    font-size: 13px;
    padding: 4px;
  }
  button:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 13px;
  }
  p {
    margin: 6px 0;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
