<script>
  /** One sitting. Each card shows the exercise for the rung its word has
   *  reached: recognise it, say it and check, write it, hear it for meaning,
   *  write down what was said. The card behaves the same way throughout —
   *  prompt, reveal, grade, look back — only what it asks changes.
   *
   *  With ?walk=1 the keyboard is taken away: only the rungs you can answer by
   *  speaking and tapping, the English cue read aloud, larger targets. It is
   *  the same queue, not a different deck.
   */
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { checkCloze, checkEnglish, checkFrench, ratingFor } from '$lib/check.js';
  import { answer, buildSession } from '$lib/session.js';
  import { RUNG_LABEL, TYPED } from '$lib/keys.js';
  import { hush, keepAwake, say } from '$lib/speech.js';
  import Conjugation from '$lib/components/Conjugation.svelte';
  import Fr from '$lib/components/Fr.svelte';
  import { prefetchMedia } from '$lib/prefetch.js';
  import { srcFor } from '$lib/audio.js';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import AudioLines from '@lucide/svelte/icons/audio-lines';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ear from '@lucide/svelte/icons/ear';
  import Eye from '@lucide/svelte/icons/eye';
  import Keyboard from '@lucide/svelte/icons/keyboard';
  import Mic from '@lucide/svelte/icons/mic';
  import MicOff from '@lucide/svelte/icons/mic-off';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import Volume1 from '@lucide/svelte/icons/volume-1';
  import Volume2 from '@lucide/svelte/icons/volume-2';

  const walk = page.url.searchParams.get('walk') === '1';

  let loading = $state(true);
  let showForms = $state(false);     /* stays as you left it for the whole sitting */
  let showDefs = $state(true);       /* the definitions on the back; likewise remembered */
  let error = $state('');
  let items = $state([]);
  let settings = $state(null);
  let i = $state(0);
  let revealed = $state(false);
  let typed = $state('');
  let verdict = $state(null);
  /* Said aloud before the flip and it came out wrong. A flag beside the grade,
     never part of it: the grade is about the memory the card tests, and this
     is about a different one. */
  let saidWrong = $state(false);
  let notice = $state('');
  let done = $state({ answered: 0, right: 0, learned: 0, promoted: 0, heard: 0 });
  let startedAt = 0;
  let input = $state(null);
  let releaseWake = () => {};

  /* Every card answered this sitting, oldest first, so you can look back at
     one you graded too quickly. Looking back changes nothing: the grade
     stands, and the live card waits where it was. */
  let history = $state([]);
  let back = $state(null);            /* index into history, or null when live */
  let browsing = $derived(back !== null);

  let current = $derived(items[i] ?? null);
  let left = $derived(items.length - i);
  let finished = $derived(!loading && !error && (!items.length || i >= items.length));

  /* What is on screen: the live card, or the one being looked back at. */
  let past = $derived(browsing ? history[back] : null);
  let shown = $derived(past ? past.item : current);
  let shownRevealed = $derived(browsing || revealed);
  let shownTyped = $derived(past ? past.typed : typed);
  let shownVerdict = $derived(past ? past.verdict : verdict);

  let stopPrefetch = () => {};
  onDestroy(() => { stopPrefetch(); hush(); releaseWake(); });

  onMount(async () => {
    try {
      const built = await buildSession({ handsFree: walk });
      items = built.items;
      settings = built.settings;
      stopPrefetch = prefetchMedia(items.flatMap((it) =>
        [it.word.audio || it.word.native, walk ? it.word.cue_audio : null])).stop;
      if (walk) keepAwake().then((release) => { releaseWake = release; });
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
      startedAt = Date.now();
      queueMicrotask(resume);
    }
  });

  const typing = (rung) => TYPED.has(rung);
  const cueOf = (w) => w.cue ?? w.en[0].split(';')[0].trim();

  /* The sentence a "use it" card blanks: chosen once per card, so looking back
     shows the one you were asked. */
  const sentenceFor = (item) => {
    const ex = item?.word?.ex;
    if (!ex?.length) return null;
    return ex[item.card.reps % ex.length];
  };
  /** The sentence with its word taken out, as text before and after the gap. */
  function blank(sentence) {
    const re = new RegExp(`(^|[^\\p{L}])(${sentence.f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}])`, 'iu');
    const m = re.exec(sentence.fr);
    if (!m) return { before: sentence.fr, after: '' };
    const at = m.index + m[1].length;
    return { before: sentence.fr.slice(0, at), after: sentence.fr.slice(at + m[2].length) };
  }

  /* What this card can play: files for catalogue words, clips made on this
     device for your own. Resolved once per card. */
  let has = $state({ fr: false, native: false, en: false });
  $effect(() => {
    const w = shown?.word;
    has = { fr: false, native: false, en: false };
    if (!w) return;
    Promise.all([srcFor(w, 'fr'), srcFor(w, 'en')]).then(([fr, en]) => {
      if (shown?.word === w) has = { fr: !!fr, native: !!w.native, en: !!en };
    });
  });

  /** kind: 'fr' | 'native' | 'en'. */
  async function play(kind = 'fr') {
    const src = await srcFor(shown?.word, kind);
    if (!src) return false;
    return new Promise((resolve) => {
      const a = new Audio(src);
      a.onended = () => resolve(true);
      a.onerror = () => resolve(false);
      a.play().catch(() => resolve(false));
    });
  }

  /* The English cue, spoken: the clip, or the browser's voice for a word
     without one. */
  async function cue() {
    const w = shown?.word;
    if (!w) return;
    if (!(await play('en'))) await say(cueOf(w));
  }

  function reveal() {
    revealed = true;
    const rung = current.card.rung;
    if (rung === 'recognise' || rung === 'say') play();
  }

  function check() {
    const { word, card } = current;
    const sentence = card.rung === 'use' ? sentenceFor(current) : null;
    verdict = sentence ? checkCloze(typed, sentence.f)
      : card.rung === 'hear' ? checkEnglish(typed, word)
        : checkFrench(typed, word);
    revealed = true;
    /* On a card where the French was produced from the English, the model is
       held back: say it first, then hear it and compare. Dictation already
       played it; hearing it again straight away costs nothing. */
    if (!SAY_FIRST.has(card.rung)) play();
  }

  /** Rungs where the answer is typed from the English, so the spoken form is
   *  yours to check against the model afterwards. */
  const SAY_FIRST = new Set(['write', 'use']);

  /* A second tap while the first answer is still being written would grade
     the same card twice and skip the next one. */
  let grading = $state(false);
  async function record(rating) {
    if (grading || !current) return;
    grading = true;
    const { card, word } = current;
    let res;
    try {
      res = await answer(card, word, rating, settings, Date.now() - startedAt,
        { mispronounced: saidWrong });
    } finally {
      grading = false;
    }
    done.answered += 1;
    if (rating >= 3) done.right += 1;
    if (res.justLearned) done.learned += 1;
    if (res.promoted) { done.promoted += 1; flash(`Moved up: ${RUNG_LABEL[res.promoted]}`); }
    if (res.heardOpened) { done.heard += 1; flash('You said it, so now you will hear it too'); }
    /* Anything you could not recall comes back before the session ends. */
    if (rating === 1) items = [...items, { ...current, card: res.card }];
    history = [...history, { item: current, rating, typed, verdict }];
    i += 1;
    revealed = false;
    typed = '';
    verdict = null;
    saidWrong = false;
    startedAt = Date.now();
    queueMicrotask(resume);
  }

  let flashTimer = null;
  function flash(text) {
    notice = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { notice = ''; }, 2600);
  }

  /* Cue the live card: focus the box, play the audio prompt, or on a walk,
     read out the English. */
  function resume() {
    if (!current) return;
    const rung = current.card.rung;
    if (typing(rung)) input?.focus();
    if (rung === 'hear' || rung === 'dictate') play();
    else if (walk && rung === 'say') cue();
  }

  /** Step back one card, further back, or return to the live card. */
  function lookBack(step) {
    const at = browsing ? back : history.length;
    const next = at + step;
    if (next < 0) return;
    if (next >= history.length) {
      /* Time spent looking back is not time spent on the live card. */
      back = null;
      startedAt = Date.now();
      queueMicrotask(resume);
    } else {
      back = next;
    }
  }

  function onKey(event) {
    if (event.key !== 'Enter') return;
    if (!revealed && typing(current.card.rung)) check();
  }

  /* The whole sitting from the keyboard. 1–4 grade; space flips the card, or
     comes back to the live one when looking back; ← and → walk the history;
     s, n and e play the French, the native recording and the English; p flags
     a mispronunciation. Keys typed into the answer box belong to the box. The
     French is never played before the flip on a card whose answer it is. */
  function onGlobalKey(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const t = event.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
      || t.isContentEditable)) return;
    if (loading || finished || !shown) return;
    const key = event.key;
    const rung = shown.card.rung;
    const heardFirst = rung === 'hear' || rung === 'dictate';
    let handled = true;
    if (key === 'ArrowLeft') lookBack(-1);
    else if (key === 'ArrowRight') { if (browsing) lookBack(1); else handled = false; }
    else if (key === ' ' || key === 'Enter') {
      if (browsing) lookBack(history.length);
      else if (!revealed && !typing(rung)) reveal();
      else handled = false;
    }
    else if (key === 's' && has.fr && (revealed || heardFirst)) play();
    else if (key === 'n' && has.native && (revealed || heardFirst)) play('native');
    else if (key === 'e' && (has.en || walk) && !heardFirst) cue();
    else if (browsing) handled = false;
    else if (key.length === 1 && '1234'.includes(key) && revealed) record(Number(key));
    else if (key === 'p' && revealed && has.fr) saidWrong = !saidWrong;
    else if (key === 'd' && revealed) showDefs = !showDefs;
    else handled = false;
    if (handled) event.preventDefault();
  }

  const RATING_NAME = ['', 'Again', 'Hard', 'Good', 'Easy'];

  /* What each rung asks, at a glance: which language the question is in,
     whether it is read or heard, what you do, and which language the answer
     is in. The card can look the same across rungs — an English word on
     top — while asking for something different, so this is said in pictures
     before the word is read. */
  const TASK = {
    recognise: { from: 'fr', heard: false, icon: Eye, verb: 'Read it, recall the English', to: 'en' },
    say: { from: 'en', heard: false, icon: Mic, verb: 'Say it in French, then check', to: 'fr' },
    write: { from: 'en', heard: false, icon: Keyboard, verb: 'Type the French, then say it', to: 'fr' },
    hear: { from: 'fr', heard: true, icon: Ear, verb: 'Listen, recall the English', to: 'en' },
    dictate: { from: 'fr', heard: true, icon: Keyboard, verb: 'Listen, type what you heard', to: 'fr' },
    use: { from: 'fr', heard: false, icon: PenLine, verb: 'Fill the gap in the sentence', to: 'fr' },
  };

  const verdictText = {
    ok: 'Correct',
    accent: 'Right, mind the accents',
    article: 'Right, mind the article',
    close: 'Almost, a typo',
    no: 'Not quite',
  };
