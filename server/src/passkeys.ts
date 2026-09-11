/** Passkeys, over WebAuthn. Registering one requires a token for the account it
 *  is added to; signing in with one requires nothing, not even an address. */

/* The pleasant way in on a phone: a face or fingerprint check rather than
   fetching a six-digit code out of your email. Email codes remain, because you
   need a way to register your first passkey and a way back in if every device
   is lost.

   Registration is gated on already being signed in because anything else would
   let a stranger attach their own passkey to your account.

   Credentials are discoverable (resident), so signing in needs no email typed
   first: the authenticator offers the account and the user handle tells us who
   it belongs to. */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

import type { Env } from './env';
import type { JsonRecord } from './protocol';
import { isJsonRecord } from './protocol';

/** How long a stored challenge may be answered for, in milliseconds. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/* Structurally the device row `authenticate()` hands back, narrowed to the two
   columns used here so that this module does not have to know how a device is
   authenticated. */
/** The account a passkey is being added to, as far as these endpoints care. */
export interface PasskeyUser {
  /** The opaque account id every row is keyed by. */
  user_id: string;
  /** The verified address, shown by the authenticator when saving the passkey
   *  so the user can tell one account's key from another's. */
  email: string;
}

/** What is stored while a challenge is outstanding. */
interface ChallengeToStore {
  /** The account, on a registration. Absent when logging in: a discoverable
   *  passkey says who it belongs to only once it has been presented. */
  userId?: string;
  /** The random value the authenticator must sign, base64url. */
  challenge: string;
  /** Which flow it belongs to. A login challenge presented to the registration
   *  endpoint is refused, so one cannot be spent on the other. */
  purpose: 'register' | 'login';
}

/** A row of `webauthn_challenges`. */
interface ChallengeRow {
  /** The opaque handle given to the client instead of a session cookie. */
  id: string;
  /** The account, or null on a login challenge. */
  user_id: string | null;
  /** The value the authenticator signed, checked against the response. */
  challenge: string;
  /** `register` or `login`. */
  purpose: string;
  /** Milliseconds after which the challenge is refused. */
  expires: number;
}

/** A row of `passkeys` as the exclude list needs it: enough to say "you already
 *  have this one", nothing more. */
interface ExistingCredentialRow {
  /** The credential id the authenticator minted, base64url. */
  cred_id: string;
  /** The transports it announced, as a JSON array, or null on a row saved
   *  before the authenticator said. */
  transports: string | null;
}

/** A row of `passkeys` joined to its account, as a login verification needs it. */
interface PasskeyCredentialRow {
  /** The credential id, base64url — what the assertion identifies itself by. */
  cred_id: string;
  /** The account the passkey belongs to. */
  user_id: string;
  /** The COSE public key, base64url. */
  public_key: string;
  /** The signature counter as of the last successful login. */
  counter: number;
  /** The transports as a JSON array, or null. */
  transports: string | null;
  /** The account's address, returned to the client on a successful login. */
  email: string;
}

/** The body of `POST /v1/auth/passkey/register/verify`. */
export interface RegisterVerifyBody {
  /** The handle returned with the registration options. Anything that is not a
   *  live, unexpired registration challenge fails the attempt. */
  challengeId?: unknown;
  /** The attestation, exactly as `@simplewebauthn/browser` produced it.
   *  Checked only for the shape every credential has; whether it holds up is
   *  the library's question, not this file's. Absent when nothing usable
   *  arrived, which the endpoint refuses rather than passing on. */
  credential?: RegistrationResponseJSON;
  /** What to call the passkey in the passkey list, trimmed to 60 characters. */
  name?: unknown;
}

/** The body of `POST /v1/auth/passkey/login/verify`. */
export interface LoginVerifyBody {
  /** The handle returned with the login options. */
  challengeId?: unknown;
  /** The assertion, exactly as `@simplewebauthn/browser` produced it. Checked
   *  only for shape, for the same reason as on registration. */
  credential?: AuthenticationResponseJSON;
  /** What to call the device this passkey signed in from. */
  name?: unknown;
  /** `'words'` asks for a word-list-only token; anything else means full. */
  scope?: unknown;
}

