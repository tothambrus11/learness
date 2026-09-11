/** Passkeys on the client: enrolling one, signing in with one, and the email
 *  codes that are the other way in. */

import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

import { setSetting } from './db';
import { SYNC_KEYS, syncConfig } from './sync';

/** The one header every call to the API sends. */
const json = { 'content-type': 'application/json' };

/** What the API says when it refuses: a sentence fit to show, where it has
 *  one to give. */
interface ApiError {
  /** Why it refused, in the server's own words. */
  error?: string;
}

/** The challenge and options for enrolling a passkey, as the server mints
 *  them. Passed to the authenticator untouched. */
interface RegistrationChallenge {
  /** The stored challenge's id, handed back with the credential so the server
   *  can find it and destroy it in the same step. */
  challengeId: string;
  /** WebAuthn's own creation options, already JSON-shaped. */
  options: PublicKeyCredentialCreationOptionsJSON;
}

/** The challenge and options for signing in with a passkey. */
interface AuthenticationChallenge {
  /** The stored challenge's id, handed back with the assertion. */
  challengeId: string;
  /** WebAuthn's own request options, already JSON-shaped. There are no
   *  allowed credentials in them: the authenticator offers whichever passkey
   *  it holds for this site, so nothing has to be typed first. */
  options: PublicKeyCredentialRequestOptionsJSON;
}

/** What the server says about a passkey it has just enrolled. */
export interface PasskeyRegistration {
  /** True once it has verified and been stored. */
  ok: boolean;
  /** The credential's id, as WebAuthn spells it. */
  id: string;
  /** True where the passkey is backed up by the device's own account, and so
   *  survives losing the device. The screen says which kind it got. */
  backedUp: boolean;
}

/** What a successful sign-in comes back with, however it was done. */
export interface AuthTokenResponse {
  /** This device's bearer token. Everything else the API does needs it. */
  token: string;
  /** The account's email, so the settings screen can say whose it is. */
  email: string;
  /** What the token may do: `full` or `words`. Absent where the endpoint does
   *  not say, which is every endpoint this module calls. */
  scope?: string;
}

/** What asking for an email code comes back with. The same answer whether or
 *  not the address has an account, so this cannot be used to discover who has
 *  one. */
export interface EmailCodeSent {
  /** Always true; a failure throws instead. */
  sent: boolean;
  /** Seconds the code stays valid for. */
  expiresIn: number;
}

/** One passkey on the account, as the list endpoint gives it. */
export interface PasskeyRow {
  /** The credential's id, which is also what removing one names. */
  id: string;
  /** What it was called when it was added: "phone", "computer". */
  name: string;
  /** Milliseconds when it was enrolled. */
  created: number;
  /** Milliseconds when it last signed in, or 0 where it never has. */
  lastUsed: number;
  /** True where it syncs through iCloud or Google, so it is not lost with the
   *  device. False means this device only. */
  syncs: boolean;
  /** What the authenticator called itself: `singleDevice`, `multiDevice`. */
  deviceType: string;
}

/** One device that can sync the account, as the list endpoint gives it. */
export interface DeviceRow {
  /** The first twelve characters of the token's hash, which is what revoking
   *  one names. The token itself never leaves the device it was issued to. */
  id: string;
  /** What it was called when it signed in. */
  name: string;
  /** What it may do: `full` for everything, `words` for the word list alone. */
  scope: string;
  /** Milliseconds when it signed in. */
  created: number;
  /** Milliseconds when it last synced, or 0. */
  lastSeen: number;
  /** True once it has been cut off. The row stays, so the list can say so. */
  revoked: boolean;
  /** True for the device reading the list, which may not revoke itself. */
  current: boolean;
}

/** True where this browser can use passkeys at all. */
export function passkeysAvailable(): boolean {
  /* WebAuthn needs a secure context, so this is false on plain http over a LAN. */
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    window.isSecureContext === true
  );
}

/** True when the device can offer a passkey without being told which account,
 *  which is what makes a one-tap sign-in possible. */
export async function autofillAvailable(): Promise<boolean> {
  if (!passkeysAvailable()) return false;
  try {
    return (await window.PublicKeyCredential.isConditionalMediationAvailable?.()) ?? false;
  } catch {
    return false;
  }
}

/** One POST to the sync API, with the device token where there is one. Resolves
 *  with the body, whose shape the caller names; throws an error whose message is
 *  fit to put on screen, never a bare status code. */
