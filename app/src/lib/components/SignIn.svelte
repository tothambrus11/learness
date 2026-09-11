<script lang="ts">
  import {
    passkeysAvailable,
    requestEmailCode,
    signInWithEmailCode,
    signInWithPasskey,
  } from '$lib/passkey';
  import { onMount } from 'svelte';

  /** The one thing this panel hands back when it succeeds. */
  interface Props {
    /** Called once this device holds a token, with the address it belongs to.
     *  The address is passed because the passkey route never asked for one, so
     *  the caller has no other way to learn it. */
    onSignedIn?: (email: string) => void;
  }

  let { onSignedIn = () => {} }: Props = $props();

  /** Which step is on screen: the choice of route, or the six-digit code. */
  let stage = $state<'choose' | 'code' | 'working'>('choose'); // choose | code | working
  /** The address as typed, and afterwards what the code was sent to. */
  let email = $state('');
  /** The six-digit code as typed. */
  let code = $state('');
  /** What went wrong, shown under the panel. Cleared before every attempt, and
   *  left empty where the failure was you cancelling. */
  let error = $state('');
  /** True while a request or a system prompt is outstanding, so neither button
   *  can be pressed into a second one. */
  let busy = $state(false);
  /** True where this browser can offer a passkey at all: it needs a secure
   *  context, which plain http over a LAN is not. */
  let canUsePasskey = $state(false);

  /** What the account should call this device in its list. A guess from the
   *  user agent, since nothing else here knows. */
  const deviceName = (): string =>
    /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'phone' : 'computer';

  /** What went wrong, as a sentence. Everything thrown below is an `Error` —
   *  passkey.ts throws its own, and WebAuthn throws a `DOMException`, which is
   *  one — but `catch` hands back `unknown`, so it is narrowed rather than
   *  asserted. */
  const messageOf = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  onMount(() => {
    canUsePasskey = passkeysAvailable();
  });

  /** Sign in with a passkey already on this device. The account comes back
   *  with it, so no address has to be typed. */
  async function withPasskey() {
    busy = true;
    error = '';
    try {
      const { email: who } = await signInWithPasskey({ name: deviceName() });
      onSignedIn(who);
    } catch (err) {
      /* Cancelling the system prompt is not a failure worth shouting about. */
      error = /NotAllowed|abort/i.test(messageOf(err))
        ? ''
        : `Passkey sign-in failed: ${messageOf(err)}`;
    } finally {
      busy = false;
    }
  }

  /** Ask the server to email a one-time code, and move to the step that takes
   *  it. The form's own submit is cancelled: this is not a page navigation. */
  async function sendCode(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await requestEmailCode(email);
      stage = 'code';
    } catch (err) {
      error = messageOf(err);
    } finally {
      busy = false;
    }
  }

  /** Trade the code for this device's token. The address typed above is the
   *  one handed back, since the code was sent to it. */
  async function verify(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await signInWithEmailCode(email, code, deviceName());
      onSignedIn(email);
    } catch (err) {
      error = messageOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<section class="panel">
  <h2>Sign in</h2>

  {#if stage === 'choose'}
    <p class="muted small">
      Signing in lets this device sync with your others. Everything you have learned here stays
      on the device either way.
    </p>

    {#if canUsePasskey}
      <button class="primary" onclick={withPasskey} disabled={busy}>
        {busy ? 'Waiting for your device…' : 'Sign in with a passkey'}
      </button>
      <p class="or">or</p>
    {/if}

    <form onsubmit={sendCode}>
      <input
        type="email"
        bind:value={email}
        placeholder="you@example.com"
        autocomplete="email"
        required
        inputmode="email"
      />
      <button class:primary={!canUsePasskey} disabled={busy || !email}>
        {busy ? 'Sending…' : 'Email me a code'}
      </button>
    </form>

    {#if !canUsePasskey}
      <p class="muted small">
        Passkeys need a secure connection, so they are unavailable here. Over https they replace
        the email code entirely.
      </p>
    {/if}
  {:else if stage === 'code'}
    <p class="muted small">
      We sent a six-digit code to <b>{email}</b>. It lasts ten minutes and works once.
    </p>
    <form onsubmit={verify}>
      <input
        type="text"
        bind:value={code}
        placeholder="123456"
        required
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        class="code"
      />
      <button class="primary" disabled={busy || code.length < 6}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
    </form>
    <button
      class="link"
      onclick={() => {
        stage = 'choose';
        code = '';
        error = '';
      }}
    >
      Use a different address
    </button>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 0 0 8px;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px;
    margin-bottom: 12px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }
  input {
    font: inherit;
    font-size: 16px;
    padding: 11px 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
  }
  input.code {
    font-size: 26px;
    text-align: center;
    letter-spacing: 0.3em;
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
  }
  button.primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  button.link {
    border: none;
    background: none;
    color: var(--muted);
    padding: 8px 0;
    font-weight: 400;
    font-size: 13px;
    text-decoration: underline;
  }
  button:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .or {
    text-align: center;
    color: var(--muted);
    font-size: 12px;
    margin: 10px 0 0;
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
