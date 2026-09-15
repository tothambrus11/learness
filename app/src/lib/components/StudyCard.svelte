<script lang="ts">
  /** One card, front and back.
   *
   *  This is everything the card *shows*: what it asks, what it answers, what
   *  it sounds like, what the word means and how the verb behaves. It has no
   *  idea whether the card is the one being answered or one being looked back
   *  at, and that is the point. The verb's forms once vanished when you
   *  pressed ← , because they were drawn inside the branch that draws the
   *  grading buttons and a card you are looking back at has none; nothing that
   *  can happen to the sitting is visible from in here, so it cannot happen
   *  again. And what is on it is not decided here either: `face()` in
   *  cardface.ts says which lines a card has in which state, and is tested
   *  over every rung both ways up; this draws each kind of line one way.
   *
   *  What the live card lets you *do* — say it aloud and compare, flag a
   *  mispronunciation — is passed in as `aids` and drawn at the foot of the
   *  panel. The screen decides when there are any.
   */
  import type { Snippet } from 'svelte';
  import { base } from '$app/paths';
  import Conjugation from './Conjugation.svelte';
  import Fr from './Fr.svelte';
  import Kbd from './Kbd.svelte';
  import VoiceWork from './VoiceWork.svelte';
  import { face, senses, taskOf } from '$lib/cardface.js';
  import { PHRASED } from '$lib/keys.js';
  import { listFields } from '$lib/wordform.js';
  import type { CardAudio } from '$lib/audio.js';
  import type { KeyContext } from '$lib/shortcuts.js';
  import type { Check } from '$lib/check.js';
  import type { StudyItem } from '$lib/queue.js';
  import AudioLines from '@lucide/svelte/icons/audio-lines';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Clock from '@lucide/svelte/icons/clock';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ear from '@lucide/svelte/icons/ear';
  import Eye from '@lucide/svelte/icons/eye';
  import Keyboard from '@lucide/svelte/icons/keyboard';
  import Mic from '@lucide/svelte/icons/mic';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import Pointer from '@lucide/svelte/icons/pointer';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Volume1 from '@lucide/svelte/icons/volume-1';
  import Volume2 from '@lucide/svelte/icons/volume-2';

  interface Props {
    /** The card and the word it is about. */
    item: StudyItem;
    /** The back of the card is showing. */
    revealed: boolean;
    /** What was typed into the answer box: the live answer, or what was typed
     *  into the card being looked back at. The card never writes it — it hands
     *  every keystroke to the screen, which knows which card is live. */
    typed: string;
    /** How the typed answer was judged, or null before the check. */
    verdict: Check | null;
    /** On a card answered by tapping: what has been tapped, in order. The
     *  first tap is the one that was graded; the rest were tries. */
    picked?: readonly string[];
    /** What this card can play. */
    audio: CardAudio;
    /** The sitting as the keyboard sees it, so every hint on the card is the
     *  key that works right now — with `alt` while the answer box is open. */
    keys: KeyContext;
    /** Both kept for the whole sitting rather than per card, so a learner who
     *  wants the definitions open keeps them open. */
    showDefs: boolean;
    showForms: boolean;
    /** The answer box, handed back so the screen can put the cursor in it. */
    input: HTMLInputElement | null;
    /** The answer box changed. */
    onTyped: (value: string) => void;
    /** The answer was submitted from the card. */
    onCheck: () => void;
    /** An option was tapped on a card answered by tapping. */
    onPick?: (option: string) => void;
    /** A clip was made on the device for this word, so what it can play has
     *  changed. */
    onVoiceDone: () => void;
    /** What the live card asks of you, drawn at the foot of the panel. */
    aids?: Snippet;
  }

  let {
    item, revealed, typed, verdict, audio, keys, picked = [],
    showDefs = $bindable(true), showForms = $bindable(false), input = $bindable(null),
    onTyped, onCheck, onPick = () => {}, onVoiceDone, aids,
  }: Props = $props();

  let w = $derived(item.word);
  let rung = $derived(item.card.rung);

  /* What is on the card, line by line, is face()'s answer; this file draws
     each kind of line one way and decides nothing else. */
  let lines = $derived(face(item, { revealed, typed, verdict, picked }));
  let task = $derived(taskOf(rung));
  const ICON = { eye: Eye, mic: Mic, keyboard: Keyboard, ear: Ear, pen: PenLine,
    book: BookOpen, pointer: Pointer, clock: Clock };
  /* The digit that taps each option, read off the same table as every other
     hint: the first four rows are pick1..pick4. */
  const PICK = ['pick1', 'pick2', 'pick3', 'pick4'] as const;
  let TaskIcon = $derived(ICON[task.icon]);
