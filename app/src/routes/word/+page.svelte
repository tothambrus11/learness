<script lang="ts">
  /** One word, whole: how it is said, what it means, the sentences it
   *  stands in, its table, and where each of its cards has got to (#42).
   *  Reached from the words list, from a search hit and from the cards
   *  screen, by the word's key in the address, so a page can be kept or sent.
   *  What is on it is worked out in worddetail.ts; this file draws it and
   *  wires the two things it can do — hear the word, and put it up next. */
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { wordSources } from '$lib/audio.js';
  import { setChrome } from '$lib/chrome.svelte.js';
  import { trustWordKey } from '$lib/keys.js';
  import { player } from '$lib/player.js';
  import { addWord } from '$lib/words.js';
  import { detailHref, loadDetail } from '$lib/worddetail.js';
  import type { WordDetail } from '$lib/worddetail.js';
  import type { StudyWord } from '$lib/model.js';
  import Conjugation from '$lib/components/Conjugation.svelte';
  import Fr from '$lib/components/Fr.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import Volume2 from '@lucide/svelte/icons/volume-2';

  let word = $state<StudyWord | null>(null);
  let detail = $state<WordDetail | null>(null);
  let loading = $state(true);
  let trouble = $state('');
  let notice = $state('');
  let busy = $state(false);
  let showForms = $state(false);

  const asked = (): string => page.url.searchParams.get('k') ?? '';

  onMount(load);

  async function load(): Promise<void> {
    loading = true;
    try {
      const key = asked();
      const found = key ? await loadDetail(trustWordKey(key)) : null;
      word = found?.word ?? null;
      detail = found?.detail ?? null;
      if (detail) setChrome({ title: detail.fr, subtitle: detail.pos });
    } finally {
      loading = false;
    }
  }

  /* Through the one player, so a recording that will not play is said by
     the device instead, and one that cannot be is said on screen. */
  async function hear(): Promise<void> {
    if (!word) return;
    trouble = '';
    const heard = await player.play(wordSources(word, 'fr'),
      { missing: `Nothing to play for ${word.fr} on this device yet.` });
    if (!heard) trouble = player.status.trouble;
  }

  async function say(text: string): Promise<void> {
    trouble = '';
    const heard = await player.play([{ say: text, lang: 'fr-FR', rate: 0.9 }],
      { missing: 'No French voice on this device to read the sentence with.' });
    if (!heard) trouble = player.status.trouble;
  }

  /** Put the word up next: promoted with its audio if the catalogue has it,
   *  kept as your own from the dictionary's record if not. The same call the
   *  words screen makes, so the word arrives the same way. */
  async function take(): Promise<void> {
    if (!word || !detail) return;
    busy = true;
    try {
      const own = detail.origin === 'dictionary';
      await addWord(own
        ? { fr: word.fr, en: word.en, pos: word.pos, gender: word.gender ?? '',
            ipa: word.ipa ?? '', own: true }
        : { fr: word.fr, en: word.en });
      notice = `${word.fr} is up next.`;
      await load();
    } finally {
      busy = false;
    }
  }

  const days = (d: number): string =>
    (d >= 365 ? `${(d / 365).toFixed(1)} y` : d >= 1 ? `${Math.round(d)} d` : d > 0 ? '<1 d' : '—');
  const pct = (x: number | null): string => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const GENDER: Record<string, string> = { m: 'masculine', f: 'feminine', mf: 'either gender' };
</script>

