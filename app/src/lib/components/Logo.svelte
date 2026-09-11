<script>
  /** The Learness mark: the L, drawn as the curve that falls into it.
   *
   *  The glyph alone, without the black plate it sits on as an app icon — a
   *  plate would be a black square on a black bar in dark mode. It takes the
   *  accent, which is the brand turquoise in dark and the same hue deepened in
   *  light, so the mark is legible on either ground and always the colour the
   *  rest of the screen is keyed to.
   */
  let { size = 26, title = 'Learness' } = $props();
</script>

<svg class="logo" viewBox="80 42 249 325" height={size} role="img" aria-label={title}
     xmlns="http://www.w3.org/2000/svg">
  <path fill="currentColor"
        d="M83.0914 45.0093C115.533 45.0093 141.829 71.3304 141.829 103.802V307.561H266.907H325.645V363.316C294.661 356.413 233.733 338.156 179.07 286.006C81.7548 193.171 82.553 67.6141 83.0821 45L83.0914 45.0093Z" />
</svg>

<style>
  .logo { display: block; width: auto; color: var(--accent); }
</style>
