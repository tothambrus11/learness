/** Passkeys, over WebAuthn.
 *
 *  The pleasant way in on a phone: a face or fingerprint check rather than
 *  fetching a six-digit code out of your email. Email codes remain, because you
 *  need a way to register your first passkey and a way back in if every device
 *  is lost.
 *
 *  Registration is deliberately gated on already being signed in. Anything else
 *  would let a stranger attach their own passkey to your account.
 *
 *  Credentials are discoverable (resident), so signing in needs no email typed
 *  first: the authenticator offers the account and the user handle tells us who
 *  it belongs to.
 */
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON, AuthenticatorTransport, PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Device, Env } from './env.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** What a challenge is for: the two are never interchangeable, since a login
 *  challenge answered with a registration would be a way in. */
type Purpose = 'register' | 'login';

interface ChallengeRow {
  id: string;
  user_id: string | null;
  challenge: string;
  purpose: string;
  expires: number;
}

/** What a client sends back, having asked its authenticator. */
export interface RegisterBody {
  challengeId?: string;
  credential: RegistrationResponseJSON;
  name?: string;
}
export interface LoginBody {
  challengeId?: string;
  credential: AuthenticationResponseJSON;
  name?: string;
}

/** Either half of the answer: what to do, or why not. */
export type Verified<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Passkeys are bound to a domain. A credential created on workers.dev will not
 *  work on learness.org, so this must be the domain people actually use. */
export function relyingParty(request: Request, env: Env): {
  rpID: string; origin: string; rpName: string;
} {
  const url = new URL(request.url);
  return {
    rpID: env.WEBAUTHN_RP_ID || url.hostname,
    origin: env.WEBAUTHN_ORIGIN || url.origin,
    rpName: env.WEBAUTHN_RP_NAME || 'Learness',
  };
}

const handle = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function storeChallenge(env: Env, { userId, challenge, purpose }: {
  userId?: string;
  challenge: string;
  purpose: Purpose;
}): Promise<string> {
  const id = handle();
  await env.DB.prepare(
    'INSERT INTO webauthn_challenges (id, user_id, challenge, purpose, expires) VALUES (?,?,?,?,?)')
    .bind(id, userId ?? null, challenge, purpose, Date.now() + CHALLENGE_TTL_MS).run();
  /* Opportunistic cleanup; there is no cron and the table would otherwise grow. */
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires < ?')
    .bind(Date.now()).run();
  return id;
}

/** Single use: taken and destroyed in the same step, so a replay finds nothing. */
async function takeChallenge(
  env: Env, id: string | undefined, purpose: Purpose,
): Promise<ChallengeRow | null> {
  if (!id) return null;
  const row = await env.DB.prepare(
    'SELECT id, user_id, challenge, purpose, expires FROM webauthn_challenges WHERE id = ?')
    .bind(id).first<ChallengeRow>();
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(id).run();
  if (!row || row.purpose !== purpose || row.expires < Date.now()) return null;
  return row;
}

export async function registrationOptions(env: Env, request: Request, user: Device): Promise<{
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}> {
  const { rpID, rpName } = relyingParty(request, env);
  const existing = await env.DB.prepare(
    'SELECT cred_id, transports FROM passkeys WHERE user_id = ?')
    .bind(user.user_id).all<{ cred_id: string; transports: string | null }>();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    /* Copied into an array buffer of its own: the encoder's view is typed as
       one over any buffer, and the library asks for a plain one. */
    userID: new Uint8Array(new TextEncoder().encode(user.user_id)),
    userName: user.email,
    userDisplayName: user.email,
    attestationType: 'none',
    /* Do not offer to enrol a key that is already enrolled. */
    excludeCredentials: existing.results.map((c) => {
      const transports = c.transports
        ? (JSON.parse(c.transports) as AuthenticatorTransport[]) : undefined;
      return transports ? { id: c.cred_id, transports } : { id: c.cred_id };
    }),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
  const challengeId = await storeChallenge(env, {
    userId: user.user_id, challenge: options.challenge, purpose: 'register',
  });
  return { challengeId, options };
}

export async function verifyRegistration(
  env: Env, request: Request, user: Device, body: RegisterBody,
): Promise<Verified<{ id: string; backedUp: boolean }>> {
  const { rpID, origin } = relyingParty(request, env);
  const stored = await takeChallenge(env, body.challengeId, 'register');
  if (!stored || stored.user_id !== user.user_id) {
    return { ok: false, error: 'that registration attempt has expired; start again' };
  }
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!result.verified || !result.registrationInfo) {
    return { ok: false, error: 'the authenticator response did not verify' };
  }
  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  const publicKey = btoa(String.fromCharCode(...credential.publicKey))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await env.DB.prepare(
    `INSERT INTO passkeys
       (cred_id, user_id, public_key, counter, transports, device_type, backed_up, name, created)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(cred_id) DO UPDATE SET public_key=excluded.public_key, counter=excluded.counter`)
    .bind(credential.id, user.user_id, publicKey, credential.counter ?? 0,
      JSON.stringify(credential.transports ?? []), credentialDeviceType,
      credentialBackedUp ? 1 : 0, (body.name ?? 'passkey').slice(0, 60), Date.now()).run();
  return { ok: true, id: credential.id, backedUp: credentialBackedUp };
}

export async function loginOptions(env: Env, request: Request): Promise<{
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}> {
  const { rpID } = relyingParty(request, env);
  /* No allowCredentials: the authenticator offers whichever passkey it holds
     for this site, so nothing has to be typed first. */
  const options = await generateAuthenticationOptions({
    rpID, userVerification: 'preferred',
  });
  const challengeId = await storeChallenge(env, { challenge: options.challenge, purpose: 'login' });
  return { challengeId, options };
}

export async function verifyLogin(
  env: Env, request: Request, body: LoginBody,
): Promise<Verified<{ userId: string; email: string }>> {
  const { rpID, origin } = relyingParty(request, env);
  const stored = await takeChallenge(env, body.challengeId, 'login');
  if (!stored) return { ok: false, error: 'that sign-in attempt has expired; try again' };

  const credId = body.credential?.id;
  if (!credId) return { ok: false, error: 'no credential was supplied' };
  const row = await env.DB.prepare(
    `SELECT p.cred_id, p.user_id, p.public_key, p.counter, p.transports, u.email
       FROM passkeys p JOIN users u ON u.id = p.user_id
      WHERE p.cred_id = ?`).bind(credId).first<{
        cred_id: string;
        user_id: string;
        public_key: string;
        counter: number;
        transports: string | null;
        email: string;
      }>();
  if (!row) return { ok: false, error: 'that passkey is not registered here' };

  const bytes = new Uint8Array(Uint8Array.from(
    atob(row.public_key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: body.credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: row.cred_id,
        publicKey: bytes,
        counter: row.counter,
        ...(row.transports
          ? { transports: JSON.parse(row.transports) as AuthenticatorTransport[] }
          : {}),
      },
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!result.verified) return { ok: false, error: 'that passkey did not verify' };

  /* A counter that fails to advance can mean a cloned authenticator. Plenty of
     passkeys report zero forever, so this only applies when both are non-zero. */
  const next = result.authenticationInfo.newCounter;
  if (row.counter > 0 && next > 0 && next <= row.counter) {
    return { ok: false, error: 'that passkey looks cloned and has been refused' };
  }
  await env.DB.prepare('UPDATE passkeys SET counter = ?, last_used = ? WHERE cred_id = ?')
    .bind(next, Date.now(), row.cred_id).run();
  return { ok: true, userId: row.user_id, email: row.email };
}
