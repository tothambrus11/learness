/** Passkeys on the client.
 *
 *  Signing in is a face or fingerprint check instead of fetching a code out of
 *  your email. Email codes stay: you need one to register your first passkey,
 *  and one to get back in if every device is lost.
 */
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { setSetting } from './db.js';
import { SYNC_KEYS, syncConfig } from './sync.js';
import type { Millis } from './units.js';

/** A passkey as the account lists them. The field names are the server's. */
export interface PasskeyRecord {
  id: string;
  name: string;
  created: Millis;
  lastUsed: Millis | null;
  /** Backed up through iCloud or Google, so it survives losing the device. */
  syncs: boolean;
  deviceType?: string;
}

/** A device that can sync this account. */
export interface DeviceRecord {
  /** The head of its token hash: enough to name it, never enough to use it. */
  id: string;
  name: string;
  scope?: string;
  created: Millis;
  lastSeen: Millis | null;
  revoked: boolean;
  /** This device, which is never offered a Revoke button. */
  current: boolean;
}

const json = { 'content-type': 'application/json' };

/** Passkeys need a secure context, so this is false on plain http over a LAN. */
export function passkeysAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.PublicKeyCredential
    && window.isSecureContext;
}

/** True when the device can offer a passkey without being told which account,
 *  which is what makes a one-tap sign-in possible. */
export async function autofillAvailable(): Promise<boolean> {
  if (!passkeysAvailable()) return false;
  try {
    return await window.PublicKeyCredential.isConditionalMediationAvailable?.() ?? false;
  } catch {
    return false;
  }
}

async function api<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const { api: base } = await syncConfig();
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: token ? { ...json, authorization: `Bearer ${token}` } : json,
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new Error('could not reach the server; check your connection');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.ok) return data;
  /* A 404 here almost always means the app is being served without its API
     beside it, which is what the bare Vite dev server does. Say so, rather than
     reporting a status code that explains nothing. */
  if (res.status === 404) {
    throw new Error(
      'the sync API is not reachable at this address. In development, run '
      + '`npm run dev`, which starts the API alongside the app.');
  }
  throw new Error(data.error ?? `request failed (${res.status})`);
}

/** Add a passkey to the account this device is already signed in to. */
export async function registerPasskey(
  name = 'this device',
): Promise<{ id: string; backedUp?: boolean }> {
  if (!passkeysAvailable()) throw new Error('this browser cannot use passkeys');
  const { token } = await syncConfig();
  if (!token) throw new Error('sign in first, then add a passkey');

  const { challengeId, options } = await api<{
    challengeId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
  }>('/v1/auth/passkey/register/options', {}, token);
  const credential = await startRegistration({ optionsJSON: options });
  return api<{ id: string; backedUp?: boolean }>(
    '/v1/auth/passkey/register/verify', { challengeId, credential, name }, token);
}

/** Sign in with a passkey. Returns the device token, already stored. */
export async function signInWithPasskey(
  { name = 'phone', conditional = false }: { name?: string; conditional?: boolean } = {},
): Promise<{ token: string; email: string }> {
  if (!passkeysAvailable()) throw new Error('this browser cannot use passkeys');
  const { challengeId, options } = await api<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>('/v1/auth/passkey/login/options');
  const credential = await startAuthentication({
    optionsJSON: options,
    /* Conditional mediation shows the passkey in the browser's own autofill
       prompt rather than a modal, which is the least intrusive way in. */
    useBrowserAutofill: conditional,
  });
  const { token, email } = await api<{ token: string; email: string }>(
    '/v1/auth/passkey/login/verify', { challengeId, credential, name });
  await setSetting(SYNC_KEYS.token, token);
  await setSetting(SYNC_KEYS.email, email);
  return { token, email };
}

export async function listPasskeys(): Promise<PasskeyRecord[]> {
  const { api: base, token } = await syncConfig();
  const res = await fetch(`${base}/v1/auth/passkeys`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('could not list passkeys');
  return ((await res.json()) as { passkeys: PasskeyRecord[] }).passkeys;
}

export async function removePasskey(id: string): Promise<number> {
  const { api: base, token } = await syncConfig();
  const res = await fetch(`${base}/v1/auth/passkeys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('could not remove that passkey');
  return ((await res.json()) as { removed: number }).removed;
}

/** Email one-time code, the way in before a passkey exists and the way back
 *  when every device is gone. */
export async function requestEmailCode(email: string): Promise<{ sent?: boolean }> {
  return api('/v1/auth/request', { email });
}

export async function signInWithEmailCode(
  email: string, code: string, name = 'this device',
): Promise<string> {
  const data = await api<{ token: string; email?: string }>(
    '/v1/auth/verify', { email, code, name });
  await setSetting(SYNC_KEYS.token, data.token);
  await setSetting(SYNC_KEYS.email, data.email || email);
  return data.token;
}

/** Devices that can sync this account, so a lost phone can be cut off. */
export async function listDevices(): Promise<DeviceRecord[]> {
  const { api: base, token } = await syncConfig();
  const res = await fetch(`${base}/v1/auth/devices`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('could not list devices');
  return ((await res.json()) as { devices: DeviceRecord[] }).devices;
}

export async function revokeDevice(id: string): Promise<number> {
  const { api: base, token } = await syncConfig();
  const res = await fetch(`${base}/v1/auth/devices/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('could not revoke that device');
  return ((await res.json()) as { revoked: number }).revoked;
}

/** Forget this device's credentials. Progress stays on the device; only the
 *  ability to sync goes away. */
export async function signOut(): Promise<void> {
  await setSetting(SYNC_KEYS.token, '');
  await setSetting(SYNC_KEYS.email, '');
  await setSetting(SYNC_KEYS.cursor, 0);
  await setSetting(SYNC_KEYS.syncedAt, 0 as Millis);
}
