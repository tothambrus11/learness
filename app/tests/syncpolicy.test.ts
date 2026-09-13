import { test } from 'vitest';
import assert from 'node:assert/strict';
import { canDetectMetering, connectionState, METERED, UNKNOWN, UNMETERED }
  from '../src/lib/network.js';
import type { ConnectionState } from '../src/lib/network.js';
import { bulkDownloadDecision, bulkPolicyLabel, DEFAULT_BULK_POLICY, DEFAULT_POLICY,
  modelDownloadDecision,
  policyLabel, shouldAutoSync } from '../src/lib/syncpolicy.js';

import { ms } from './make.js';

const base = { configured: true, online: true, lastSyncAt: ms(0), now: ms(1_000_000_000) };

test('wifi syncs on its own', () => {
  const r = shouldAutoSync({ ...base, policy: 'unmetered', connection: UNMETERED });
  assert.equal(r.sync, true);
});

test('mobile data waits to be asked', () => {
  const r = shouldAutoSync({ ...base, policy: 'unmetered', connection: METERED });
  assert.equal(r.sync, false);
  assert.match(r.reason, /metered/);
});

test('an unknown connection is treated as metered, not as wifi', () => {
  const r = shouldAutoSync({ ...base, policy: 'unmetered', connection: UNKNOWN });
  assert.equal(r.sync, false, 'never spend mobile data on a guess');
  assert.match(r.reason, /cannot confirm/);
});

test('"always" syncs even where metering is unknown', () => {
  assert.equal(shouldAutoSync({ ...base, policy: 'always', connection: UNKNOWN }).sync, true);
  assert.equal(shouldAutoSync({ ...base, policy: 'always', connection: METERED }).sync, true);
});

test('"off" never syncs on its own', () => {
  assert.equal(shouldAutoSync({ ...base, policy: 'off', connection: UNMETERED }).sync, false);
});

test('offline, unconfigured or mid-session never triggers a sync', () => {
  const on = { ...base, policy: 'always' as const, connection: UNMETERED };
  assert.equal(shouldAutoSync({ ...on, online: false }).sync, false);
  assert.equal(shouldAutoSync({ ...on, configured: false }).sync, false);
  assert.equal(shouldAutoSync({ ...on, busy: true }).sync, false);
});

test('a recent sync is not repeated', () => {
  const now = base.now;
  const justNow = shouldAutoSync({
    ...base, policy: 'always', connection: UNMETERED, lastSyncAt: ms(now - 60_000) });
  const longAgo = shouldAutoSync({
    ...base, policy: 'always', connection: UNMETERED, lastSyncAt: ms(now - 3_600_000) });
  assert.equal(justNow.sync, false);
  assert.match(justNow.reason, /1 min ago/);
  assert.equal(longAgo.sync, true);
});

test('the two transfers have different defaults, because they differ in size', () => {
  assert.equal(DEFAULT_POLICY, 'always', 'a 30 kB sync is not worth gating');
  assert.equal(DEFAULT_BULK_POLICY, 'unmetered', 'megabytes of audio are');
});

test('connection state is read from what the browser actually exposes', () => {
  assert.equal(connectionState({ type: 'wifi' }), UNMETERED);
  assert.equal(connectionState({ type: 'ethernet' }), UNMETERED);
  assert.equal(connectionState({ type: 'cellular' }), METERED);
  assert.equal(connectionState({ saveData: true, type: 'wifi' }), METERED,
    'Data Saver overrides everything else');
  assert.equal(connectionState({ effectiveType: '4g' }), UNKNOWN,
    'speed is not cost, so effectiveType decides nothing');
  assert.equal(connectionState(null), UNKNOWN);
});

test('the app can tell whether this browser knows about metering', () => {
  assert.equal(canDetectMetering({ type: 'wifi' }), true);
  assert.equal(canDetectMetering({ saveData: true }), true);
  assert.equal(canDetectMetering({ effectiveType: '4g' }), false);
  assert.equal(canDetectMetering(null), false);
});

test('the settings label admits when the policy cannot fire', () => {
  assert.match(policyLabel('unmetered', false), /cannot tell/);
  assert.match(policyLabel('unmetered', true), /wifi/);
  assert.match(policyLabel('off', true), /press Sync/);
});


// --- bulk audio, where metering actually costs something ---------------------

const bulk = { policy: 'unmetered' as const, online: true, consented: false };

test('audio downloads freely on wifi', () => {
  assert.equal(bulkDownloadDecision({ ...bulk, connection: UNMETERED }).decision, 'yes');
});

test('audio asks before spending mobile data', () => {
  const r = bulkDownloadDecision({ ...bulk, connection: METERED });
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /metered/);
});

test('an unknown connection asks once rather than refusing forever', () => {
  const r = bulkDownloadDecision({ ...bulk, connection: UNKNOWN });
  assert.equal(r.decision, 'ask', 'this is the case most browsers land in');
  assert.match(r.reason, /cannot tell/);
});

test('once you consent on a device it stops asking', () => {
  assert.equal(
    bulkDownloadDecision({ ...bulk, connection: METERED, consented: true }).decision, 'yes');
  assert.equal(
    bulkDownloadDecision({ ...bulk, connection: UNKNOWN, consented: true }).decision, 'yes');
});

test('offline never downloads, whatever the policy or consent', () => {
  assert.equal(bulkDownloadDecision({
    policy: 'always', online: false, consented: true, connection: UNMETERED }).decision, 'no');
});

test('the explicit policies override the guessing entirely', () => {
  assert.equal(
    bulkDownloadDecision({ ...bulk, policy: 'always', connection: METERED }).decision, 'yes');
  assert.equal(
    bulkDownloadDecision({ ...bulk, policy: 'off', connection: UNMETERED }).decision, 'no');
});

test('bulk policy labels say what will happen', () => {
  assert.match(bulkPolicyLabel('unmetered'), /wifi/);
  assert.match(bulkPolicyLabel('off'), /Never/);
  assert.match(bulkPolicyLabel('always'), /any connection/);
});

test('the voice is never fetched without being asked for, whatever the connection', () => {
  /* 380 MB is the one download in the app big enough to matter on a data plan,
     so unlike a level's audio it is not started on a policy alone. */
  const ask = (connection: ConnectionState) =>
    modelDownloadDecision({ connection, policy: 'unmetered' });
  assert.equal(ask(UNMETERED).decision, 'ask');
  assert.equal(ask(METERED).decision, 'ask');
  assert.equal(ask(UNKNOWN).decision, 'ask');
  assert.equal(modelDownloadDecision({ connection: UNMETERED, policy: 'always' }).decision, 'ask',
    'even "download on any connection" does not pre-approve the voice');
});

test('how loudly to ask depends on what the connection can be shown to be', () => {
  assert.equal(modelDownloadDecision({ connection: METERED }).urgent, true);
  assert.equal(modelDownloadDecision({ connection: UNKNOWN }).urgent, true,
    'a browser that will not say is treated as if it might be metered');
  assert.equal(modelDownloadDecision({ connection: UNMETERED }).urgent, false);
});

test('nothing is asked once the voice is here, and nothing when it cannot come', () => {
  assert.equal(modelDownloadDecision({ cached: true, connection: METERED }).decision, 'yes');
  assert.equal(modelDownloadDecision({ supported: false }).decision, 'no');
  assert.equal(modelDownloadDecision({ online: false }).decision, 'no');
  assert.equal(modelDownloadDecision({ policy: 'off' }).decision, 'no');
  assert.equal(modelDownloadDecision({ cached: true, policy: 'off' }).decision, 'yes',
    'a voice already here is not a download');
});
