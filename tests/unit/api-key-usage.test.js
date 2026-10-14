import '../test-env.js';
/**
 * Stage 3: subscription usage/limits for API keys (ClinePass plan windows,
 * Ollama Cloud balance). Covers the preset-driven fetchUsage parsers, the
 * 5-minute TTL cache in getApiKeyUsage, the unsupported-provider gate, and
 * snapshot persistence on the key record. No server required — fetch is mocked.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addApiKey,
  removeApiKey,
  getApiKeyUsage,
  getApiKeyById,
} from '../../src/api-key-manager.js';
import { getProviderById } from '../../src/api-key-manager.js';
import { handleGetApiKeyUsage } from '../../src/routes/api-keys-route.js';

const originalFetch = globalThis.fetch;
let FETCH_CALLS = [];

function mockRes() {
  return {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
}

// Route usage URLs to fixtures; anything else is a test bug.
function installFetchMock() {
  globalThis.fetch = async (url) => {
    FETCH_CALLS.push(String(url));
    if (String(url).includes('/users/me/plan/usage-limits')) {
      return {
        ok: true,
        json: async () => ({
          five_hour: { percentUsed: 40, resetsAt: '2026-10-14T18:00:00Z' },
          weekly: { percentUsed: 10, resetsAt: '2026-10-20T00:00:00Z' },
          monthly: { percentUsed: 5, resetsAt: '2026-11-01T00:00:00Z' },
        }),
      };
    }
    if (String(url).includes('/api/balance')) {
      return {
        ok: true,
        json: async () => ({
          included: { balance_usd: 2.5, allowance_usd: 0.5, period: 'monthly' },
          purchased: [{ balance_usd: 1.25 }],
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

test.beforeEach(() => {
  FETCH_CALLS = [];
  installFetchMock();
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

test('clinepass fetchUsage normalizes plan windows', async () => {
  const { id } = addApiKey({ type: 'clinepass', name: 'cp', apiKey: 'cp-key' });
  try {
    const provider = getProviderById(id);
    const usage = await provider.fetchUsage();
    assert.equal(usage.kind, 'windows');
    assert.deepEqual(usage.windows.map((w) => [w.id, w.percentUsed]), [
      ['five_hour', 40],
      ['weekly', 10],
      ['monthly', 5],
    ]);
    assert.ok(usage.windows[0].resetsAt.startsWith('2026-10-14T18:00:00'));
    assert.equal(usage.balance, null);
    assert.ok(usage.fetchedAt);
    assert.ok(FETCH_CALLS[0].includes('api.cline.bot/api/v1/users/me/plan/usage-limits'));
  } finally {
    removeApiKey(id);
  }
});

test('ollama-cloud fetchUsage sums included balance + purchased credits', async () => {
  const { id } = addApiKey({ type: 'ollama-cloud', name: 'oc', apiKey: 'oc-key' });
  try {
    const usage = await getProviderById(id).fetchUsage();
    assert.equal(usage.kind, 'balance');
    assert.equal(usage.balance.remaining, 4.25);
    assert.equal(usage.balance.unit, 'USD');
    assert.equal(usage.balance.period, 'monthly');
    assert.deepEqual(usage.windows, []);
    assert.ok(FETCH_CALLS[0].includes('ollama.com/api/balance'), 'balance endpoint is not under /v1');
  } finally {
    removeApiKey(id);
  }
});

test('getApiKeyUsage caches within TTL, refresh bypasses, usage persists on the record', async () => {
  const { id } = addApiKey({ type: 'clinepass', name: 'cp-cache', apiKey: 'cp-key' });
  try {
    const first = await getApiKeyUsage(id);
    assert.equal(first.success, true);
    assert.equal(first.supported, true);
    assert.equal(first.cached, false);

    const second = await getApiKeyUsage(id);
    assert.equal(second.cached, true, 'TTL window serves the snapshot without refetching');
    assert.equal(FETCH_CALLS.length, 1);

    const forced = await getApiKeyUsage(id, { refresh: true });
    assert.equal(forced.cached, false);
    assert.equal(FETCH_CALLS.length, 2);

    const record = getApiKeyById(id);
    assert.equal(record.usage.kind, 'windows', 'snapshot survives saveKeys via toJSON');
    assert.ok(record.usageUpdatedAt);
  } finally {
    removeApiKey(id);
  }
});

test('getApiKeyUsage: unsupported providers answer supported:false, unknown id errors', async () => {
  const { id } = addApiKey({ type: 'openai', name: 'plain', apiKey: 'sk-x' });
  try {
    const unsupported = await getApiKeyUsage(id);
    assert.equal(unsupported.success, true);
    assert.equal(unsupported.supported, false);
    assert.equal(FETCH_CALLS.length, 0, 'no network for providers without a usage preset');

    const missing = await getApiKeyUsage('key_missing');
    assert.equal(missing.success, false);
    assert.equal(missing.error, 'Key not found');
  } finally {
    removeApiKey(id);
  }
});

test('handleGetApiKeyUsage: 404 for unknown key, snapshot payload for a usage key', async () => {
  const { id } = addApiKey({ type: 'ollama-cloud', name: 'oc-route', apiKey: 'oc-key' });
  try {
    const notFound = mockRes();
    await handleGetApiKeyUsage({ params: { id: 'nope' }, query: {} }, notFound);
    assert.equal(notFound._status, 404);

    const res = mockRes();
    await handleGetApiKeyUsage({ params: { id }, query: {} }, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.success, true);
    assert.equal(res._body.usage.kind, 'balance');
    assert.equal(res._body.usage.balance.remaining, 4.25);
  } finally {
    removeApiKey(id);
  }
});

test('fetchUsage failure surfaces the error but keeps the stale snapshot', async () => {
  const { id } = addApiKey({ type: 'clinepass', name: 'cp-stale', apiKey: 'cp-key' });
  try {
    const ok = await getApiKeyUsage(id);
    assert.equal(ok.success, true);
    const stale = ok.usage;

    globalThis.fetch = async () => ({ ok: false, status: 402 });
    const failed = await getApiKeyUsage(id, { refresh: true });
    assert.equal(failed.success, false);
    assert.match(failed.error, /HTTP 402 \(no subscription credits\)/);
    assert.deepEqual(failed.usage, stale, 'last known limits survive an upstream failure');
  } finally {
    removeApiKey(id);
    installFetchMock();
  }
});