/** True when a value has the four fields every credential the browser produces
 *  carries, of the kinds the specification gives them. Shape only. */
function isCredentialJson(value: unknown): boolean {
  /* Whether the attestation or the assertion inside actually holds up is the
     library's question, and nothing more is checked here so that an unusual but
     genuine authenticator is not turned away by this file. A value that fails
     is the same "nothing was supplied" the old `body.credential?.id` produced
     for a credential that came as a string or a number. */
  return (
    isJsonRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.rawId === 'string' &&
    typeof value.type === 'string' &&
    isJsonRecord(value.response)
  );
}

/** Reads a parsed JSON body as a registration body. A credential that is not
 *  the attestation shape is dropped, leaving `credential` undefined. */
export function registerVerifyBody(raw: JsonRecord): RegisterVerifyBody {
  return {
    challengeId: raw.challengeId,
    credential: isRegistrationResponse(raw.credential) ? raw.credential : undefined,
    name: raw.name,
  };
}

/** True when the body's credential is the attestation shape. See
 *  `isCredentialJson()` for how little this promises and why. */
function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  return isCredentialJson(value);
}

/** Reads a parsed JSON body as a login body. A credential that is not the
 *  assertion shape is dropped, leaving `credential` undefined. */
export function loginVerifyBody(raw: JsonRecord): LoginVerifyBody {
  return {
    challengeId: raw.challengeId,
    credential: isAuthenticationResponse(raw.credential) ? raw.credential : undefined,
    name: raw.name,
    scope: raw.scope,
  };
}

/** True when the body's credential is the assertion shape. See
 *  `isCredentialJson()` for how little this promises and why. */
function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  return isCredentialJson(value);
}

/** What a registration verification concluded. `ok` discriminates: a refusal
 *  always carries the sentence to show the user, a success always carries the
 *  stored credential's id. */
export type RegistrationResult =
  | {
      /** The attestation did not verify, or the attempt had already expired. */
      ok: false;
      /** What to tell the user. */
      error: string;
      /** Absent on a refusal. */
      id?: never;
      /** Absent on a refusal. */
      backedUp?: never;
    }
  | {
      /** The passkey is stored. */
      ok: true;
      /** The credential id, base64url. */
      id: string;
      /** True when the passkey syncs through iCloud or Google, so the user can
       *  be told whether losing this device loses the key. */
      backedUp: boolean;
      /** Absent on success. */
      error?: never;
    };

/** What a login verification concluded. */
export type LoginResult =
  | {
      /** The assertion did not verify, was not registered here, had expired, or
       *  looked cloned. */
      ok: false;
      /** What to tell the user. */
      error: string;
      /** Absent on a refusal. */
      userId?: never;
      /** Absent on a refusal. */
      email?: never;
    }
  | {
      /** The passkey verified. */
      ok: true;
      /** The account it belongs to, which the caller mints a token for. */
      userId: string;
      /** That account's address. */
      email: string;
      /** Absent on success. */
      error?: never;
    };

/** The relying party a passkey is made for and checked against: the configured
 *  `WEBAUTHN_*` values, each falling back to this request's own URL. */
export function relyingParty(
  request: Request,
  env: Env,
): { rpID: string; origin: string; rpName: string } {
  /* Passkeys are bound to a domain. A credential created on workers.dev will
     not work on learness.org, so this must be the domain people actually
     use. */
  const url = new URL(request.url);
  return {
    rpID: env.WEBAUTHN_RP_ID || url.hostname,
    origin: env.WEBAUTHN_ORIGIN || url.origin,
    rpName: env.WEBAUTHN_RP_NAME || 'Learness',
  };
}

