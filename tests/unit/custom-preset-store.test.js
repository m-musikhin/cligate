import '../test-env.js';
/**
 * Stage 6a: user-defined preset persistence (preset-store.js) and the
 * custom-preset API (POST/DELETE /api/providers/custom-presets). Covers raw
 * file round-trips, the request whitelist, loader-parity validation, and
 * built-in protection. No server required — handlers run against mock req/res.
 * Success responses prove the hot-reload orchestration ran: the handler
 * re-merges preset state in memory and answers with the fresh preset list.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'fs';

import {
  readUserPresetsFile,
  writeUserPresetsFile,
  upsertUserPreset,
  removeUserPreset,
  USER_PRESETS_FILE,
} from '../../src/providers/preset-store.js';
import { handleSaveCustomPreset, handleDeleteCustomPreset } from '../../src/routes/api-keys-route.js';

function mockRes() {
  return {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
}

const VALID = { id: 'my-vendor', baseUrl: 'https://api.my-vendor.example/v1', models: ['my-vendor/large'] };

test('preset-store: read semantics (missing, wrong shape, array, {presets})', () => {
  assert.deepEqual(readUserPresetsFile(), [], 'absent file reads as empty');

  writeFileSync(USER_PRESETS_FILE, '{not json');
  assert.equal(readUserPresetsFile(), null, 'malformed JSON reads as null');

  writeFileSync(USER_PRESETS_FILE, JSON.stringify({ presets: [{ id: 'wrapped' }] }));
  assert.deepEqual(readUserPresetsFile().map((e) => e.id), ['wrapped'], '{presets: []} shape supported');

  writeFileSync(USER_PRESETS_FILE, JSON.stringify(['plain']));
  assert.deepEqual(readUserPresetsFile(), ['plain']);
});

test('preset-store: upsert appends new ids and replaces existing ones', () => {
  writeFileSync(USER_PRESETS_FILE, JSON.stringify([VALID]));

  const added = upsertUserPreset({ id: 'second-vendor', baseUrl: 'https://second.example/v1' });
  assert.equal(added.success, true);
  assert.equal(added.replaced, false);
  assert.deepEqual(readUserPresetsFile().map((e) => e.id), ['my-vendor', 'second-vendor']);

  const updated = upsertUserPreset({ id: 'my-vendor', baseUrl: 'https://moved.example/v1' });
  assert.equal(updated.success, true);
  assert.equal(updated.replaced, true);
  const entries = readUserPresetsFile();
  assert.equal(entries.length, 2, 'no duplicate id after upsert');
  assert.equal(entries.find((e) => e.id === 'my-vendor').baseUrl, 'https://moved.example/v1');
});

test('preset-store: remove deletes one entry, reports missing ids', () => {
  writeFileSync(USER_PRESETS_FILE, JSON.stringify([VALID, { id: 'keep-me', baseUrl: 'https://keep.example/v1' }]));

  const missing = removeUserPreset('never-existed');
  assert.equal(missing.success, false);
  assert.equal(missing.error, 'not found');

  const removed = removeUserPreset('my-vendor');
  assert.equal(removed.success, true);
  assert.deepEqual(readUserPresetsFile().map((e) => e.id), ['keep-me']);
});

test('handleSaveCustomPreset: 400 on loader-rejected entries, whitelist on write', () => {
  // missing baseUrl
  let res = mockRes();
  handleSaveCustomPreset({ body: { id: 'broken' } }, res);
  assert.equal(res._status, 400);
  assert.match(res._body.error, /baseUrl/);

  // built-in collision
  res = mockRes();
  handleSaveCustomPreset({ body: { id: 'zhipu', baseUrl: 'https://x/v1' } }, res);
  assert.equal(res._status, 400);
  assert.match(res._body.error, /collides with a built-in/);

  // unknown tier key
  res = mockRes();
  handleSaveCustomPreset({ body: { id: 'badtier', baseUrl: 'https://x/v1', tiers: { flagship: 'm1', bogus: 'm2' } } }, res);
  assert.equal(res._status, 400);
  assert.match(res._body.error, /unknown tier/);

  // valid entry: junk fields are dropped, file holds the whitelisted shape
  res = mockRes();
  handleSaveCustomPreset({
    body: { ...VALID, apiKey: 'steal-me', __proto__: { hacked: true }, website: 'https://my-vendor.example' },
  }, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.success, true);
  assert.equal(res._body.replaced, false);
  assert.equal(res._body.reloaded, true, 'handler hot-reloads preset state after the write');
  assert.ok(Array.isArray(res._body.presets), 'response carries the post-reload preset list');
  assert.ok(res._body.presets.some((p) => p.id === 'my-vendor'), 'saved preset is merged in memory');

  const stored = readUserPresetsFile().find((e) => e.id === 'my-vendor');
  assert.equal(stored.baseUrl, VALID.baseUrl);
  assert.equal(stored.website, 'https://my-vendor.example');
  assert.equal(stored.apiKey, undefined, 'non-schema fields never reach the file');
  assert.equal(stored.label, 'my-vendor', 'loader defaults applied');
});

test('handleSaveCustomPreset: upsert of the same id replaces the file entry', () => {
  const first = mockRes();
  handleSaveCustomPreset({ body: { id: 'twice', baseUrl: 'https://a/v1' } }, first);
  assert.equal(first._body.replaced, false);

  const second = mockRes();
  handleSaveCustomPreset({ body: { id: 'twice', baseUrl: 'https://b/v1' } }, second);
  assert.equal(second._body.replaced, true);
  assert.equal(readUserPresetsFile().filter((e) => e.id === 'twice').length, 1);
});

test('handleDeleteCustomPreset: built-ins 400, missing 404, removal works', () => {
  let res = mockRes();
  handleDeleteCustomPreset({ params: { id: 'qwen' } }, res);
  assert.equal(res._status, 400);
  assert.match(res._body.error, /built-in/);

  res = mockRes();
  handleDeleteCustomPreset({ params: { id: 'ghost' } }, res);
  assert.equal(res._status, 404);

  writeFileSync(USER_PRESETS_FILE, JSON.stringify([VALID]));
  res = mockRes();
  handleDeleteCustomPreset({ params: { id: 'my-vendor' } }, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.success, true);
  assert.equal(res._body.reloaded, true, 'delete also hot-reloads');
  assert.ok(!res._body.presets.some((p) => p.id === 'my-vendor'), 'deleted preset leaves the in-memory list');
  assert.deepEqual(readUserPresetsFile(), []);
});

test('written file stays valid JSON on disk (atomic rename)', () => {
  handleSaveCustomPreset({ body: { id: 'atomic-check', baseUrl: 'https://atomic/v1' } }, mockRes());
  assert.ok(existsSync(USER_PRESETS_FILE));
  const raw = JSON.parse(readFileSync(USER_PRESETS_FILE, 'utf8'));
  assert.ok(raw.some((e) => e.id === 'atomic-check'));
});
