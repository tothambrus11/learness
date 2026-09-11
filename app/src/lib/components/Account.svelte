<script lang="ts">
  import {
    listDevices,
    listPasskeys,
    passkeysAvailable,
    registerPasskey,
    removePasskey,
    revokeDevice,
    signOut,
  } from '$lib/passkey';
  import type { DeviceRow, PasskeyRow } from '$lib/passkey';
  import { onMount } from 'svelte';

  /** The account this panel manages, and the one thing it cannot do itself. */
  interface Props {
    /** The signed-in address, shown as the panel's heading. Empty falls back to
     *  "Signed in", since the account still exists without one. */
    email?: string;
    /** Called after this device has forgotten its credentials, so the screen
     *  around can read the sync settings again. Signing out is local only, so
     *  there is nothing to hand back. */
    onSignedOut?: () => void;
  }

  let { email = '', onSignedOut = () => {} }: Props = $props();

  /** Every passkey on the account, this device's and the others'. Empty until
   *  the first refresh lands, and again whenever the list cannot be read. */
  let passkeys = $state<PasskeyRow[]>([]);
  /** Every device that can sync the account, revoked ones included: a cut-off
   *  device is still shown, so it is clear what was done. */
  let devices = $state<DeviceRow[]>([]);
  /** What went wrong, shown under the panel. Cleared before every attempt. */
  let error = $state('');
  /** What went right, where that is worth saying — whether a new passkey syncs
   *  off this device or not. Cleared before every attempt. */
  let notice = $state('');
  /** True while the device's own prompt is up, so the button cannot be pressed
   *  twice into two registrations. */
  let busy = $state(false);
  /** True where this browser can register a passkey at all: it needs a secure
   *  context, which plain http over a LAN is not. */
  let canAdd = $state(false);
  /** True while the lists are shown. Closed by default: the heading is the
   *  everyday reading, and the lists are for the day something is lost. */
  let open = $state(false);

  onMount(async () => {
    canAdd = passkeysAvailable();
    await refresh();
  });

  /** What went wrong, as a sentence. Everything thrown below is an `Error` —
   *  passkey.ts throws its own, and WebAuthn throws a `DOMException`, which is
   *  one — but `catch` hands back `unknown`, so it is narrowed rather than
   *  asserted. */
  const messageOf = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  /** Read both lists again, together, so the counts in the heading can never
   *  disagree with the lists under it. Leaves the old lists standing when the
   *  server cannot be reached. */
  async function refresh() {
    try {
      [passkeys, devices] = await Promise.all([listPasskeys(), listDevices()]);
    } catch (err) {
      error = messageOf(err);
    }
  }

  /** Register a passkey for whatever this device is, and say afterwards
   *  whether it syncs, since that decides whether the email code is still the
   *  only way back in. Cancelling the system prompt is silent. */
  async function addPasskey() {
    busy = true;
    error = '';
    notice = '';
    try {
      const res = await registerPasskey(
        /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'phone' : 'computer',
      );
      notice = res.backedUp
        ? 'Passkey added. It syncs through your device account, so it survives losing this device.'
        : 'Passkey added. It lives on this device only, so keep the email code as your way back in.';
      await refresh();
    } catch (err) {
      error = /NotAllowed|abort/i.test(messageOf(err)) ? '' : messageOf(err);
    } finally {
      busy = false;
    }
  }

  /** Forget one passkey on the server. The credential stays on the device that
   *  holds it; it simply stops opening this account. */
  async function drop(id: PasskeyRow['id']) {
    error = '';
    notice = '';
    try {
      await removePasskey(id);
      await refresh();
    } catch (err) {
      error = messageOf(err);
    }
  }

  /** Cut one device off the account, for a phone that is gone. Its token stops
   *  working at once; what it already learned stays on it. */
  async function cutOff(id: DeviceRow['id']) {
    error = '';
    notice = '';
    try {
      await revokeDevice(id);
      await refresh();
    } catch (err) {
      error = messageOf(err);
    }
  }

  /** Sign this device out and tell the screen around. Nothing learned here is
   *  touched, which is what the note under the button says. */
  async function leave() {
    await signOut();
    onSignedOut();
  }

  /** A timestamp as a plain date, or "never" for a passkey or device that has
   *  not been used since the server started recording it. */
  const when = (ms?: number): string => (ms ? new Date(ms).toLocaleDateString() : 'never');
</script>

<section class="panel">
  <div class="head">
    <div>
      <b>{email || 'Signed in'}</b>
      <span class="muted small"
        >{passkeys.length} passkeys · {devices.filter((d) => !d.revoked).length} devices</span
      >
    </div>
    <button class="link" onclick={() => (open = !open)}>{open ? 'Hide' : 'Manage'}</button>
  </div>

  {#if open}
    <h3>Passkeys</h3>
    {#if passkeys.length}
      <ul>
        {#each passkeys as k (k.id)}
          <li>
            <div>
              <b>{k.name}</b>
              <span class="muted small">
                {k.syncs ? 'syncs to your other devices' : 'this device only'}
                · last used {when(k.lastUsed)}
              </span>
            </div>
            <button class="link danger" onclick={() => drop(k.id)}>Remove</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted small">
        None yet. A passkey replaces the email code with a fingerprint or face check on this
        device.
      </p>
    {/if}
    {#if canAdd}
      <button onclick={addPasskey} disabled={busy}>
        {busy ? 'Waiting for your device…' : 'Add a passkey'}
      </button>
    {:else}
      <p class="muted small">
        Passkeys need a secure connection, so they cannot be added here.
      </p>
    {/if}

    <h3>Devices</h3>
    <ul>
      {#each devices as d (d.id)}
        <li>
          <div>
            <b>{d.name}{d.current ? ' (this one)' : ''}</b>
            <span class="muted small">
              {d.scope === 'words' ? 'word list only' : 'full sync'}
              · last seen {when(d.lastSeen)}{d.revoked ? ' · revoked' : ''}
            </span>
          </div>
          {#if !d.revoked && !d.current}
            <button class="link danger" onclick={() => cutOff(d.id)}>Revoke</button>
          {/if}
        </li>
      {/each}
    </ul>

    <button class="link" onclick={leave}>Sign out on this device</button>
    <p class="muted small">
      Signing out only stops syncing. Everything learned on this device stays.
    </p>
  {/if}

  {#if notice}<p class="notice">{notice}</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px;
    margin-bottom: 12px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .head b {
    display: block;
  }
  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 18px 0 8px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid var(--line);
  }
  li b {
    display: block;
    font-size: 14.5px;
  }
  button {
    font: inherit;
    font-weight: 600;
    padding: 10px 16px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    cursor: pointer;
    margin-top: 10px;
  }
  button.link {
    border: none;
    background: none;
    color: var(--muted);
    padding: 4px 0;
    font-weight: 400;
    font-size: 13px;
    text-decoration: underline;
    margin: 0;
  }
  button.link.danger {
    color: var(--bad);
  }
  button:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 12.5px;
  }
  .notice {
    color: var(--good);
    font-size: 13px;
    margin: 10px 0 0;
  }
  .error {
    color: var(--bad);
    font-size: 13px;
    margin: 10px 0 0;
  }
</style>
