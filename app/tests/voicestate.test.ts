import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createVoiceQueue } from '../src/lib/voicequeue.js';
import { isMaking, isWaiting, making, watchQueue } from '../src/lib/voicestate.svelte.js';
import { fakeVoice, settle } from './fakevoice.js';

test('what a screen paints as being made follows the voice queue', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  const stop = watchQueue(queue);
  assert.equal(making.id, null);
  queue.warm([{ key: 'a|verb', slot: 's1', text: 'un' }, { key: 'b|verb', slot: 's1', text: 'bleu' }]);
  await settle();
  assert.equal(isMaking('a|verb', 's1'), true, 'on the voice');
  assert.equal(isMaking('a|verb'), true, 'any phrase of the word');
  assert.equal(isMaking('a|verb', 's2'), false, 'not another of its phrases');
  assert.equal(isMaking('b|verb'), false, 'the other word is only waiting');
  assert.equal(isWaiting('b|verb', 's1'), true);
  assert.equal(isWaiting('a|verb'), false);
  voice.release();
  await settle();
  assert.equal(isMaking('b|verb', 's1'), true, 'then the next');
  assert.deepEqual(making.waiting, []);
  stop();
  voice.release();
  await settle();
  assert.equal(isMaking('b|verb', 's1'), true, 'no longer mirrored once stopped');
});
