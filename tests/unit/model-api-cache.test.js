import '../test-env.js';
/**
 * Stage 5: per-source model filtering.
 * Covers the account-keyed MODEL_CACHE (two accounts must not share a list)
 * and the per-source discovery cache + route helpers.
 * No server required — fetch is mocked.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchModels, clearModelCache } from '../../src/model-api.js';

const CHATGPT_CALLS = [];
const originalFetch = globalThis.fetch;

function mockChatGptModelsResponse(slugs) {
  return {
    ok: true,
    json: async () => ({
      models: slugs.map((slug) => ({ slug, display_name: slug, supported_in_api: true }))
    })
  };
}

test.beforeEach(() => {
  CHATGPT_CALLS.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    CHATGPT_CALLS.push({ url, accountId: init.headers?.['ChatGPT-Account-ID'] });
    return mockChatGptModelsResponse(['gpt-5.4', 'gpt-5.4-mini']);
  };
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

test('fetchModels: two accounts get their own cache entries (no cross-account leak)', async () => {
  clearModelCache();

  await fetchModels('token-a', 'acct-a');
  await fetchModels('token-b', 'acct-b');

  assert.equal(CHATGPT_CALLS.length, 2, 'each account fetches its own list');
  assert.deepEqual(CHATGPT_CALLS.map((c) => c.accountId), ['acct-a', 'acct-b']);

  // Second round is served from the per-account cache — no new calls.
  await fetchModels('token-a', 'acct-a');
  await fetchModels('token-b', 'acct-b');
  assert.equal(CHATGPT_CALLS.length, 2);
});

test('clearModelCache(accountId) drops only that account', async () => {
  clearModelCache();
  await fetchModels('token-a', 'acct-a');
  await fetchModels('token-b', 'acct-b');
  assert.equal(CHATGPT_CALLS.length, 2);

  clearModelCache('acct-a');
  await fetchModels('token-a', 'acct-a');
  assert.equal(CHATGPT_CALLS.length, 3, 'acct-a refetches');
  await fetchModels('token-b', 'acct-b');
  assert.equal(CHATGPT_CALLS.length, 3, 'acct-b stays cached');
});
