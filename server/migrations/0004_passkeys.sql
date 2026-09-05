-- Passkeys.
--
-- The fast path for signing in: a fingerprint or face check on a device you
-- already have, instead of fetching a code out of your email. Email codes stay,
-- because you need some way to add your first passkey and some way back in when
-- every device is lost.

CREATE TABLE IF NOT EXISTS passkeys (
  cred_id     TEXT PRIMARY KEY,          -- base64url credential id from the authenticator
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key  TEXT NOT NULL,             -- base64url COSE public key
  counter     INTEGER NOT NULL DEFAULT 0,
  transports  TEXT,
  device_type TEXT,                      -- singleDevice | multiDevice
  backed_up   INTEGER NOT NULL DEFAULT 0,
  name        TEXT,
  created     INTEGER NOT NULL,
  last_used   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

-- Challenges live on the server and are single use. Handing the client an
-- opaque handle avoids needing a session cookie for a flow that has to work
-- before the user is signed in.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id        TEXT PRIMARY KEY,
  user_id   TEXT,                        -- null when logging in with a discoverable passkey
  challenge TEXT NOT NULL,
  purpose   TEXT NOT NULL,               -- register | login
  expires   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON webauthn_challenges(expires);
