// Stage 6b: custom-preset hot reload. reloadUserPresets() + the refresh chain
// mutate in-memory module state (preset index, tier mappings, pricing tables,
// provider classes), so each scenario runs in its own child process with a
// fresh CLIGATE_CONFIG_DIR — same pattern as provider-user-presets.test.js.
import '../test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');

/**
 * Run a scenario script in a child process. The script runs after a user
 * presets file with the given entries has been seeded into the config dir;
 * stdout's last line must be JSON.
 */
function runScenario(presets, script) {
  const configDir = join(globalThis.__cligateTestEnvRoot, `hotreload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(configDir, { recursive: true });
  if (presets !== null) {
    writeFileSync(join(configDir, 'provider-presets.json'), JSON.stringify(presets));
  }
  const result = spawnSync(process.execPath, [
    '--input-type=module', '-e', script,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CLIGATE_CONFIG_DIR: configDir },
  });
  if (result.status !== 0) {
    throw new Error(`child failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

const SNAPSHOT_SNIPPET = `
import { PRESET_BY_ID, reloadUserPresets } from './src/providers/provider-presets.js';
import { refreshPresetMerges, getMappings } from './src/model-mapping.js';
import { refreshPresetPricing, getDefaultPricing } from './src/pricing-registry.js';
import { refreshPresetProviderClasses, addApiKey, getApiKeysByType, removeApiKey } from './src/api-key-manager.js';
const reload = () => { reloadUserPresets(); refreshPresetMerges(); refreshPresetPricing(); refreshPresetProviderClasses(); };
`;

test('saving a preset hot-reloads the index, tier map, pricing, and provider class', () => {
  const out = runScenario(null, SNAPSHOT_SNIPPET + `
// Not loaded yet
if (PRESET_BY_ID['hot-vendor']) throw new Error('preset should not exist before reload');

// Simulate the custom-preset API write: file only, no restart
const { writeUserPresetsFile } = await import('./src/providers/preset-store.js');
await writeUserPresetsFile([{ id: 'hot-vendor', baseUrl: 'https://hot.example/v1', models: ['hot/large'],
  tiers: { flagship: 'hot/large', standard: 'hot/small' },
  pricing: { 'hot/large': { input: 1.5, output: 6 } } }]);
reload();

const preset = PRESET_BY_ID['hot-vendor'];
if (!preset) throw new Error('PRESET_BY_ID missing hot-vendor after reload');
if (getMappings().providers['hot-vendor']?.flagship !== 'hot/large') throw new Error('tier map not merged');
if (getMappings().providers['hot-vendor']?.fable !== 'hot/large') throw new Error('fable not derived from flagship');
if (getMappings().providers['hot-vendor']?.default !== 'hot/small') throw new Error('default not derived from standard');
if (getDefaultPricing('hot-vendor')['hot/large']?.input !== 1.5) throw new Error('pricing not merged');

// Lazy registration: a key of the runtime-added type resolves to an instance
const added = addApiKey({ type: 'hot-vendor', apiKey: 'sk-hot' });
if (!added.success) throw new Error('addApiKey rejected runtime preset: ' + added.error);
const providers = getApiKeysByType('hot-vendor');
if (providers.length !== 1 || providers[0].baseUrl !== 'https://hot.example/v1') {
  throw new Error('provider instance missing or wrong baseUrl');
}
console.log(JSON.stringify({ ok: true }));
`);
  assert.equal(out.ok, true);
});

test('editing a preset rebuilds its provider class (instances rebuilt lazily)', () => {
  const out = runScenario([{ id: 'hot-vendor', baseUrl: 'https://old.example/v1' }], SNAPSHOT_SNIPPET + `
const added = addApiKey({ type: 'hot-vendor', apiKey: 'sk-hot' });
if (!added.success) throw new Error('addApiKey failed: ' + added.error);
const before = getApiKeysByType('hot-vendor');
if (before[0].baseUrl !== 'https://old.example/v1') throw new Error('initial baseUrl wrong');

// Edit the preset's baseUrl in the file, then hot-reload
const { writeUserPresetsFile } = await import('./src/providers/preset-store.js');
await writeUserPresetsFile([{ id: 'hot-vendor', baseUrl: 'https://new.example/v1' }]);
reload();
if (PRESET_BY_ID['hot-vendor'].baseUrl !== 'https://new.example/v1') throw new Error('index not updated');

const after = getApiKeysByType('hot-vendor');
if (after[0].baseUrl !== 'https://new.example/v1') {
  throw new Error('instance not rebuilt from the new preset (stale baseUrl ' + after[0].baseUrl + ')');
}
console.log(JSON.stringify({ ok: true }));
`);
  assert.equal(out.ok, true);
});

test('deleting a preset removes its class; keys of that type stop resolving', () => {
  const out = runScenario([{ id: 'hot-vendor', baseUrl: 'https://hot.example/v1', tiers: { flagship: 'hot/large', standard: 'hot/small' } }], SNAPSHOT_SNIPPET + `
const added = addApiKey({ type: 'hot-vendor', apiKey: 'sk-hot' });
if (!added.success) throw new Error('addApiKey failed: ' + added.error);
if (getApiKeysByType('hot-vendor').length !== 1) throw new Error('precondition: provider should resolve');

const { writeUserPresetsFile } = await import('./src/providers/preset-store.js');
await writeUserPresetsFile([]);
reload();

if (PRESET_BY_ID['hot-vendor']) throw new Error('index still has hot-vendor after delete');
if (getApiKeysByType('hot-vendor').length !== 0) {
  throw new Error('keys of a deleted preset type must stop resolving');
}
// Tier/pricing merges are additive-only: stale entries persist until restart
if (!getMappings().providers['hot-vendor']) throw new Error('additive merge: stale tier map expected');
console.log(JSON.stringify({ ok: true }));
`);
  assert.equal(out.ok, true);
});
