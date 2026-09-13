<script lang="ts">
  /** The keys drawn beside a button, read off the shortcut table rather than
   *  typed by hand: `alt` `s` while the answer box is open, `s` after the
   *  flip, nothing where the shortcut cannot fire. A hint typed by hand once
   *  said `s` beside the speaker on a dictation card, where the cursor was in
   *  the box and an `s` was a letter (#28); this cannot say anything the
   *  table would not do.
   *
   *  A phone gets none: a key hint with no keyboard is noise. */
  import { hint } from '$lib/shortcuts.js';
  import type { KeyContext, ShortcutId } from '$lib/shortcuts.js';

  interface Props {
    id: ShortcutId;
    /** The sitting as it stands, from the screen that owns it. */
    keys: KeyContext;
  }

  let { id, keys }: Props = $props();
  let labels = $derived(hint(id, keys));
</script>

{#each labels as label, i (i)}<kbd>{label}</kbd>{/each}

<style>
  kbd { font: 600 10.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted);
        border: 1px solid var(--line); border-radius: 4px; padding: 1px 4px; margin-left: 6px;
        background: var(--bg); vertical-align: middle; }
  kbd + kbd { margin-left: 2px; }
  /* On a filled button the hint takes the button's own ink. */
  :global(.primary) kbd, :global(.on) kbd { color: inherit; border-color: rgba(255, 255, 255, .5);
                                             background: none; }
  @media (hover: none) and (pointer: coarse) { kbd { display: none; } }
</style>
