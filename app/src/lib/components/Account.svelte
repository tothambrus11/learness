<script>
  import { onMount } from 'svelte';
  import {
    listDevices, listPasskeys, passkeysAvailable, registerPasskey, removePasskey,
    revokeDevice, signOut,
  } from '$lib/passkey.js';

  let { email = '', onSignedOut = () => {} } = $props();

  let passkeys = $state([]);
  let devices = $state([]);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);
  let canAdd = $state(false);
  let open = $state(false);

  onMount(async () => {
    canAdd = passkeysAvailable();
    await refresh();
  });

  async function refresh() {
    try {
      [passkeys, devices] = await Promise.all([listPasskeys(), listDevices()]);
    } catch (err) { error = err.message; }
  }

  async function addPasskey() {
    busy = true; error = ''; notice = '';
    try {
      const res = await registerPasskey(
        /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'phone' : 'computer');
      notice = res.backedUp
        ? 'Passkey added. It syncs through your device account, so it survives losing this device.'
        : 'Passkey added. It lives on this device only, so keep the email code as your way back in.';
      await refresh();
    } catch (err) {
      error = /NotAllowed|abort/i.test(err.message) ? '' : err.message;
    } finally { busy = false; }
  }

  async function drop(id) {
    error = ''; notice = '';
    try { await removePasskey(id); await refresh(); }
    catch (err) { error = err.message; }
  }

  async function cutOff(id) {
    error = ''; notice = '';
    try { await revokeDevice(id); await refresh(); }
    catch (err) { error = err.message; }
  }

  async function leave() {
    await signOut();
    onSignedOut();
  }

  const when = (ms) => (ms ? new Date(ms).toLocaleDateString() : 'never');
</script>

<section class="panel">
  <div class="head">
    <div>
      <b>{email || 'Signed in'}</b>
      <span class="muted small">{passkeys.length} passkeys · {devices.filter(d => !d.revoked).length} devices</span>
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
        None yet. A passkey replaces the email code with a fingerprint or face
        check on this device.
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
  .panel { background: var(--panel); border: 1px solid var(--line);
           border-radius: 14px; padding: 16px; margin-bottom: 12px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .head b { display: block; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
       color: var(--muted); margin: 18px 0 8px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; justify-content: space-between; gap: 10px;
       padding: 8px 0; border-top: 1px solid var(--line); }
  li b { display: block; font-size: 14.5px; }
  button { font: inherit; font-weight: 600; padding: 10px 16px; border-radius: 10px;
           border: 1px solid var(--line); background: var(--panel); color: var(--ink);
           cursor: pointer; margin-top: 10px; }
  button.link { border: none; background: none; color: var(--muted); padding: 4px 0;
                font-weight: 400; font-size: 13px; text-decoration: underline;
                margin: 0; }
  button.link.danger { color: var(--bad); }
  button:disabled { opacity: .6; cursor: progress; }
  .muted { color: var(--muted); }
  .small { font-size: 12.5px; }
  .notice { color: var(--good); font-size: 13px; margin: 10px 0 0; }
  .error { color: var(--bad); font-size: 13px; margin: 10px 0 0; }
</style>
