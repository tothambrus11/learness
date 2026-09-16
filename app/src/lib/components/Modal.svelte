<script lang="ts">
  /** A popup over the screen, for something done to what is on it — correcting
   *  the word on a card — without leaving it.
   *
   *  It is the platform's own <dialog>, opened with showModal(): Escape closes
   *  it, nothing behind it can be reached or tabbed to while it is up, and
   *  the focus goes back to whatever opened it when it shuts. None of that is
   *  written here, which is the point of using the element. The page behind
   *  is dimmed by the primitive in ui.css, which also keeps it sixteen pixels
   *  off either edge of a phone.
   *
   *  What is inside is drawn only while it is open, so a form put in it
   *  starts afresh on every opening. */
  import type { Snippet } from 'svelte';
  import X from '@lucide/svelte/icons/x';

  interface Props {
    /** Up while true. The dialog sets it false itself when Escape or the
     *  close button shuts it, so the screen that opened it knows. */
    open: boolean;
    /** Its heading, which is also its name to a screen reader. */
    title: string;
    children: Snippet;
  }

  let { open = $bindable(), title, children }: Props = $props();
  let el = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });
</script>

<dialog bind:this={el} aria-label={title} onclose={() => (open = false)}>
  {#if open}
    <div class="head">
      <h2>{title}</h2>
      <button class="x" type="button" aria-label="Close" onclick={() => (open = false)}>
        <X size={18} />
      </button>
    </div>
    {@render children()}
  {/if}
</dialog>

<style>
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .head h2 { margin: 0; }
  button.x { border: none; background: none; color: var(--muted); padding: 4px;
             margin: -4px -4px -4px 0; }
</style>
