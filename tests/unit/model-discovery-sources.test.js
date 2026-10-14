import '../test-env.js';
/**
 * Stage 5: per-source model discovery helpers in model-discovery.js.
 * Covers getDiscoveredSourceModels / discoverModelsForSource keying,
 * negative cache, and claude-account fallback behavior.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDiscoveredSourceModels,
  discoverModelsForSource,
} from '../../src/model-discovery.js';
import { addApiKey, removeApiKey } from '../../src/api-key-manager.js';

const originalFetch = globalThis.fetch;
const CALLS = [];

test.beforeEach(() => {
  CALLS.length = 0;
  globalThis.fetch = async (url) => {
    CALLS.push(url);
    if (String(url).includes('/models')) {
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'src-model-a' }, { id: 'src-model-b' }] })
      };
    }
    throw new Error('unexpected fetch');
  };
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

test('discoverModelsForSource: apikey source discovers and caches its own list', async () => {
  const { id } = addApiKey({ type: 'openrouter', name: 'src-test', apiKey: 'sk-test' });
  const sourceId = `apikey:${id}`;
  try {
    const models = await discoverModelsForSource(sourceId);
    assert.deepEqual(models, ['src-model-a', 'src-model-b']);
    assert.deepEqual(getDiscoveredSourceModels(sourceId), models, 'cache exposes the same list');
    const callsAfterFirst = CALLS.length;
    await discoverModelsForSource(sourceId);
    assert.equal(CALLS.length, callsAfterFirst, 'fresh cache answers without refetching');
  } finally {
    removeApiKey(id);
  }
});

test('getDiscoveredSourceModels: unknown source returns null', () => {
  assert.equal(getDiscoveredSourceModels('apikey:does-not-exist'), null);
  assert.equal(getDiscoveredSourceModels(''), null);
});

test('discoverModelsForSource: claude source degrades gracefully (no per-account list)', async () => {
  const models = await discoverModelsForSource('claude:nobody@example.com');
  assert.deepEqual(models, []);
});

test('discoverModelsForSource: repeated failures stay in negative cache without hammering', async () => {
  // Unsupported source type always throws — the negative cache should absorb
  // repeated attempts, so subsequent calls return [] without new work.
  const models1 = await discoverModelsForSource('badtype:x');
  const models2 = await discoverModelsForSource('badtype:x');
  assert.deepEqual(models1, []);
  assert.deepEqual(models2, []);
});
