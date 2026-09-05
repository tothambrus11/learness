/** Passkeys on the client.
 *
 *  Signing in is a face or fingerprint check instead of fetching a code out of
 *  your email. Email codes stay: you need one to register your first passkey,
 *  and one to get back in if every device is lost.
 */
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { setSetting } from './db.js';
import { SYNC_KEYS, syncConfig } from './sync.js';

const json = { 'content-type': 'application/json' };

/** Passkeys need a secure context, so this is false on plain http over a LAN. */
export function passkeysAvailable() {
  return typeof window !== 'undefined'
    && !!window.PublicKeyCredential
    && window.isSecureContext === true;
}

/** True when the device can offer a passkey without being told which account,
 *  which is what makes a one-tap sign-in possible. */
export async function autofillAvailable() {
  if (!passkeysAvailable()) return false;
  try {
    return await window.PublicKeyCredential.isConditionalMediationAvailable?.() ?? false;
  } catch {
    return false;
  }
}

async function api(path, body, token) {
  const { api: base } = await syncConfig();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: token ? { ...json, authorization: `Bearer ${token}` } : json,
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

/** Add a passkey to the account this device is already signed in to. */
export async function registerPasskey(name = 'this device') {
  if (!passkeysAvailable()) throw new Error('this browser cannot use passkeys');
  const { token } = await syncConfig();
  if (!token) throw new Error('sign in first, then add a passkey');

  const { challengeId, options } = await api('/v1/auth/passkey/register/options', {}, token);
  const credential = await startRegistration({ optionsJSON: options });
  const result = await api(
    '/v1/auth/passkey/register/verify', { challengeId, credential, name }, token);
  return result;
}

/** Sign in with a passkey. Returns the device token, already stored. */
export async function signInWithPasskey({ name = 'phone', conditional = false } = {}) {
  if (!passkeysAvailable()) throw new Error('this browser cannot use passkeys');
  const { challengeId, options } = await api('/v1/auth/passkey/login/options');
  const credential = await startAuthentication({
    optionsJSON: options,
    /* Conditional mediation shows the passkey in the browser's own autofill
       prompt rather than a modal, which is the least intrusive way in. */
    useBrowserAutofill: conditional,
  });
  const { token, email } = await api(
    '/v1/auth/passkey/login/verify', { challengeId, credential, name });
  await setSetting(SYNC_KEYS.token, token);
  return { token, email };
}

export async function listPasskeys() {
  const { api: base, token } = await syncConfig();
  const res = await fetch(`${base}/v1/auth/passkeys`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('could not list passkeys');
  return (await res.json()).passkeys;
}

export async function removePasskey(id) {
  const { api: base, token } = await syncConfig();
  const res = await fetch(`${base}/v1/auth/passkeys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('could not remove that passkey');
  return (await res.json()).removed;
}

/** Email one-time code, the way in before a passkey exists and the way back
 *  when every device is gone. */
export async function requestEmailCode(email) {
  return api('/v1/auth/request', { email });
}

export async function signInWithEmailCode(email, code, name = 'this device') {
  const { token } = await api('/v1/auth/verify', { email, code, name });
  await setSetting(SYNC_KEYS.token, token);
  return token;
}