async function api<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const { api: base } = await syncConfig();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: token ? { ...json, authorization: `Bearer ${token}` } : json,
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new Error('could not reach the server; check your connection');
  }
  const data: T & ApiError = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (res.status === 404) {
    throw new Error(
      'the sync API is not reachable at this address. In development, run ' +
        '`npm run dev`, which starts the API alongside the app.',
    );
  }
  throw new Error(data.error || `request failed (${res.status})`);
}

/** Add a passkey to the account this device is already signed in to. */
export async function registerPasskey(name = 'this device'): Promise<PasskeyRegistration> {
  if (!passkeysAvailable()) throw new Error('this browser cannot use passkeys');
  const { token } = await syncConfig();
  if (!token) throw new Error('sign in first, then add a passkey');

  const { challengeId, options } = await api<RegistrationChallenge>(
    '/v1/auth/passkey/register/options',
    {},
    token,
  );
  const credential = await startRegistration({ optionsJSON: options });
  const result = await api<PasskeyRegistration>(
    '/v1/auth/passkey/register/verify',
    { challengeId, credential, name },
    token,
  );
  return result;
}

/** How to sign in with a passkey. */
interface PasskeySignIn {
  /** What to call this device in the account's device list. */
  name?: string;
  /** True to offer the passkey through the browser's autofill prompt rather
   *  than a modal, which needs a suitable input on screen. */
  conditional?: boolean;
}

/** Sign in with a passkey. Returns the device token, already stored. */
export async function signInWithPasskey({
  name = 'phone',
  conditional = false,
}: PasskeySignIn = {}): Promise<AuthTokenResponse> {
  if (!passkeysAvailable()) throw new Error('this browser cannot use passkeys');
  const { challengeId, options } = await api<AuthenticationChallenge>(
    '/v1/auth/passkey/login/options',
  );
  const credential = await startAuthentication({
    optionsJSON: options,
    useBrowserAutofill: conditional,
  });
  const { token, email } = await api<AuthTokenResponse>('/v1/auth/passkey/login/verify', {
    challengeId,
    credential,
    name,
  });
  await setSetting(SYNC_KEYS.token, token);
  await setSetting(SYNC_KEYS.email, email);
  return { token, email };
}

/** Every passkey on the account, oldest first, for the manage panel. */
export async function listPasskeys(): Promise<PasskeyRow[]> {
  const { api: base, token } = await syncConfig();
  const res = await fetch(`${base}/v1/auth/passkeys`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('could not list passkeys');
  const data: { passkeys: PasskeyRow[] } = await res.json();
  return data.passkeys;
}

/** Forget one passkey, by credential id. Answers how many rows went, which is
 *  0 where it was already gone. */
export async function removePasskey(id: string): Promise<number> {
  const { api: base, token } = await syncConfig();
  const res = await fetch(`${base}/v1/auth/passkeys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('could not remove that passkey');
  const data: { removed: number } = await res.json();
  return data.removed;
}

/** Email one-time code, the way in before a passkey exists and the way back
 *  when every device is gone. */
export async function requestEmailCode(email: string): Promise<EmailCodeSent> {
  return api<EmailCodeSent>('/v1/auth/request', { email });
}

/** Trade an emailed code for a device token, which is stored here. Returns
 *  the token, for a caller that wants to say it worked. */
export async function signInWithEmailCode(
  email: string,
  code: string,
  name = 'this device',
): Promise<string> {
  const data = await api<AuthTokenResponse>('/v1/auth/verify', { email, code, name });
  await setSetting(SYNC_KEYS.token, data.token);
  await setSetting(SYNC_KEYS.email, data.email || email);
  return data.token;
}

/** Devices that can sync this account, so a lost phone can be cut off. */
export async function listDevices(): Promise<DeviceRow[]> {
  const { api: base, token } = await syncConfig();
  const res = await fetch(`${base}/v1/auth/devices`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('could not list devices');
  const data: { devices: DeviceRow[] } = await res.json();
  return data.devices;
}

/** Cut one device off, by the id the device list gives. Answers how many rows
 *  were revoked. */
export async function revokeDevice(id: string): Promise<number> {
  const { api: base, token } = await syncConfig();
  const res = await fetch(`${base}/v1/auth/devices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('could not revoke that device');
  const data: { revoked: number } = await res.json();
  return data.revoked;
}

/** Forget this device's credentials. Progress stays on the device; only the
 *  ability to sync goes away. */
export async function signOut(): Promise<void> {
  await setSetting(SYNC_KEYS.token, '');
  await setSetting(SYNC_KEYS.email, '');
  await setSetting(SYNC_KEYS.cursor, 0);
  await setSetting(SYNC_KEYS.syncedAt, 0);
}
