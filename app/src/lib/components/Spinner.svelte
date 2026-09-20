<script lang="ts">
  /** The one spinner: Lucide's loader, turning, on a button whose work is not
   *  done yet — a clip being made, a sync in flight. The icon is imported here
   *  and nowhere else (rules.test.ts), and the turning is `.spin` in ui.css,
   *  so every spinner in the app is this one, at this size and this speed.
   *  Said aloud as what it stands for, not as a picture. */
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';

  interface Props {
    size?: number;
    /** What is being waited for, for a screen reader. */
    label?: string;
  }

  let { size = 15, label = 'working' }: Props = $props();
</script>

<LoaderCircle {size} class="spin" role="img" aria-label={label} />