</script>

<!-- the question's language and form, the action, the answer's language -->
<div class="task" aria-label="{task.verb}: {task.from === 'fr' ? 'French' : 'English'} to {task.to === 'fr' ? 'French' : 'English'}">
  <span class="lang {task.from}">
    {#if task.heard}<Volume2 size={13} />{:else}<Eye size={13} />{/if}
    {task.from === 'fr' ? 'FR' : 'EN'}
  </span>
  <span class="arrow">→</span>
  <span class="verb"><TaskIcon size={15} /> {task.verb}</span>
  <span class="arrow">→</span>
  <span class="lang {task.to}">{task.to === 'fr' ? 'FR' : 'EN'}</span>
</div>

<section class="panel card">
  {#each lines as line, i (i)}
    {#if line.kind === 'prompt-fr'}
      <div class="prompt" class:small={line.small}>
        <Fr text={line.text} gender={line.gender} number={line.number} />
      </div>
    {:else if line.kind === 'prompt-en'}
      <div class="prompt">{line.text}</div>
    {:else if line.kind === 'sentence'}
      <div class="sentence">
        {line.before}<span class="gap" class:filled={line.filled}>{line.filled ? line.gap : '    '}</span>{line.after}
      </div>
    {:else if line.kind === 'speaker'}
      <button class="speaker" onclick={() => audio.play()}>
        <Volume2 size={44} />
        <span class="again">Play it again <Kbd id="playModel" {keys} /></span>
      </button>
    {:else if line.kind === 'hint'}
      <div class="hint">{line.text}</div>
    {:else if line.kind === 'status'}
      <div class="status muted">{line.text}</div>
    {:else if line.kind === 'box'}
      <input bind:this={input} value={typed} oninput={(e) => onTyped(e.currentTarget.value)}
             type="text" placeholder={line.placeholder} autocomplete="off" autocapitalize="none"
             autocorrect="off" spellcheck="false" />
      <button class="primary" onclick={onCheck}>Check</button>
    {:else if line.kind === 'verdict'}
      <div class="verdict" class:ok={line.ok}>{line.text}</div>
    {:else if line.kind === 'answer-fr'}
      <div class="answer fr"><Fr text={line.text} gender={line.gender} number={line.number} /></div>
    {:else if line.kind === 'ipa'}
      <div class="ipa">{line.text}</div>
    {:else if line.kind === 'answer-en'}
      <div class="answer">{line.text}</div>
    {:else if line.kind === 'alts'}
      <div class="alts">{line.text}</div>
    {:else if line.kind === 'wrote'}
      <div class="alts">you wrote <b>{line.text}</b></div>
    {:else if line.kind === 'sense'}
      <div class="sense">{line.text}</div>
    {:else if line.kind === 'marked'}
      <div class="sentence">{line.before}<mark>{line.mark}</mark>{line.after}</div>
    {:else if line.kind === 'options'}
      <div class="options" class:column={line.column}>
        {#each line.options as option, n (option.value)}
          <button class="option" class:wrong={option.wrong} disabled={option.wrong}
                  onclick={() => onPick(option.value)}>
            {option.text}{#if PICK[n]}<Kbd id={PICK[n]} {keys} />{/if}
          </button>
        {/each}
      </div>
    {:else if line.kind === 'form'}
      <div class="answer fr">{line.lead}{line.stem}<span class="ending">{line.ending}</span></div>
      {#if line.also}<div class="alts">or {line.also}</div>{/if}
    {:else if line.kind === 'tapped'}
      <div class="alts">you tapped <b>{line.text}</b> first</div>
    {:else if line.kind === 'chunks'}
      <ul class="chunks">
        {#each line.items as chunk (chunk.fr)}<li><b>{chunk.fr}</b> <span class="muted">{chunk.en}</span></li>{/each}
      </ul>
    {/if}
  {/each}

  {#if w.missing?.length}
    <!-- A card with no English cannot be asked in either direction. It is
         said here rather than shown as a blank, and fixed on the words
         screen, where the word keeps its history. -->
    <p class="incomplete">
      <TriangleAlert size={15} />
      This word has no {listFields(w.missing)} yet.
      <a href="{base}/words/">Fix it</a>
    </p>
  {/if}
  {#if w.user}
    <!-- Missing audio, or audio made before the word was corrected: said on
         the card, and made from the card. -->
    <div class="card-voice"><VoiceWork words={[w]} onDone={onVoiceDone} /></div>
  {/if}
  {#if revealed && w.note}<div class="alts">{w.note}</div>{/if}
  {#if revealed && (w.def?.fr?.length || senses(w).length)}
    <!-- What the word means, in French first: a sentence of French about a
         word just met is the cheapest reading in the deck. The English side
         is the full list of senses, which is what the source has — English
         Wiktionary glosses a French word rather than defining it — so it says
         "senses" and drops the ones already on the card rather than printing
         the answer back at you. -->
    <div class="defs" class:closed={!showDefs}>
      <button class="defs-toggle" onclick={() => (showDefs = !showDefs)} aria-expanded={showDefs}>
        {#if showDefs}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
        Definition <Kbd id="toggleDefs" {keys} />
      </button>
      {#if showDefs}
        {#if w.def?.fr?.length}
          <ol class="def fr-def">
            {#each w.def.fr as line}<li><span class="lang fr">FR</span> {line}</li>{/each}
          </ol>
        {/if}
        {#if senses(w).length}
          <p class="def en-line"><span class="lang en">EN</span> {senses(w).join(' · ')}</p>
        {/if}
      {/if}
    </div>
  {/if}
  {#if revealed && (audio.has.fr || audio.spoken || audio.canCue)}
    <div class="audio">
      {#if audio.has.fr || audio.spoken}
        <button class="chip" onclick={audio.playModel} disabled={audio.making}>
          <Volume2 size={15} />
          {audio.making ? 'Making it…'
            : rung === 'voice' ? 'Hear the form' : PHRASED.has(rung) ? 'Hear the sentence' : 'Hear again'}
          <Kbd id="playModel" {keys} />
        </button>
      {/if}
      {#if audio.has.native}
        <button class="chip" onclick={() => audio.play('native')}>
          <AudioLines size={15} /> Native speaker <Kbd id="playNative" {keys} />
        </button>
      {/if}
      <!-- The English is offered on every back, including the two cards asked
           by ear: "listen, recall the English" used to be the one card whose
           answer could not be heard. Where the word has no recorded cue the
           device says it. -->
      {#if audio.canCue}
        <button class="chip" onclick={audio.cue}><Volume1 size={15} /> English <Kbd id="cue" {keys} /></button>
      {/if}
    </div>
  {/if}
  {#if audio.trouble}
    <!-- A recording the server no longer has used to fail in the console and
         nowhere else: the button did nothing, twice, and the card moved on. -->
    <p class="incomplete"><TriangleAlert size={15} /> {audio.trouble}</p>
  {/if}
  {#if revealed && w.conj}
    <!-- The verb's own behaviour, which is most of what there is to learn
         about a verb. It belongs to the card, not to the row of buttons under
         it: that is how it came to be missing from a card looked back at. -->
    <div class="forms">
      <button class="forms-toggle" onclick={() => (showForms = !showForms)}
              aria-expanded={showForms}>
        {#if showForms}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if} Verb forms
      </button>
      {#if showForms}
        <div class="forms-table"><Conjugation conj={w.conj} wordKey={w.k} /></div>
      {/if}
    </div>
  {/if}
  {@render aids?.()}
</section>

<style>
  /* The task strip: FR in the accent, EN in ink, the action between. */
  .task { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          font-size: 13px; margin: 0 0 10px; color: var(--muted); }
  .task .verb { display: inline-flex; align-items: center; gap: 6px; color: var(--ink);
                font-weight: 500; }
  .task .arrow { opacity: .5; }
  .lang { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700;
          letter-spacing: .06em; padding: 3px 8px; border-radius: 999px; line-height: 1; }
  .lang.fr { background: var(--accent); color: var(--on-accent); }
  .lang.en { background: var(--ink); color: var(--bg); }
  .small { font-size: 12px; }
  .defs { width: 100%; text-align: left; margin-top: 6px; border-top: 1px solid var(--line);
          padding-top: 6px; }
  .defs-toggle { display: inline-flex; align-items: center; gap: 4px; border: none;
                 background: none; color: var(--muted); font: inherit; font-size: 12.5px;
                 padding: 4px 0; cursor: pointer; }
  .def { list-style: none; margin: 4px 0 6px; padding: 0; font-size: 14.5px; line-height: 1.45; }
  .def li { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; }
  /* The English side is senses, not definitions, and there is rarely more than
     a handful: one line, not a list with a badge on every row. */
  .en-line { display: flex; gap: 8px; align-items: baseline; color: var(--muted); }
  .def .lang { flex: 0 0 auto; font-size: 10px; padding: 2px 6px; }
  .fr-def li { color: var(--ink); }
  .def:not(.fr-def) li { color: var(--muted); }
  .incomplete { display: flex; align-items: center; justify-content: center; gap: 8px;
                flex-wrap: wrap; font-size: 13.5px; color: var(--warn); margin: 0; }
  .incomplete a { color: var(--warn); }
  .card-voice { width: 100%; }
  .panel { padding: 22px 18px; margin-bottom: 0; }
  .card { min-height: 240px; display: flex; flex-direction: column;
          justify-content: center; align-items: center; gap: 10px; text-align: center; }
  .prompt { font-size: 34px; font-weight: 650; letter-spacing: -.02em; }
  .prompt.small { font-size: 24px; }
  .answer { font-size: 26px; font-weight: 650; color: var(--good); }
  .answer.fr { color: var(--ink); }
  .status { font-size: 18px; margin-top: 6px; }
  .sentence { font-size: 24px; line-height: 1.4; font-weight: 500; }
  .sentence mark { background: none; color: var(--accent); font-weight: 650; }
  /* The one line of English a function word is met with: prose, not a gloss. */
  .sense { font-size: 15.5px; color: var(--ink); max-width: 30em; line-height: 1.4; }
  .ending { color: var(--accent); }
  /* The tap answers: a row of a few words, or a column of a few times. */
  .options { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; width: 100%;
             margin-top: 6px; }
  .options.column { flex-direction: column; }
  .option { flex: 1 1 28%; font-size: 19px; font-weight: 600; padding: 14px 10px; }
  .options.column .option { flex-basis: 100%; font-size: 16px; }
  .option.wrong { opacity: .4; text-decoration: line-through; cursor: default; }
  .gap { display: inline-block; min-width: 3.2em; border-bottom: 2px solid var(--accent);
         color: var(--good); font-weight: 650; }
  .gap.filled { border-bottom-color: transparent; }
  .ipa { color: var(--ipa); font-size: 17px; font-family: Georgia, serif; }
  .alts { color: var(--muted); font-size: 14px; }
  .chunks { list-style: none; margin: 4px 0 0; padding: 0; font-size: 14px; }
  .chunks li { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .hint { color: var(--muted); font-size: 13px; }
  .verdict { font-size: 16px; font-weight: 650; color: var(--bad); }
  .verdict.ok { color: var(--good); }
  .speaker { display: flex; flex-direction: column; align-items: center; gap: 8px;
             background: none; border: none; cursor: pointer; padding: 10px;
             color: var(--accent); }
  .speaker .again { font-size: 13px; font-weight: 600; color: var(--muted); }
  .speaker:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px;
                           border-radius: 12px; }
  .audio { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: center; }
  .forms { width: 100%; }
  .forms-toggle { display: flex; justify-content: flex-start; width: 100%; margin-top: 6px;
                  text-align: left; border: none; background: none; color: var(--accent);
                  padding: 8px 4px; font-size: 14px; }
  .forms-table { border: 1px solid var(--line); border-radius: 12px; padding: 14px;
                 margin-top: 4px; text-align: left; }
  input { font-size: 20px; text-align: center; width: 100%; padding: 11px; }
</style>
