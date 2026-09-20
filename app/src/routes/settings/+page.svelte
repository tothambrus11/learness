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
  import { DEFAULT_MINUTES } from '$lib/plan.js';
  import { DEFAULT_DISPLAY } from '$lib/gender.js';
  import { applyDisplay } from '$lib/display.svelte.js';
  import { loadTheme, theme } from '$lib/theme.svelte.js';
  import { resolveColours } from '$lib/theme.js';
  import type { Token } from '$lib/theme.js';
  import Themes from '$lib/components/Themes.svelte';
  import { POLICIES, bulkPolicyLabel, policyLabel } from '$lib/syncpolicy.js';
  import { canDetectMetering, connectionState, describeConnection } from '$lib/network.js';
  import { sync, syncConfig } from '$lib/sync.js';
  import { ENGINE_LABEL, MODEL_MB, forgetModel, modelCached } from '$lib/tts.js';
  import { MB, clipCacheSize, trimClips } from '$lib/clipcache.js';
  import { clear as clearNotes, load as loadNotes, onNotes, report } from '$lib/diagnostics.js';
  import type { Note } from '$lib/diagnostics.js';
  import { environment, issueUrl } from '$lib/report.js';
  import Bug from '$lib/components/BugIcon.svelte';
  import Account from '$lib/components/Account.svelte';
  import Fr from '$lib/components/Fr.svelte';
  import SignIn from '$lib/components/SignIn.svelte';
  import Download from '@lucide/svelte/icons/download';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Spinner from '$lib/components/Spinner.svelte';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { ConnectionState } from '$lib/network.js';
  import type { FormGap, Gender, GrammaticalNumber, Settings } from '$lib/model.js';
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
    cache = await clipCacheSize();
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
    await loadTheme();                 /* and so is the theme, if the choice moved */
    /* A cap set or lowered is applied now, not at the next clip, and the
       line under it says what went. */
    if (name === 'capClips' || name === 'clipCacheMb') await capAudio();
  }

  /* How much the voice has made here, and what the cap just dropped. */
  let cache = $state({ clips: 0, bytes: 0 });
  let trimmed = $state('');
  async function capAudio(): Promise<void> {
    try {
      const gone = await trimClips(settings);
      trimmed = gone.length ? `${gone.length} just dropped` : '';
    } catch (err) {
      report('voice', `the audio cache could not be trimmed: ${(err as Error).message}`);
    }
    cache = await clipCacheSize();
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

  /** The hour the day turns, a whole one: the clock turns at three, not at
   *  half past, so a fraction typed in is rounded before it is kept and the
   *  dial shows the hour the day actually uses. */
  const hour = (event: Event): void => {
    const raw = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    void set('dayStartsAt', Math.round(Math.min(23, Math.max(0, raw))));
  };

  /** The pause between the lines of a tense read aloud, as the three rows
   *  show it: none, a fixed number of seconds, or an echo. The seconds are
   *  kept in the setting itself, so "a pause of" chosen again after "no
   *  pause" starts from a couple of seconds rather than none. */
  const gap = (): FormGap => settings.formGap ?? DEFAULT_SETTINGS.formGap;
  const gapKind = (g: FormGap): 'none' | 'fixed' | 'echo' =>
    g.mode === 'echo' ? 'echo' : g.ms > 0 ? 'fixed' : 'none';
  const gapSeconds = (g: FormGap): number => (g.mode === 'fixed' && g.ms > 0 ? g.ms / 1000 : 2);
  const setGapSeconds = (event: Event): void => {
    const raw = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    void set('formGap', { mode: 'fixed', ms: Math.round(Math.min(10, Math.max(0.5, raw)) * 1000) });
  };

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  /** One weekday's minutes. The whole week is written, since a setting is one
   *  value; a week stored short is filled up to seven on the way. */
  const minutes = (day: number) => (event: Event): void => {
    const raw = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    const next = [...settings.minutesByWeekday];
    while (next.length < 7) next.push(DEFAULT_MINUTES);
    next[day] = Math.min(240, Math.max(0, Math.round(raw)));
    void set('minutesByWeekday', next);
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
  /* The swatch of a colour you have not changed shows the theme's own, read
     off the theme in force rather than written down twice: the dark theme's
     blue is not the light theme's. */
  interface Swatch {
    name: 'colourMasc' | 'colourFem' | 'colourPlur' | 'colourBoth';
    label: string;
    /** The theme's token it stands in for. */
    token: Token;
  }

  const COLOURS: Swatch[] = [
    { name: 'colourMasc', label: 'Masculine', token: 'masc' },
    { name: 'colourFem', label: 'Feminine', token: 'fem' },
    { name: 'colourPlur', label: 'Plural', token: 'plur' },
    { name: 'colourBoth', label: 'Either', token: 'both' },
  ];
  const swatch = (c: Swatch): string =>
    settings[c.name] || (theme.current ? resolveColours(theme.current)[c.token] : '#888888');
  const PLURALS: [Settings['pluralStyle'], string][] = [
    ['plural', 'Its own colour'],
    ['gender', 'The gender’s colour'],
    ['both', 'Plural, underlined in the gender’s colour'],
  ];
</script>

{#if ready}
  <section class="panel">
    <h2>How much per day</h2>
    <div class="week">
      <span>Minutes each day</span>
      <span class="days">
        {#each DAYS as name, i (name)}
          <label class="day">
            <span>{name}</span>
            <input type="number" min="0" max="240"
                   value={settings.minutesByWeekday[i] ?? DEFAULT_MINUTES} onchange={minutes(i)} />
          </label>
        {/each}
      </span>
    </div>
    <label>
      <span>The day turns at</span>
      <span class="unit">
        <input type="number" min="0" max="23" step="1" value={settings.dayStartsAt}
               onchange={hour} /> o&rsquo;clock
      </span>
    </label>
    <p class="muted small">
      A sitting at half past midnight belongs to the evening before, so the
      day&rsquo;s count, its new words, its minutes and the streak turn at this
      hour rather than at midnight. Zero is midnight.
    </p>
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
      <span>A new word every</span>
      <span class="unit">
        <input type="number" min="2" max="20" value={settings.exploreEvery}
               onchange={number('exploreEvery', { min: 2, max: 20 })} /> cards
      </span>
    </label>
    <label>
      <span>Recall to aim for</span>
      <span class="unit">
        <input type="number" min="70" max="97" value={Math.round(settings.desiredRetention * 100)}
               onchange={number('desiredRetention', { min: 70, max: 97, scale: 100 })} />%
      </span>
    </label>
    <p class="muted small">
      New words are worked out from the room the day&rsquo;s minutes leave after
      what is due, at the pace your answers have been taking, and slow down on
      their own when the week&rsquo;s recall falls under what you asked for:
      five points under halves them, ten stops them. One new word &mdash; your
      own first, then the catalogue&rsquo;s &mdash; is dealt every few cards, so
      a lesson pasted in is met in batches rather than in one go, and each word
      comes back within the sitting. Aiming higher than 90% recall means
      reviewing much more often.
    </p>
  </section>

  <section class="panel">
    <h2>Colours</h2>
    <Themes onchange={async () => { settings = await getSettings(); await loadTheme(); }} />
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
    <h3>When audio is made</h3>
    <label class="radio">
      <input type="radio" name="voicewhen" checked={settings.eagerVoice !== false}
             onchange={() => set('eagerVoice', true)} />
      Ahead of time, for the cards coming up
    </label>
    <label class="radio">
      <input type="radio" name="voicewhen" checked={settings.eagerVoice === false}
             onchange={() => set('eagerVoice', false)} />
      When a card asks for it
    </label>
    <p class="muted small">
      Ahead of time, the sentences and verb forms of today&rsquo;s queue are
      made in the background in the order the cards come, so the flip plays at
      once &mdash; the card on screen is always first in line. On demand, each
      is made the first time it is wanted: a second or so of waiting, and no
      work this device was not asked for.
      {#if !voiceOnDevice}
        Either way nothing is made until the voice is on this device; until
        then the browser&rsquo;s own voice reads what the catalogue has no
        recording of.
      {/if}
    </p>
    <h3>Between the lines of a tense read aloud</h3>
    <label class="radio">
      <input type="radio" name="formgap" checked={gapKind(gap()) === 'none'}
             onchange={() => set('formGap', { mode: 'fixed', ms: 0 })} />
      No pause
    </label>
    <label class="radio">
      <input type="radio" name="formgap" checked={gapKind(gap()) === 'fixed'}
             onchange={() => set('formGap', { mode: 'fixed', ms: gapSeconds(gap()) * 1000 })} />
      A pause of
      <span class="unit">
        <input type="number" min="0.5" max="10" step="0.5" value={gapSeconds(gap())}
               disabled={gapKind(gap()) !== 'fixed'} onchange={setGapSeconds} /> s
      </span>
    </label>
    <label class="radio">
      <input type="radio" name="formgap" checked={gapKind(gap()) === 'echo'}
             onchange={() => set('formGap', { mode: 'echo' })} />
      Long enough to say it back
    </label>
    <p class="muted small">
      The speaker at the head of a tense reads it one person at a time. With
      no pause the lines run on, which is how a tense is heard as one thing;
      &ldquo;long enough to say it back&rdquo; leaves room after each line
      to repeat it &mdash; as long as that line, or the next, whichever runs
      longer.
    </p>
    <label class="switch">
      <span>
        Keep the audio made here under a size
        <small>
          What has not been heard for longest goes first, and is made again
          the next time a card wants it.
        </small>
      </span>
      <span class="unit">
        <input type="checkbox" checked={settings.capClips}
               onchange={(e) => set('capClips', e.currentTarget.checked)} />
        <input type="number" min="10" max="5000" step="10" value={settings.clipCacheMb}
               disabled={!settings.capClips}
               onchange={number('clipCacheMb', { min: 10, max: 5000 })} /> MB
      </span>
    </label>
    <p class="muted small">
      {cache.clips} clip{cache.clips === 1 ? '' : 's'} on this device,
      {(cache.bytes / MB).toFixed(cache.bytes < MB ? 1 : 0)} MB{trimmed ? ` · ${trimmed}` : ''}.
    </p>
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
        {#if syncing}<Spinner label="syncing" />{:else}<RefreshCw size={15} />{/if}
        {syncing ? 'Syncing…' : 'Sync now'}
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
  .unit { display: flex; align-items: center; gap: 4px; }
  /* A dial beside its switch stays a row: the switch's spans are columns. */
  label.switch span.unit { flex-direction: row; flex: 0 0 auto; }
  .week { display: flex; flex-direction: column; gap: 6px; padding: 6px 0; font-size: 14.5px; }
  .days { display: flex; flex-wrap: wrap; gap: 6px; }
  label.day { flex-direction: column; gap: 2px; padding: 0; font-size: 12px; color: var(--muted); }
  /* Three digits: the most a day may have is 240. */
  label.day input[type=number] { width: calc(3ch + 20px); }
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
</style>