/* The one body field that is used as a string rather than coerced into one, so
   it is checked here. An empty name falls back exactly as `body.name ||
   'passkey'` always did; a name that arrived as a number or an object falls back
   too, where it used to crash on `.slice`. */
/** The label a passkey was asked to be saved under, or `'passkey'` when the
 *  value is not a non-empty string. */
const passkeyName = (value: unknown): string =>
  typeof value === 'string' && value ? value : 'passkey';

/** The transports column, read back as the list the authenticator announced. A
 *  null column, or one that does not hold an array, is `undefined`, which tells
 *  the library nothing was announced. Throws on a column that will not parse. */
function storedTransports(json: string | null): string[] | undefined {
  /* A null column is a row saved before the authenticator said, or one that
     announced none. The parse cannot in fact fail: this Worker is what wrote
     the column, and it writes `JSON.stringify` of an array. */
  if (!json) return undefined;
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return undefined;
  const transports: string[] = [];
  for (const t of parsed) if (typeof t === 'string') transports.push(t);
  return transports;
}

/* Random rather than sequential, so one handle never lets anyone guess the
   next. */
/** An opaque, url-safe handle: eighteen random bytes, base64url. */
const handle = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

/** Stores a challenge and returns the handle the client quotes back. */
async function storeChallenge(
  env: Env,
  { userId, challenge, purpose }: ChallengeToStore,
): Promise<string> {
  const id = handle();
  await env.DB.prepare(
    'INSERT INTO webauthn_challenges (id, user_id, challenge, purpose, expires) VALUES (?,?,?,?,?)',
  )
    .bind(id, userId ?? null, challenge, purpose, Date.now() + CHALLENGE_TTL_MS)
    .run();
  /* Opportunistic cleanup; there is no cron and the table would otherwise grow. */
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires < ?')
    .bind(Date.now())
    .run();
  return id;
}

/** The stored challenge for this handle, or null when there is none, it belongs
 *  to the other flow, or it has expired. Single use: the row is destroyed
 *  whether or not it is returned. */
async function takeChallenge(
  env: Env,
  id: unknown,
  purpose: 'register' | 'login',
): Promise<ChallengeRow | null> {
  /* Taken and destroyed in the same step, so a replay finds nothing. */
  if (!id) return null;
  const row = await env.DB.prepare(
    'SELECT id, user_id, challenge, purpose, expires FROM webauthn_challenges WHERE id = ?',
  )
    .bind(id)
    .first<ChallengeRow>();
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(id).run();
  if (!row || row.purpose !== purpose || row.expires < Date.now()) return null;
  return row;
}

/** The options the browser needs to make a new passkey, plus the handle that
 *  ties the eventual response back to this challenge. */
