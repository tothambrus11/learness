-- Email one-time codes.
--
-- Cloudflare Access is free only to 50 seats. This replaces it with a login
-- owned by the Worker, which costs nothing per user.
--
-- Volume is low by design: a device token is long-lived, so a code is needed
-- when registering a device, not on every visit. That is a handful of emails
-- per person for the life of the account.

CREATE TABLE IF NOT EXISTS login_codes (
  email     TEXT PRIMARY KEY,      -- one live code per address; a new request replaces it
  code_hash TEXT NOT NULL,
  expires   INTEGER NOT NULL,
  attempts  INTEGER NOT NULL DEFAULT 0,
  sent      INTEGER NOT NULL,      -- when the current code was issued
  requests  INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL    -- start of the rate-limit window
);
CREATE INDEX IF NOT EXISTS idx_login_expires ON login_codes(expires);
