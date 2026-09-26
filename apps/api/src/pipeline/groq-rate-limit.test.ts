import test from 'node:test';
import assert from 'node:assert/strict';
import { GroqRateGate, providerRetryDelayMs } from './groq-rate-limit.js';

test('rate-limit retries honor the provider body wait when no header is present', () => {
  assert.equal(providerRetryDelayMs(null, null, 'Please try again in 21.27s.', 0), 21_520);
});

test('rate-limit retries prefer Retry-After and parse reset durations', () => {
  assert.equal(providerRetryDelayMs('3', '45s', 'Please try again in 21s.', 0), 45_250);
  assert.equal(providerRetryDelayMs(null, '1m2.5s', '', 0), 62_750);
});

test('Groq requests are serialized through a shared gate', async () => {
  const gate = new GroqRateGate();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const first = gate.schedule(10, async () => {
    events.push('first:start');
    await new Promise<void>((resolve) => { releaseFirst = resolve; });
    events.push('first:end');
  });
  const second = gate.schedule(10, async () => { events.push('second:start'); });
  await Promise.resolve();
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});
