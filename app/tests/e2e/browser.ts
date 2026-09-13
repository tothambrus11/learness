/** A browser, if this machine has one.
 *
 *  The end-to-end suite is the only place the app is tested as a person uses
 *  it — the database, the service worker, the layout and the audio all at
 *  once — and it needs a real Chromium. Where there is none it says so and
 *  skips, rather than failing as though the app were broken.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/opt/google/chrome/chrome',
];

/** Playwright keeps its browsers in a directory of versioned folders. */
function fromPlaywrightStore(): string | null {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return null;
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith('chromium')) continue;
    for (const exe of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const path = join(root, dir, exe);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

export function findChromium(): string | null {
  for (const path of CANDIDATES) if (path && existsSync(path)) return path;
  return fromPlaywrightStore();
}
