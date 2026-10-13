import '../test-env.js';
/**
 * Unit tests for the extended tier system (stage 4: fable + default slots).
 * No server required — logic tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    recognizeTier,
    resolveModel,
    getMappings,
    setProviderMappings,
    autoUpdateMappings,
    getMappingsMeta,
    TIERS,
} from '../../src/model-mapping.js';
import { TIERS as SHARED_TIERS, TIER_INFO } from '../../src/model-tiers.js';
import { presetTierMappings } from '../../src/providers/provider-presets.js';

// ─── Shared tier definitions ────────────────────────────────────────────────

test('model-tiers: TIERS order matches the UI display order', () => {
    assert.deepEqual(SHARED_TIERS, ['fable', 'flagship', 'reasoning', 'standard', 'fast', 'default']);
});

test('model-tiers: TIER_INFO has a label for every tier (fable is Frontier)', () => {
    for (const tier of SHARED_TIERS) {
        assert.ok(TIER_INFO[tier]?.label, `missing label for ${tier}`);
    }
    assert.equal(TIER_INFO.fable.label, 'Frontier');
});

test('model-mapping re-exports the shared TIERS', () => {
    assert.equal(TIERS, SHARED_TIERS);
});

test('getMappingsMeta: tierOrder includes fable and default', () => {
    const meta = getMappingsMeta();
    assert.deepEqual(meta.tierOrder, ['fable', 'flagship', 'reasoning', 'standard', 'fast', 'default']);
    assert.equal(meta.tiers.fable.label, 'Frontier');
    assert.equal(meta.tiers.default.label, 'Default');
});

// ─── recognizeTier ──────────────────────────────────────────────────────────

test('recognizeTier: claude-fable-* maps to the fable tier', () => {
    assert.equal(recognizeTier('claude-fable-5-1'), 'fable');
    assert.equal(recognizeTier('fable'), 'fable');
});

test('recognizeTier: fable wins over flagship keywords (claude-fable-opus)', () => {
    // The fable check runs before opus/pro so a fable-tier id never
    // misclassifies as flagship.
    assert.equal(recognizeTier('claude-fable-opus-5'), 'fable');
});

test('recognizeTier: unrecognized model falls into the default slot', () => {
    assert.equal(recognizeTier('totally-unknown-model'), 'default');
    assert.equal(recognizeTier('mystery-ai-v9'), 'default');
});

test('recognizeTier: null/empty stays standard', () => {
    assert.equal(recognizeTier(null), 'standard');
    assert.equal(recognizeTier(undefined), 'standard');
    assert.equal(recognizeTier(''), 'standard');
});

test('recognizeTier: existing tiers are unaffected', () => {
    assert.equal(recognizeTier('claude-opus-4-6'), 'flagship');
    assert.equal(recognizeTier('o3'), 'reasoning');
    assert.equal(recognizeTier('claude-haiku-4-5'), 'fast');
    assert.equal(recognizeTier('claude-sonnet-4-6'), 'standard');
    assert.equal(recognizeTier('gpt-5.4'), 'standard');
});

// ─── resolveModel with fable/default ────────────────────────────────────────

test('resolveModel: fable tier resolves to the fable slot (mirrors flagship by default)', () => {
    assert.equal(resolveModel('openai', 'claude-fable-5-1'), 'gpt-5.4');
    // claude-* ids are native for anthropic (pass through) — use a foreign id
    // to exercise the fable slot itself.
    assert.equal(resolveModel('anthropic', 'gpt-fable-5-1'), 'claude-opus-4-6');
});

test('resolveModel: default tier resolves to the default slot (mirrors standard by default)', () => {
    assert.equal(resolveModel('openai', 'totally-unknown-model'), 'gpt-5.4-mini');
});

test('resolveModel: a customized default slot wins over standard for unrecognized models', () => {
    try {
        setProviderMappings('openai', { default: 'gpt-5.4-nano' });
        assert.equal(resolveModel('openai', 'totally-unknown-model'), 'gpt-5.4-nano');
        // standard is untouched
        assert.equal(resolveModel('openai', 'claude-sonnet-4-6'), 'gpt-5.4-mini');
    } finally {
        setProviderMappings('openai', { default: 'gpt-5.4-mini' });
    }
});

test('resolveModel: fable and default stay pass-through for native models', () => {
    assert.equal(resolveModel('openai', 'gpt-5.4'), 'gpt-5.4');
    assert.equal(resolveModel('anthropic', 'claude-sonnet-4-6'), 'claude-sonnet-4-6');
});

// ─── Defaults merge ─────────────────────────────────────────────────────────

test('loadMappings: every built-in provider covers fable and default', () => {
    const mappings = getMappings();
    for (const [provider, tierMap] of Object.entries(mappings.providers)) {
        assert.ok(tierMap.fable, `${provider} is missing the fable slot`);
        assert.ok(tierMap.default, `${provider} is missing the default slot`);
        // No-op semantics: fable mirrors flagship, default mirrors standard.
        assert.equal(tierMap.fable, tierMap.flagship, `${provider}: fable should mirror flagship`);
        assert.equal(tierMap.default, tierMap.standard, `${provider}: default should mirror standard`);
    }
});

test('presetTierMappings: derived fable/default fill the full tier set', () => {
    const qwen = presetTierMappings().qwen;
    assert.equal(qwen.fable, qwen.flagship);
    assert.equal(qwen.default, qwen.standard);
    // Preset-declared keys survive the derivation.
    assert.equal(qwen.flagship, 'qwen-max');
});

// ─── autoUpdateMappings never touches the default slot ──────────────────────

test('autoUpdateMappings: skips the default tier even when tierMap includes it', () => {
    try {
        autoUpdateMappings('openai', { default: 'some-discovered-model', flagship: 'gpt-5.4' });
        assert.equal(getMappings().providers.openai.default, 'gpt-5.4-mini',
            'default slot must not be auto-filled from discovery');
    } finally {
        setProviderMappings('openai', { default: 'gpt-5.4-mini' });
    }
});
