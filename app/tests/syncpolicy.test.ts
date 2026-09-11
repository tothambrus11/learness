/** When the app may spend the network on its own: sync, audio, and the voice. */
import { expect, test } from 'vitest';

import {
  canDetectMetering,
  connectionState,
  METERED,
  UNKNOWN,
  UNMETERED,
} from '../src/lib/network';
import type { ConnectionState } from '../src/lib/network';
import {
  bulkDownloadDecision,
  bulkPolicyLabel,
  DEFAULT_BULK_POLICY,
  DEFAULT_POLICY,
  modelDownloadDecision,
  policyLabel,
  shouldAutoSync,
} from '../src/lib/syncpolicy';
import type { AutoSyncInput, BulkDownloadInput } from '../src/lib/syncpolicy';

/** Everything a sync needs before the policy is even asked: signed in, online,
 *  never synced, at a fixed moment. */
const base: AutoSyncInput = {
  configured: true,
  online: true,
  lastSyncAt: 0,
  now: 1_000_000_000,
};

/** The Network Information object a browser would hand over, carrying whichever
 *  of its three read fields a case names. Hung on a real `EventTarget`, rather
 *  than asserted onto a bare literal, because that is what `connectionState()`
 *  takes. */
const conn = (fields: { type?: string; saveData?: boolean; effectiveType?: string }) =>
  Object.assign(new EventTarget(), fields);

test('wifi syncs on its own', () => {
  const r = shouldAutoSync({ ...base, policy: 'unmetered', connection: UNMETERED });
  expect(r.sync).toBe(true);
});

test('mobile data waits to be asked', () => {
  const r = shouldAutoSync({ ...base, policy: 'unmetered', connection: METERED });
  expect(r.sync).toBe(false);
  expect(r.reason).toMatch(/metered/);
});

test('an unknown connection is treated as metered, not as wifi', () => {
  const r = shouldAutoSync({ ...base, policy: 'unmetered', connection: UNKNOWN });
  expect(r.sync, 'never spend mobile data on a guess').toBe(false);
  expect(r.reason).toMatch(/cannot confirm/);
});

test('"always" syncs even where metering is unknown', () => {
  expect(shouldAutoSync({ ...base, policy: 'always', connection: UNKNOWN }).sync).toBe(true);
  expect(shouldAutoSync({ ...base, policy: 'always', connection: METERED }).sync).toBe(true);
});

test('"off" never syncs on its own', () => {
  expect(shouldAutoSync({ ...base, policy: 'off', connection: UNMETERED }).sync).toBe(false);
});

test('offline, unconfigured or mid-session never triggers a sync', () => {
  /** The one case that would otherwise sync, so each field below is the only
   *  thing standing in the way. */
  const on: AutoSyncInput = { ...base, policy: 'always', connection: UNMETERED };
  expect(shouldAutoSync({ ...on, online: false }).sync).toBe(false);
  expect(shouldAutoSync({ ...on, configured: false }).sync).toBe(false);
  expect(shouldAutoSync({ ...on, busy: true }).sync).toBe(false);
});

test('a recent sync is not repeated', () => {
  const now = base.now;
  const justNow = shouldAutoSync({
    ...base,
    policy: 'always',
    connection: UNMETERED,
    lastSyncAt: (now ?? 0) - 60_000,
  });
  const longAgo = shouldAutoSync({
    ...base,
    policy: 'always',
    connection: UNMETERED,
    lastSyncAt: (now ?? 0) - 3_600_000,
  });
  expect(justNow.sync).toBe(false);
  expect(justNow.reason).toMatch(/1 min ago/);
  expect(longAgo.sync).toBe(true);
});

test('the two transfers have different defaults, because they differ in size', () => {
  expect(DEFAULT_POLICY, 'a 30 kB sync is not worth gating').toBe('always');
  expect(DEFAULT_BULK_POLICY, 'megabytes of audio are').toBe('unmetered');
});

test('connection state is read from what the browser actually exposes', () => {
  expect(connectionState(conn({ type: 'wifi' }))).toBe(UNMETERED);
  expect(connectionState(conn({ type: 'ethernet' }))).toBe(UNMETERED);
  expect(connectionState(conn({ type: 'cellular' }))).toBe(METERED);
  expect(
    connectionState(conn({ saveData: true, type: 'wifi' })),
    'Data Saver overrides everything else',
  ).toBe(METERED);
  expect(
    connectionState(conn({ effectiveType: '4g' })),
    'speed is not cost, so effectiveType decides nothing',
  ).toBe(UNKNOWN);
  expect(connectionState(null)).toBe(UNKNOWN);
});

