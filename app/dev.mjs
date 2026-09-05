#!/usr/bin/env node
/** Start the app and its API together.
 *
 *  In production one Worker serves both on one origin. The Vite dev server only
 *  serves the app, so without the API beside it every /v1 call 404s, and a
 *  passkey sign-in fails for a reason the error does not explain.
 *
 *  Two things this handles that a plain "run both" script does not:
 *
 *  The API port is chosen, not fixed, so a busy port is a one-line note rather
 *  than a runtime stack trace about binding a socket.
 *
 *  Each child is started in its own process group and stopped as a group. Node
 *  spawns wrangler, wrangler spawns workerd, and signalling only the child
 *  leaves workerd alive holding the port, which is exactly what makes the next
 *  run fail.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const FIRST_PORT = Number(process.env.FRCOG_API_PORT) || 8787;
const posix = process.platform !== 'win32';

const free = (port) => new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.once('listening', () => probe.close(() => resolve(true)));
  probe.listen(port, '127.0.0.1');
});

async function pickPort(start) {
  for (let port = start; port < start + 40; port += 1) {
    if (await free(port)) return port;
  }
  throw new Error(`no free port between ${start} and ${start + 40}`);
}

const port = await pickPort(FIRST_PORT);
if (port !== FIRST_PORT) {
  console.log(`\n  port ${FIRST_PORT} is in use, running the API on ${port}\n`);
}

/** Local binaries directly rather than through npx: one less process for a
 *  signal to get lost in. */
const bin = (name) => new URL(`node_modules/.bin/${name}`, import.meta.url).pathname;

const children = [];
let stopping = false;

function start(name, command, args, env) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    detached: posix,          // its own process group, so the tree can be stopped
  });
  child.on('error', (err) => {
    console.error(`\n  could not start ${name}: ${err.message}`);
    stopAll(1);
  });
  child.on('exit', (code) => {
    if (!stopping && code) console.error(`\n  ${name} exited with ${code}`);
    stopAll(code || 0);
  });
  children.push(child);
}

function signalGroup(child, signal) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (posix) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch { /* already gone */ }
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) signalGroup(child, 'SIGTERM');
  setTimeout(() => {
    for (const child of children) signalGroup(child, 'SIGKILL');
    process.exit(code);
  }, 1200).unref();
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

start('api', bin('wrangler'),
  ['dev', '--local', '--port', String(port), '--config', '../wrangler.toml']);
start('app', bin('vite'), ['dev', '--host'],
  { FRCOG_API_ORIGIN: `http://127.0.0.1:${port}` });
