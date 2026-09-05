<script>
  let { children } = $props();
</script>

<svelte:head><title>French Cognates</title></svelte:head>

<main>{@render children()}</main>

<style>
  :global(:root) {
    --bg: #fbfaf7; --panel: #fff; --ink: #1c1c1a; --muted: #6b6a66;
    --line: #e6e3dc; --accent: #1d4ed8; --good: #15803d; --bad: #b91c1c;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #16171a; --panel: #1f2125; --ink: #e9e8e4; --muted: #9a9892;
      --line: #2e3136; --accent: #7ea2ff; --good: #6ee7a0; --bad: #fca5a5;
    }
  }
  :global(body) {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  main { max-width: 640px; margin: 0 auto; padding: 16px 16px 96px; }
</style>
