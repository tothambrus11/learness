#!/usr/bin/env node
/** Break-glass token minting.
 *
 * Normally you log in through Cloudflare Access and the app receives a token
 * automatically, and an MCP client gets its token through the OAuth flow in
 * src/oauth.ts. This exists for the cases neither covers: a script that wants
 * a words-scoped token without a browser, recovering when login is
 * misconfigured, or seeding the very first account.
 *
 *   node mint-token.ts you@example.com "pixel phone"
 *   node mint-token.ts you@example.com "claude" words
 *
 * The token is printed once and never stored anywhere; only its hash reaches
 * the database, so a leaked database hands nobody a working key.
 */
import { createHash, randomBytes } from 'node:crypto';

const SCOPES = ['full', 'words'];
const [email, name, scope = 'full'] = process.argv.slice(2);
if (!email || !name || !SCOPES.includes(scope)) {
  console.error('usage: node mint-token.ts <email> <device name> [full|words]');
  process.exit(1);
}

const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
/* Must match accountId() in src/access.ts, or the CLI and the login flow would
   create two different accounts for the same person. */
const userId = createHash('sha256')
  .update(`frcog:${email.trim().toLowerCase()}`).digest('hex').slice(0, 32);

const esc = (s: string): string => s.replace(/'/g, "''");
const now = Date.now();
const sql = [
  `INSERT OR IGNORE INTO users (id, email, created) VALUES ('${userId}', '${esc(email.trim().toLowerCase())}', ${now});`,
  `INSERT INTO devices (token_hash, user_id, name, scope, created) VALUES ('${tokenHash}', '${userId}', '${esc(name)}', '${scope}', ${now});`,
].join(' ');

console.log(`\ntoken (copy it now, it is not stored anywhere):\n\n  ${token}\n`);
console.log(`account: ${email}   scope: ${scope}\n`);
console.log('register it with:\n');
console.log(`  npx wrangler d1 execute frcog --remote --command "${sql}"\n`);