export async function registrationOptions(
  env: Env,
  request: Request,
  user: PasskeyUser,
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const { rpID, rpName } = relyingParty(request, env);
  const existing = await env.DB.prepare(
    'SELECT cred_id, transports FROM passkeys WHERE user_id = ?',
  )
    .bind(user.user_id)
    .all<ExistingCredentialRow>();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    /* `.slice()` is what turns the encoder's bytes into the plain
       ArrayBuffer-backed view the library's signature asks for; a Worker's
       TextEncoder is typed as possibly backed by a shared buffer, which it
       never is. Sixteen bytes, once per registration. */
    userID: new TextEncoder().encode(user.user_id).slice(),
    userName: user.email,
    userDisplayName: user.email,
    attestationType: 'none',
    /* Do not offer to enrol a key that is already enrolled. */
    excludeCredentials: existing.results.map((c) => ({
      id: c.cred_id,
      transports: storedTransports(c.transports),
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
  const challengeId = await storeChallenge(env, {
    userId: user.user_id,
    challenge: options.challenge,
    purpose: 'register',
  });
  return { challengeId, options };
}

/** Checks an attestation and, if it holds up, stores the passkey against the
 *  already-signed-in account it was created for. */
export async function verifyRegistration(
  env: Env,
  request: Request,
  user: PasskeyUser,
  body: RegisterVerifyBody,
): Promise<RegistrationResult> {
  const { rpID, origin } = relyingParty(request, env);
  const stored = await takeChallenge(env, body.challengeId, 'register');
  if (!stored || stored.user_id !== user.user_id) {
    return { ok: false, error: 'that registration attempt has expired; start again' };
  }
  const attestation = body.credential;
  /* A body with no usable credential used to reach the library and come back
     as whatever TypeError it threw on the way in. Refused here instead, with
     the same status and the same wording the login path has always used for
     it. */
  if (!attestation) return { ok: false, error: 'no credential was supplied' };
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: attestation,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!result.verified || !result.registrationInfo) {
    return { ok: false, error: 'the authenticator response did not verify' };
  }
  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  const publicKey = btoa(String.fromCharCode(...credential.publicKey))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  await env.DB.prepare(
    `INSERT INTO passkeys
       (cred_id, user_id, public_key, counter, transports, device_type, backed_up, name, created)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(cred_id) DO UPDATE SET public_key=excluded.public_key, counter=excluded.counter`,
  )
    .bind(
      credential.id,
      user.user_id,
      publicKey,
      credential.counter ?? 0,
      JSON.stringify(credential.transports || []),
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      passkeyName(body.name).slice(0, 60),
      Date.now(),
    )
    .run();
  /* The library already gives this as a boolean, so the `!!` the untyped
     version needed has gone. */
  return { ok: true, id: credential.id, backedUp: credentialBackedUp };
}

/** The options the browser needs to present a passkey it already holds, plus
 *  the handle that ties the eventual assertion back to this challenge. */
export async function loginOptions(
  env: Env,
  request: Request,
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const { rpID } = relyingParty(request, env);
  /* No allowCredentials: the authenticator offers whichever passkey it holds
     for this site, so nothing has to be typed first. */
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });
  const challengeId = await storeChallenge(env, {
    challenge: options.challenge,
    purpose: 'login',
  });
  return { challengeId, options };
}

/** Checks an assertion against the stored public key and, if it holds up, says
 *  which account it signed in. Advances the stored signature counter. */
export async function verifyLogin(
  env: Env,
  request: Request,
  body: LoginVerifyBody,
): Promise<LoginResult> {
  const { rpID, origin } = relyingParty(request, env);
  const stored = await takeChallenge(env, body.challengeId, 'login');
  if (!stored) return { ok: false, error: 'that sign-in attempt has expired; try again' };

  const credential = body.credential;
  const credId = credential?.id;
  /* `credential` is only named again to narrow it; an id can only be truthy
     when the credential it came off is there. */
  if (!credId || !credential) return { ok: false, error: 'no credential was supplied' };
  const row = await env.DB.prepare(
    `SELECT p.cred_id, p.user_id, p.public_key, p.counter, p.transports, u.email
       FROM passkeys p JOIN users u ON u.id = p.user_id
      WHERE p.cred_id = ?`,
  )
    .bind(credId)
    .first<PasskeyCredentialRow>();
  if (!row) return { ok: false, error: 'that passkey is not registered here' };

  const bytes = Uint8Array.from(
    atob(row.public_key.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: row.cred_id,
        publicKey: bytes,
        counter: row.counter,
        transports: storedTransports(row.transports),
      },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!result.verified) return { ok: false, error: 'that passkey did not verify' };

  /* A counter that fails to advance can mean a cloned authenticator. Plenty of
     passkeys report zero forever, so this only applies when both are non-zero. */
  const next = result.authenticationInfo.newCounter;
  if (row.counter > 0 && next > 0 && next <= row.counter) {
    return { ok: false, error: 'that passkey looks cloned and has been refused' };
  }
  await env.DB.prepare('UPDATE passkeys SET counter = ?, last_used = ? WHERE cred_id = ?')
    .bind(next, Date.now(), row.cred_id)
    .run();
  return { ok: true, userId: row.user_id, email: row.email };
}