</script>

<svelte:window onkeydown={onGlobalKey} />

<header>
  <button class="link" onclick={() => goto(`${base}/`)}><ArrowLeft size={14} /> Home</button>
  {#if !finished && !loading && current}
    <span class="right">
      {#if history.length}
        <button class="link" onclick={() => lookBack(-1)} disabled={back === 0}
                aria-label="Previous card"><ChevronLeft size={14} /> Previous <kbd>←</kbd></button>
      {/if}
      <span class="left">{left} left</span>
    </span>
  {/if}
</header>

{#if loading}
  <p class="muted">Preparing a {walk ? 'walk' : 'session'}…</p>
{:else if error}
  <p class="error">{error}</p>
{:else if finished}
  <section class="panel done">
    <h1>{done.answered ? (walk ? 'Walk done' : 'Session done') : 'Nothing due'}</h1>
    {#if done.answered}
      <p class="big">{done.right} / {done.answered} right</p>
      {#if done.promoted}<p class="good"><ArrowUp size={15} /> {done.promoted} word{done.promoted === 1 ? '' : 's'} moved up a rung</p>{/if}
      {#if done.heard}<p class="good"><Ear size={15} /> {done.heard} now practised by ear too</p>{/if}
      {#if done.learned}<p class="good">{done.learned} words now known</p>{/if}
    {:else if walk}
      <p class="muted">
        Nothing on the walk right now: no card you could answer by speaking is
        due. Words reach the walk once you have met them.
      </p>
    {:else}
      <p class="muted">
        Nothing is due and no new words are allowed today. The daily allowance
        is worked out from how much is already due and how well recall has been
        going.
      </p>
    {/if}
    <button class="primary" onclick={() => goto(`${base}/`)}>Home</button>
  </section>
{:else if shown}
  {@const w = shown.word}
  {@const rung = shown.card.rung}
  {@const revealed = shownRevealed}
  {@const verdict = shownVerdict}
  {@const task = TASK[rung] ?? TASK.write}
  {#if browsing}
    <p class="dir">Looking back · {history.length - back} card{history.length - back === 1 ? '' : 's'} ago</p>
  {/if}
  <!-- the question's language and form, the action, the answer's language -->
  <div class="task" aria-label="{task.verb}: {task.from === 'fr' ? 'French' : 'English'} to {task.to === 'fr' ? 'French' : 'English'}">
    <span class="lang {task.from}">
      {#if task.heard}<Volume2 size={13} />{:else}<Eye size={13} />{/if}
      {task.from === 'fr' ? 'FR' : 'EN'}
    </span>
    <span class="arrow">→</span>
    <span class="verb"><task.icon size={15} /> {task.verb}</span>
    <span class="arrow">→</span>
    <span class="lang {task.to}">{task.to === 'fr' ? 'FR' : 'EN'}</span>
    {#if walk}<span class="muted small">· walk</span>{/if}
  </div>
  {#if notice}<p class="notice">{notice}</p>{/if}

  <section class="panel card" class:walk>
    {#if rung === 'recognise'}
      <div class="prompt"><Fr text={w.fr} gender={w.gender} /></div>
      {#if revealed}
        <div class="ipa">{w.ipa}</div>
        <div class="answer">{w.en[0]}</div>
        {#if w.en.length > 1}<div class="alts">{w.en.slice(1, 4).join(' · ')}</div>{/if}
      {/if}

    {:else if rung === 'say'}
      <div class="prompt">{cueOf(w)}</div>
      <!-- the article is part of the answer, so the gender waits for the reveal -->
      <div class="hint">{w.pos}{revealed && w.gender ? `, ${w.gender}` : ''}</div>
      {#if !revealed}
        <div class="status muted">Say it in French, then</div>
      {:else}
        <div class="answer fr"><Fr text={w.answer} gender={w.gender} /></div>
        <div class="ipa">{w.ipa}</div>
      {/if}

    {:else if rung === 'hear'}
      <button class="speaker" onclick={() => play()} aria-label="Play"><Volume2 size={44} /></button>
      {#if revealed}
        <div class="prompt small"><Fr text={w.fr} gender={w.gender} /></div>
        <div class="ipa">{w.ipa}</div>
        <div class="answer">{w.en[0]}</div>
      {/if}

    {:else if rung === 'use' && sentenceFor(shown)}
      {@const s = sentenceFor(shown)}
      {@const gap = blank(s)}
      <!-- a real sentence with the word taken out; the English says what it means -->
      <div class="sentence">
        {gap.before}<span class="gap" class:filled={revealed}>{revealed ? s.f : '    '}</span>{gap.after}
      </div>
      <div class="hint">{s.en}</div>
      <div class="alts">{w.en[0]}{revealed && w.gender ? ` · ${w.gender}` : ''}</div>
      {#if !revealed}
        <input bind:this={input} bind:value={typed} onkeydown={onKey} type="text"
               placeholder="the missing word" autocomplete="off" autocapitalize="none"
               autocorrect="off" spellcheck="false" />
        <button class="primary" onclick={check}>Check</button>
      {:else}
        <div class="verdict" class:ok={verdict && verdict.verdict !== 'no'}>
          {verdictText[verdict?.verdict] ?? ''}
        </div>
        <div class="answer fr"><Fr text={w.answer} gender={w.gender} /></div>
        <div class="ipa">{w.ipa}</div>
        {#if shownTyped && verdict?.verdict !== 'ok'}
          <div class="alts">you wrote <b>{shownTyped}</b></div>
        {/if}
      {/if}

    {:else}
      <!-- write, dictate: the French is typed -->
      {#if rung === 'dictate'}
        <button class="speaker" onclick={() => play()} aria-label="Play"><Volume2 size={44} /></button>
      {:else}
        <div class="prompt">{w.en[0]}</div>
      {/if}
      <!-- the article is part of the answer, so the gender waits for the reveal -->
      <div class="hint">{w.pos}{revealed && w.gender ? `, ${w.gender}` : ''}</div>
      {#if !revealed}
        <input bind:this={input} bind:value={typed} onkeydown={onKey} type="text"
               placeholder="type the French" autocomplete="off" autocapitalize="none"
               autocorrect="off" spellcheck="false" />
        <button class="primary" onclick={check}>Check</button>
      {:else}
        <div class="verdict" class:ok={verdict && verdict.verdict !== 'no'}>
          {verdictText[verdict?.verdict] ?? ''}
        </div>
        <div class="answer fr"><Fr text={w.answer} gender={w.gender} /></div>
        <div class="ipa">{w.ipa}</div>
        {#if shownTyped && verdict?.verdict !== 'ok'}
          <div class="alts">you wrote <b>{shownTyped}</b></div>
        {/if}
      {/if}
    {/if}

    {#if revealed && w.note}<div class="alts">{w.note}</div>{/if}
    {#if revealed && !browsing && SAY_FIRST.has(rung) && has.fr}
      <div class="say-first">
        <Mic size={14} /> Now say it aloud, then
        <button class="chip primary" onclick={() => play()}><Volume2 size={14} /> hear it <kbd>s</kbd></button>
        and compare
      </div>
    {/if}
    {#if revealed && w.def && (w.def.fr?.length || w.def.en?.length)}
      <!-- what the word means, in French first: a sentence of French about a
           word just met is the cheapest reading in the deck -->
      <div class="defs" class:closed={!showDefs}>
        <button class="defs-toggle" onclick={() => (showDefs = !showDefs)} aria-expanded={showDefs}>
          {#if showDefs}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
          Definition <kbd>d</kbd>
        </button>
        {#if showDefs}
          {#if w.def.fr?.length}
            <ol class="def fr-def">
              {#each w.def.fr as line}<li><span class="lang fr">FR</span> {line}</li>{/each}
            </ol>
          {/if}
          {#if w.def.en?.length}
            <ol class="def">
              {#each w.def.en as line}<li><span class="lang en">EN</span> {line}</li>{/each}
            </ol>
          {/if}
        {/if}
      </div>
    {/if}
    {#if revealed && (has.fr || has.en)}
      <div class="audio">
        {#if has.fr}
          <button class="chip" onclick={() => play()}><Volume2 size={15} /> Hear again <kbd>s</kbd></button>
        {/if}
        {#if has.native}
          <button class="chip" onclick={() => play('native')}><AudioLines size={15} /> Native speaker <kbd>n</kbd></button>
        {/if}
        {#if has.en || walk}
          <button class="chip" onclick={cue}><Volume1 size={15} /> English <kbd>e</kbd></button>
        {/if}
        {#if !browsing && has.fr}
          <button class="chip flag" class:on={saidWrong} aria-pressed={saidWrong}
                  onclick={() => (saidWrong = !saidWrong)}>
            <MicOff size={15} /> I said it wrong <kbd>p</kbd>
          </button>
        {/if}
      </div>
    {/if}
  </section>

  {#if browsing}
    <p class="muted tiny">
      {RUNG_LABEL[rung] ?? rung} · you answered <b>{RATING_NAME[past.rating]}</b>
    </p>
    <div class="grades nav">
      <button onclick={() => lookBack(-1)} disabled={back === 0}>
        <ChevronLeft size={16} /> Older <kbd>←</kbd>
      </button>
      <button onclick={() => lookBack(1)}>
        Newer <kbd>→</kbd>
      </button>
      <button class="primary" onclick={() => lookBack(history.length)}>Continue <kbd>space</kbd></button>
    </div>
  {:else if !revealed && !typing(rung)}
    <button class="primary wide" class:big={walk} onclick={reveal}>Show <kbd>space</kbd></button>
  {:else if revealed}
    <div class="grades" class:walk>
      <button onclick={() => record(1)} class="again" disabled={grading}>Again <kbd>1</kbd></button>
      <button onclick={() => record(2)} disabled={grading}>Hard <kbd>2</kbd></button>
      <button onclick={() => record(3)} disabled={grading}>Good <kbd>3</kbd></button>
      <button onclick={() => record(4)} class="easy" disabled={grading}>Easy <kbd>4</kbd></button>
    </div>
    {#if verdict}
      <p class="muted tiny">
        Suggested: {['', 'Again', 'Hard', 'Good', 'Good'][ratingFor(verdict.verdict)]}
      </p>
    {/if}

    {#if w.conj && !walk}
      <button class="forms-toggle" onclick={() => (showForms = !showForms)}
              aria-expanded={showForms}>
        {#if showForms}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if} Verb forms
      </button>
      {#if showForms}
        <section class="panel forms"><Conjugation conj={w.conj} /></section>
      {/if}
    {/if}
  {/if}
{/if}

<style>
  header { display: flex; justify-content: space-between; align-items: center;
           margin-bottom: 12px; }
  .left { color: var(--muted); font-size: 13px; }
  .right { display: flex; align-items: center; gap: 14px; }
  .right button.link { display: inline-flex; align-items: center; gap: 3px; }
  .right button.link:disabled { opacity: .4; cursor: default; }
  .dir { color: var(--muted); font-size: 12px; text-transform: uppercase;
         letter-spacing: .07em; margin: 0 0 8px; }
  /* The task strip: FR in the accent, EN in ink, the action between. */
  .task { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          font-size: 13px; margin: 0 0 10px; color: var(--muted); }
  .task .verb { display: inline-flex; align-items: center; gap: 6px; color: var(--ink);
                font-weight: 500; }
  .task .arrow { opacity: .5; }
  .lang { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700;
          letter-spacing: .06em; padding: 3px 8px; border-radius: 999px; line-height: 1; }
  .lang.fr { background: var(--accent); color: #fff; }
  .lang.en { background: var(--ink); color: var(--bg); }
  .small { font-size: 12px; }
  .say-first { display: flex; align-items: center; justify-content: center; gap: 6px;
               flex-wrap: wrap; font-size: 14px; color: var(--ink); margin-top: 4px; }
  .say-first .chip.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .defs { width: 100%; text-align: left; margin-top: 6px; border-top: 1px solid var(--line);
          padding-top: 6px; }
  .defs-toggle { display: inline-flex; align-items: center; gap: 4px; border: none;
                 background: none; color: var(--muted); font: inherit; font-size: 12.5px;
                 padding: 4px 0; cursor: pointer; }
  .def { list-style: none; margin: 4px 0 6px; padding: 0; font-size: 14.5px; line-height: 1.45; }
  .def li { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; }
  .def .lang { flex: 0 0 auto; font-size: 10px; padding: 2px 6px; }
  .fr-def li { color: var(--ink); }
  .def:not(.fr-def) li { color: var(--muted); }
  .notice { font-size: 13px; color: var(--good); background: var(--panel);
            border: 1px solid var(--good); border-radius: 10px; padding: 8px 12px;
            margin: 0 0 10px; }
  .panel { background: var(--panel); border: 1px solid var(--line);
           border-radius: 14px; padding: 22px 18px; }
  .card { min-height: 240px; display: flex; flex-direction: column;
          justify-content: center; align-items: center; gap: 10px; text-align: center; }
  .card.walk { min-height: 52vh; }
  .prompt { font-size: 34px; font-weight: 650; letter-spacing: -.02em; }
  .walk .prompt { font-size: 38px; line-height: 1.15; }
  .prompt.small { font-size: 24px; }
  .answer { font-size: 26px; font-weight: 650; color: var(--good); }
  .answer.fr { color: var(--ink); }
  .walk .answer { font-size: 32px; }
  .status { font-size: 18px; margin-top: 6px; }
  .sentence { font-size: 24px; line-height: 1.4; font-weight: 500; }
  .gap { display: inline-block; min-width: 3.2em; border-bottom: 2px solid var(--accent);
         color: var(--good); font-weight: 650; }
  .gap.filled { border-bottom-color: transparent; }
  .ipa { color: #b45309; font-size: 17px; font-family: Georgia, serif; }
  .alts { color: var(--muted); font-size: 14px; }
  .hint { color: var(--muted); font-size: 13px; }
  .verdict { font-size: 16px; font-weight: 650; color: var(--bad); }
  .verdict.ok { color: var(--good); }
  .speaker { background: none; border: none; cursor: pointer; padding: 10px; color: var(--accent); }
  .audio { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: center; }
  .chip { font-size: 13px; padding: 6px 12px; border-radius: 999px; font-weight: 500; }
  .chip.on { background: var(--warn); color: #fff; border-color: var(--warn); }
  /* Key hints, for the keyboard that has one; a phone gets none. */
  kbd { font: 600 10.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted);
        border: 1px solid var(--line); border-radius: 4px; padding: 1px 4px; margin-left: 6px;
        background: var(--bg); vertical-align: middle; }
  .chip.on kbd, button.primary kbd { color: inherit; border-color: rgba(255, 255, 255, .5); background: none; }
  @media (hover: none) and (pointer: coarse) { kbd { display: none; } }
  .forms-toggle { display: flex; justify-content: flex-start; width: 100%; margin-top: 12px; text-align: left;
                  border: none; background: none; color: var(--accent); padding: 8px 4px;
                  font-size: 14px; }
  .forms { padding: 14px; margin-top: 4px; }
  input { font: inherit; font-size: 20px; text-align: center; width: 100%;
          padding: 11px; border-radius: 10px; border: 1px solid var(--line);
          background: var(--bg); color: var(--ink); }
  button { font: inherit; font-weight: 600; padding: 11px 16px; border-radius: 10px;
           border: 1px solid var(--line); background: var(--panel); color: var(--ink);
           cursor: pointer; }
  button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  button.wide { width: 100%; margin-top: 12px; }
  button.big { font-size: 20px; padding: 18px; }
  button.link { border: none; background: none; color: var(--muted); padding: 4px 0;
                font-weight: 400; font-size: 13px; }
  .grades { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
            margin-top: 12px; }
  .grades button { padding: 12px 4px; font-size: 13.5px; }
  .grades.walk button { padding: 18px 4px; font-size: 16px; }
  .grades .again { color: var(--bad); }
  .grades.nav { grid-template-columns: 1fr 1fr 1.4fr; }
  .grades.nav button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
  .grades.nav button:disabled { opacity: .4; cursor: default; }
  .grades .easy { color: var(--good); }
  .done { text-align: center; gap: 10px; }
  .done h1 { font-size: 22px; margin: 0 0 6px; }
  .big { font-size: 26px; font-weight: 650; margin: 0; }
  .good { color: var(--good); font-weight: 600; display: flex; align-items: center;
          justify-content: center; gap: 6px; margin: 4px 0; }
  .muted { color: var(--muted); }
  .tiny { font-size: 12px; text-align: center; }
  .error { color: var(--bad); }
</style>
