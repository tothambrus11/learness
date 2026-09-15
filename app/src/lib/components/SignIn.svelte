<script lang="ts">
  import { onMount } from 'svelte';
  import {
    passkeysAvailable, requestEmailCode, signInWithEmailCode, signInWithPasskey,
  } from '$lib/passkey.js';

  interface Props {
    /** Called with the address that was signed in. */
    onSignedIn?: (email: string) => void;
  }

  let { onSignedIn = (): void => {} }: Props = $props();

  let stage = $state<'choose' | 'code' | 'working'>('choose');
  let email = $state('');
  let code = $state('');
  let error = $state('');
  let busy = $state(false);
  let canUsePasskey = $state(false);

  const deviceName = (): string =>
    (/Android|iPhone|iPad/i.test(navigator.userAgent) ? 'phone' : 'computer');

  onMount(() => { canUsePasskey = passkeysAvailable(); });

  async function withPasskey(): Promise<void> {
    busy = true; error = '';
    try {
      const { email: who } = await signInWithPasskey({ name: deviceName() });
      onSignedIn(who);
    } catch (err) {
      /* Cancelling the system prompt is not a failure worth shouting about. */
      const message = (err as Error).message;
      error = /NotAllowed|abort/i.test(message) ? '' : `Passkey sign-in failed: ${message}`;
    } finally { busy = false; }
  }

  async function sendCode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true; error = '';
    try {
      await requestEmailCode(email);
      stage = 'code';
    } catch (err) { error = (err as Error).message; } finally { busy = false; }
  }

  async function verify(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true; error = '';
    try {
      await signInWithEmailCode(email, code, deviceName());
      onSignedIn(email);
    } catch (err) { error = (err as Error).message; } finally { busy = false; }
  }
</script>

<section class="panel">
  <h2>Sign in</h2>

  {#if stage === 'choose'}
    <p class="muted small">
      Signing in lets this device sync with your others. Everything you have
      learned here stays on the device either way.
    </p>

    {#if canUsePasskey}
      <button class="primary" onclick={withPasskey} disabled={busy}>
        {busy ? 'Waiting for your device…' : 'Sign in with a passkey'}
      </button>
      <p class="or">or</p>
    {/if}

    <form onsubmit={sendCode}>
      <input type="email" bind:value={email} placeholder="you@example.com"
             autocomplete="email" required inputmode="email" />
      <button class:primary={!canUsePasskey} disabled={busy || !email}>
        {busy ? 'Sending…' : 'Email me a code'}
      </button>
    </form>

    {#if !canUsePasskey}
      <p class="muted small">
        Passkeys need a secure connection, so they are unavailable here. Over
        https they replace the email code entirely.
      </p>
    {/if}

  {:else if stage === 'code'}
    <p class="muted small">
      We sent a six-digit code to <b>{email}</b>. It lasts ten minutes and works
      once.
    </p>
    <form onsubmit={verify}>
      <input type="text" bind:value={code} placeholder="123456" required
             inputmode="numeric" autocomplete="one-time-code" maxlength="6"
             class="code" />
      <button class="primary" disabled={busy || code.length < 6}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
    </form>
    <button class="link" onclick={() => { stage = 'choose'; code = ''; error = ''; }}>
      Use a different address
    </button>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  form { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
  input { font-size: 16px; padding: 11px 12px; }
  input.code { font-size: 26px; text-align: center; letter-spacing: .3em; }
  button.link { color: var(--muted); padding: 8px 0; font-weight: 400; font-size: 13px;
                text-decoration: underline; }
  .or { text-align: center; color: var(--muted); font-size: 12px; margin: 10px 0 0; }
  .error { margin: 10px 0 0; }
</style>
