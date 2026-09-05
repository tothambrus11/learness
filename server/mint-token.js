#!/usr/bin/env node
/** Create a device token.
 *
 *   node mint-token.js "pixel phone"          -> full access, for the study app
 *   node mint-token.js "claude" words         -> word list only, for the MCP server
 *
 * Prints the token once (it is never recoverable) and the command that
 * registers its hash. Only the hash reaches the server, so a database leak does
 * not hand anyone a working token.
 */
import { createHash, randomBytes } from 'node:crypto';

const name = process.argv[2];
const scope = process.argv[3] || 'full';
if (!name || !['full', 'words'].includes(scope)) {
  console.error('usage: node mint-token.js <device name> [full|words]');
  process.exit(1);
}
const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const sql = `INSERT INTO devices (token_hash, name, scope, created) VALUES ('${hash}', `
  + `'${name.replace(/'/g, "''")}', '${scope}', ${Date.now()});`;

console.log(`\ntoken (copy it now, it is not stored anywhere):\n\n  ${token}\n`);
console.log(`scope: ${scope}\n`);
console.log('register it with:\n');
console.log(`  npx wrangler d1 execute frcog --remote --command "${sql}"\n`);
