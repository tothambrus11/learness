-- Letting an MCP client in.
--
-- claude.ai and Claude Code connect to a remote MCP server by OAuth: the client
-- registers itself, sends the browser to /connect/ to be allowed in, and swaps
-- the code it is handed for a token. The token is an ordinary device token
-- with the `words` scope — a row in `devices`, named after the client, revoked
-- from the app like a lost phone. These two tables are only the flow's
-- bookkeeping: who may ask, and the codes that are in flight.

-- Clients register themselves (RFC 7591). Public clients, no secret: the
-- redirect address is what is checked, so it is stored exactly as registered.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,          -- shown on /connect/, and the device's name
  redirect_uris TEXT NOT NULL,          -- JSON list, matched exactly
  created       INTEGER NOT NULL
);

-- An authorisation code lives five minutes and is destroyed the moment it is
-- used. Only its hash is kept. The PKCE challenge travels with it, so the
-- token endpoint can prove the client that swaps it is the one that asked.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope          TEXT NOT NULL,
  expires        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_codes(expires);