test('the app can tell whether this browser knows about metering', () => {
  expect(canDetectMetering(conn({ type: 'wifi' }))).toBe(true);
  expect(canDetectMetering(conn({ saveData: true }))).toBe(true);
  expect(canDetectMetering(conn({ effectiveType: '4g' }))).toBe(false);
  expect(canDetectMetering(null)).toBe(false);
});

test('the settings label admits when the policy cannot fire', () => {
  expect(policyLabel('unmetered', false)).toMatch(/cannot tell/);
  expect(policyLabel('unmetered', true)).toMatch(/wifi/);
  expect(policyLabel('off', true)).toMatch(/press Sync/);
});

// --- bulk audio, where metering actually costs something ---------------------

/** The gated default: audio on wifi only, on a device that has not consented. */
const bulk: BulkDownloadInput = { policy: 'unmetered', online: true, consented: false };

test('audio downloads freely on wifi', () => {
  expect(bulkDownloadDecision({ ...bulk, connection: UNMETERED }).decision).toBe('yes');
});

test('audio asks before spending mobile data', () => {
  const r = bulkDownloadDecision({ ...bulk, connection: METERED });
  expect(r.decision).toBe('ask');
  expect(r.reason).toMatch(/metered/);
});

test('an unknown connection asks once rather than refusing forever', () => {
  const r = bulkDownloadDecision({ ...bulk, connection: UNKNOWN });
  expect(r.decision, 'this is the case most browsers land in').toBe('ask');
  expect(r.reason).toMatch(/cannot tell/);
});

test('once you consent on a device it stops asking', () => {
  expect(bulkDownloadDecision({ ...bulk, connection: METERED, consented: true }).decision).toBe(
    'yes',
  );
  expect(bulkDownloadDecision({ ...bulk, connection: UNKNOWN, consented: true }).decision).toBe(
    'yes',
  );
});

test('offline never downloads, whatever the policy or consent', () => {
  expect(
    bulkDownloadDecision({
      policy: 'always',
      online: false,
      consented: true,
      connection: UNMETERED,
    }).decision,
  ).toBe('no');
});

test('the explicit policies override the guessing entirely', () => {
  expect(
    bulkDownloadDecision({ ...bulk, policy: 'always', connection: METERED }).decision,
  ).toBe('yes');
  expect(bulkDownloadDecision({ ...bulk, policy: 'off', connection: UNMETERED }).decision).toBe(
    'no',
  );
});

test('bulk policy labels say what will happen', () => {
  expect(bulkPolicyLabel('unmetered')).toMatch(/wifi/);
  expect(bulkPolicyLabel('off')).toMatch(/Never/);
  expect(bulkPolicyLabel('always')).toMatch(/any connection/);
});

test('the voice is never fetched without being asked for, whatever the connection', () => {
  const ask = (connection: ConnectionState) =>
    modelDownloadDecision({ connection, policy: 'unmetered' });
  expect(ask(UNMETERED).decision, 'not even on wifi: 380 MB is asked for, never assumed').toBe(
    'ask',
  );
  expect(ask(METERED).decision).toBe('ask');
  expect(ask(UNKNOWN).decision).toBe('ask');
  expect(
    modelDownloadDecision({ connection: UNMETERED, policy: 'always' }).decision,
    'even "download on any connection" does not pre-approve the voice',
  ).toBe('ask');
});

test('how loudly to ask depends on what the connection can be shown to be', () => {
  expect(modelDownloadDecision({ connection: METERED }).urgent).toBe(true);
  expect(
    modelDownloadDecision({ connection: UNKNOWN }).urgent,
    'a browser that will not say is treated as if it might be metered',
  ).toBe(true);
  expect(modelDownloadDecision({ connection: UNMETERED }).urgent).toBe(false);
});

test('nothing is asked once the voice is here, and nothing when it cannot come', () => {
  expect(modelDownloadDecision({ cached: true, connection: METERED }).decision).toBe('yes');
  expect(modelDownloadDecision({ supported: false }).decision).toBe('no');
  expect(modelDownloadDecision({ online: false }).decision).toBe('no');
  expect(modelDownloadDecision({ policy: 'off' }).decision).toBe('no');
  expect(
    modelDownloadDecision({ cached: true, policy: 'off' }).decision,
    'a voice already here is not a download',
  ).toBe('yes');
});