{#if loading}
  <p class="muted">Looking it up…</p>
{:else if !detail || !word}
  <section class="panel centre">
    <p class="muted">Nothing here knows <b>{asked() || 'that word'}</b>.</p>
    <a class="button" href="{base}/words/">Back to your words</a>
  </section>
{:else}
  <section class="panel head">
    <h1 class="fr"><Fr text={detail.fr} gender={detail.gender} number={detail.number} /></h1>
    {#if detail.ipa}<div class="ipa">{detail.ipa}</div>{/if}
    <p class="meta muted small">
      {detail.pos}{#if detail.gender && GENDER[detail.gender]} · {GENDER[detail.gender]}{/if}{#if detail.number === 'pl'} · plural{/if}
      {#if detail.little} · a little word{:else if detail.origin === 'catalogue'} · level {detail.level}{:else if detail.origin === 'mine'} · your own word{:else} · from the dictionary{/if}
    </p>
    <div class="actions">
      <button class="chip" onclick={hear}><Volume2 size={15} /> Hear it</button>
      {#if detail.status === 'not started'}
        <button class="chip primary" onclick={take} disabled={busy}><Plus size={15} /> Study it next</button>
      {:else}
        <span class="status" class:known={detail.status === 'known'}>{detail.status}</span>
      {/if}
    </div>
    {#if notice}<p class="notice">{notice}</p>{/if}
    {#if trouble}<p class="error">{trouble}</p>{/if}
  </section>

  <section class="panel">
    <h2>Meaning</h2>
    <p class="en">{detail.en.join(' · ')}</p>
    {#if detail.senses.length}<p class="muted small">{detail.senses.join(' · ')}</p>{/if}
    {#if detail.defs.length}
      <ol class="defs">
        {#each detail.defs as line (line)}<li>{line}</li>{/each}
      </ol>
    {/if}
    {#if detail.note}<p class="muted small">{detail.note}</p>{/if}
  </section>

  {#if detail.sense}
    <section class="panel">
      <h2>A little word</h2>
      <p class="sense">{detail.sense}</p>
      {#if detail.contrast.length}
        <p class="muted small">
          Chosen against
          {#each detail.contrast as partner, i (partner.key)}{#if i}{', '}{/if}<a href={detailHref(base, partner.key)}>{partner.fr}</a>{/each}
          {' '}— each a card of its own.
        </p>
      {/if}
    </section>
  {/if}

  {#if detail.chunks.length}
    <section class="panel">
      <h2>With its preposition</h2>
      <ul class="chunks">
        {#each detail.chunks as chunk (chunk.fr)}
          <li><b>{chunk.fr}</b> <span class="muted">{chunk.en}</span></li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if detail.examples.length}
    <section class="panel">
      <h2>In a sentence</h2>
      <ul class="examples">
        {#each detail.examples as ex (ex.fr)}
          <li>
            <button class="say" onclick={() => say(ex.fr)} aria-label="Hear the sentence"><Volume2 size={14} /></button>
            <span>
              <span class="fr-line">{ex.before}{#if ex.mark}<mark>{ex.mark}</mark>{/if}{ex.after}</span>
              <span class="muted small en-line">{ex.en}</span>
            </span>
          </li>
        {/each}
      </ul>
      <p class="muted tiny">Sentences from Tatoeba, CC BY 2.0 FR.</p>
    </section>
  {/if}

  {#if detail.hasForms && word.conj}
    <section class="panel">
      <button class="link toggle" onclick={() => (showForms = !showForms)} aria-expanded={showForms}>
        {#if showForms}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if} Forms
      </button>
      {#if showForms}<Conjugation conj={word.conj} wordKey={word.k} />{/if}
    </section>
  {/if}

  <section class="panel">
    <h2>Your cards</h2>
    {#if !detail.ladders.length}
      <p class="muted small">Not met yet. Study it next and it joins the next sitting.</p>
    {:else}
      <table class="ladders">
        <thead>
          <tr><th>channel</th><th>rung</th><th>state</th><th>stability</th><th>right</th><th>next</th></tr>
        </thead>
        <tbody>
          {#each detail.ladders as l (l.channel)}
            <tr>
              <td>{l.label}</td>
              <td>{l.rungLabel} <span class="muted">({l.step} of {l.of})</span></td>
              <td class:known={l.state === 'known'}>{l.state}{l.leech ? ' · leech' : ''}</td>
              <td>{days(l.stability)}</td>
              <td>{pct(l.accuracy)} <span class="muted">of {l.answers}</span></td>
              <td>{l.due}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
{/if}

<style>
  .centre { text-align: center; }
  .head { text-align: center; }
  h1.fr { font-size: 34px; margin: 4px 0 0; font-weight: 600; line-height: 1.2; }
  .ipa { color: var(--ipa); font-size: 17px; margin-top: 2px; }
  .meta { margin: 6px 0 12px; }
  .actions { display: flex; justify-content: center; align-items: center; gap: 10px; flex-wrap: wrap; }
  .status { font-size: 13px; color: var(--muted); }
  .status.known, td.known { color: var(--good); }
  .en { font-size: 17px; margin: 0 0 4px; }
  .defs { margin: 8px 0 0; padding-left: 20px; font-size: 14px; }
  .defs li + li { margin-top: 4px; }
  .sense { font-size: 15.5px; margin: 0 0 6px; }
  .chunks, .examples { list-style: none; margin: 0; padding: 0; }
  .chunks li { padding: 4px 0; }
  .examples li { display: flex; gap: 10px; align-items: flex-start; padding: 6px 0;
                 border-top: 1px solid var(--line); }
  .examples li:first-child { border-top: none; }
  .examples li > span { display: flex; flex-direction: column; }
  .say { border: none; background: none; color: var(--muted); padding: 2px; margin-top: 2px; }
  mark { background: none; color: var(--accent); font-weight: 600; }
  button.toggle { padding: 0; }
  .ladders { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .ladders th { text-align: left; font-weight: 500; color: var(--muted); font-size: 12px;
                text-transform: uppercase; letter-spacing: .05em; padding: 0 8px 6px 0; }
  .ladders td { padding: 6px 8px 6px 0; border-top: 1px solid var(--line); vertical-align: top; }
  a.button { display: inline-block; margin-top: 8px; color: var(--accent); }
</style>
