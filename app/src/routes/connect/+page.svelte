<script lang="ts">
  /** Where an MCP client (Claude Code, claude.ai) lands to be let in. The
   *  server's `/v1/oauth/authorize` has already checked the client and sent the
   *  browser here with the request in the query string. */

  import SignIn from '$lib/components/SignIn.svelte';
  import { syncConfig } from '$lib/sync';
  import BookPlus from '@lucide/svelte/icons/book-plus';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import { onMount } from 'svelte';

  /** The query parameters carried over from the server's authorize endpoint,
   *  and the only ones passed back to it. Every one is read as a string, `''`
   *  where the browser did not bring it, so the body posted to /approve always
   *  has the same shape whatever the client sent. */
  const FIELDS = [
    'client_id',
    'redirect_uri',
    'response_type',
    'state',
    'code_challenge',
    'code_challenge_method',
    'scope',
    'resource',
  ] as const;

  /** The OAuth request, keyed by FIELDS and posted back to /approve as it
   *  stands; null when the three parameters the flow cannot work without were
   *  not all there, which is what puts the "nothing to do here" panel on
   *  screen. */
  let request = $state<Record<string, string> | null>(null);
  /** What the client calls itself, or a neutral name when it said nothing. */
  let clientName = $state('');
  /** The host the code will be delivered to; `''` where the redirect URI could
   *  not be parsed. */
  let target = $state('');
  /** The signed-in account's email, shown so you can see who you are allowing
   *  as; `''` when it is not known. */
  let email = $state('');
  /** Whether this device holds a token. Nothing can be allowed without one. */
  let signedIn = $state(false);
  /** True once the query string has been read and the session looked up. */
  let ready = $state(false);
  /** True while the approval is in flight, so Allow cannot be pressed twice. */
  let busy = $state(false);
  /** What went wrong, shown under the buttons; `''` while nothing has. */
  let error = $state('');
  /** True once the request was approved and the redirect is under way. */
  let done = $state(false);
  /** True once Cancel was pressed: nothing was connected and nothing will be. */
  let declined = $state(false);

  /** Read who this device is signed in as, into `signedIn` and `email`. Run on
   *  load, and again once the panel below has signed in. */
  async function loadSession(): Promise<void> {
    const cfg = await syncConfig();
    signedIn = !!cfg.token;
    email = cfg.email || '';
  }

  onMount(async () => {
    const q = new URLSearchParams(location.search);
    if (q.get('client_id') && q.get('redirect_uri') && q.get('code_challenge')) {
      request = Object.fromEntries(FIELDS.map((k) => [k, q.get(k) || '']));
      clientName = q.get('client_name') || 'An MCP client';
      try {
        target = new URL(request.redirect_uri).host;
      } catch {
        target = '';
      }
    }
    try {
      await loadSession();
    } catch (err) {
      error = (err as Error).message;
    }
    ready = true;
  });

  /** Approve the request: the server mints a code against this device's token
   *  and answers with the URL to go back to. Everything is checked again
   *  there — this only asks — so a refusal arrives as an error to show. */
  async function allow(): Promise<void> {
    busy = true;
    error = '';
    try {
      const { api, token } = await syncConfig();
      const res = await fetch(`${api}/v1/oauth/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(request),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error_description || body.error || `${res.status}`);
      done = true;
      location.assign(body.redirect);
    } catch (err) {
      error = (err as Error).message;
      busy = false;
    }
  }
</script>

<svelte:head><title>Connect to Learness</title></svelte:head>

<h1>Connect</h1>

{#if !ready}
  <p class="muted">Loading…</p>
{:else if !request}
  <section class="panel">
    <p>
      This page is where Claude asks to use your word list, and it is only reached from there.
      Nothing to do here on its own.
    </p>
    <p class="muted small">
      To connect Claude Code, run
      <code>claude mcp add --transport http frcog {location.origin}/mcp</code>
      and then type <code>/mcp</code> to sign in.
    </p>
  </section>
{:else if done}
  <section class="panel">
    <p><b>Connected.</b> You can go back to {clientName}.</p>
  </section>
{:else if declined}
  <section class="panel">
    <p>Nothing was connected. You can close this tab.</p>
  </section>
{:else if !signedIn}
  <p class="muted">
    <b>{clientName}</b> wants to use your French word list. Sign in first, then you can decide.
  </p>
  <SignIn onSignedIn={loadSession} />
{:else}
  <section class="panel">
    <p>
      <b>{clientName}</b> wants to use your French word list
      {#if email}as <b>{email}</b>{/if}.
    </p>
    <ul class="grants">
      <li>
        <BookPlus size={18} /> Read the words you added, add new ones from a lesson, correct or remove
        them.
      </li>
      <li><EyeOff size={18} /> It will not see your reviews or scheduling, and cannot sync.</li>
      <li>
        <ShieldCheck size={18} /> It appears under Devices as &ldquo;{clientName}&rdquo;, where
        you can revoke it any time.
      </li>
    </ul>
    {#if target}
      <p class="muted small">
        After you allow, the browser goes to
        <code>{target}</code> to finish.
      </p>
    {/if}
    <div class="actions">
      <button class="primary" onclick={allow} disabled={busy}>
        {busy ? 'Connecting…' : 'Allow'}
      </button>
      <button
        onclick={() => {
          declined = true;
        }}
        disabled={busy}>Cancel</button
      >
    </div>
    {#if error}<p class="error">{error}</p>{/if}
  </section>
{/if}

<style>
  h1 {
    font-size: 22px;
    margin: 8px 0 16px;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px;
    margin-bottom: 12px;
  }
  .panel p {
    margin: 0 0 10px;
  }
  .grants {
    list-style: none;
    padding: 0;
    margin: 12px 0;
    display: grid;
    gap: 10px;
  }
  .grants li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .grants :global(svg) {
    margin-top: 4px;
    color: var(--accent);
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
  button {
    font: inherit;
    font-weight: 600;
    padding: 11px 16px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    cursor: pointer;
    flex: 1;
  }
  button.primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  code {
    font-size: 13px;
    background: var(--bg);
    padding: 2px 6px;
    border-radius: 6px;
    word-break: break-all;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 13px;
  }
  .error {
    color: var(--bad);
    font-size: 13px;
    margin: 10px 0 0;
  }
</style>
