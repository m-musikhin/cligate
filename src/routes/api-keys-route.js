/**
 * API Keys Route
 * CRUD endpoints for managing API keys across providers.
 */

import {
    addApiKey,
    removeApiKey,
    updateApiKey,
    listApiKeys,
    getApiKeyById,
    validateApiKey,
    getApiKeyUsage,
    getStats
} from '../api-key-manager.js';
import { presetUiList, userPresetProblem, normalizeUserPreset, isBuiltinPresetId, whitelistedUserPresetFields } from '../providers/provider-presets.js';
import { upsertUserPreset, removeUserPreset } from '../providers/preset-store.js';

export function handleListApiKeys(req, res) {
    const keys = listApiKeys();
    const stats = getStats();
    res.json({ keys, stats });
}

export function handleGetApiKey(req, res) {
    const { id } = req.params;
    const key = getApiKeyById(id);
    if (!key) {
        return res.status(404).json({ success: false, error: 'Key not found' });
    }
    res.json({ success: true, key });
}

export async function handleAddApiKey(req, res) {
    const { type, name, apiKey, baseUrl, deploymentName, apiVersion, projectId, location } = req.body;

    if (!type || !apiKey) {
        return res.status(400).json({ success: false, error: 'type and apiKey are required' });
    }

    const result = addApiKey({ type, name, apiKey, baseUrl, deploymentName, apiVersion, projectId, location });
    if (!result.success) {
        return res.status(400).json(result);
    }

    res.json(result);
}

export function handleRemoveApiKey(req, res) {
    const { id } = req.params;
    const result = removeApiKey(id);
    if (!result.success) {
        return res.status(404).json(result);
    }
    res.json(result);
}

export function handleUpdateApiKey(req, res) {
    const { id } = req.params;
    const { name, apiKey, baseUrl, enabled, deploymentName, apiVersion, projectId, location } = req.body;
    const result = updateApiKey(id, { name, apiKey, baseUrl, enabled, deploymentName, apiVersion, projectId, location });
    if (!result.success) {
        return res.status(404).json(result);
    }
    res.json(result);
}

export async function handleValidateApiKey(req, res) {
    const { id } = req.params;
    const result = await validateApiKey(id);
    res.json(result);
}

/**
 * GET /api/keys/:id/usage?refresh=1
 * Subscription usage snapshot for one key (ClinePass plan limits, Ollama
 * Cloud balance). Serves the ≤5-minute-old cached snapshot unless refresh=1.
 * Non-usage providers answer { supported: false } with HTTP 200 so the UI can
 * hide the limits cell instead of treating it as an error.
 */
export async function handleGetApiKeyUsage(req, res) {
    const { id } = req.params;
    const refresh = req.query?.refresh === 'true' || req.query?.refresh === '1';
    const result = await getApiKeyUsage(id, { refresh });
    if (result.error === 'Key not found') {
        return res.status(404).json(result);
    }
    res.json(result);
}

export function handleGetApiKeyStats(req, res) {
    res.json(getStats());
}

/**
 * GET /api/providers/presets
 * Declarative provider presets (provider-presets.js) so the dashboard can
 * render the add-key form data-driven instead of hardcoding each vendor.
 */
export function handleListProviderPresets(req, res) {
    res.json({ presets: presetUiList() });
}

/**
 * POST /api/providers/custom-presets
 * Create or replace one user-defined preset (upsert by id) in
 * ~/.cligate/provider-presets.json. The body is validated with the same
 * rules the loader applies at startup, so an entry accepted here is one the
 * loader will merge; request fields outside the preset schema are dropped.
 * The in-memory preset index is NOT rebuilt yet — a server restart applies
 * the change (the hot-reload pass removes this caveat).
 */
export function handleSaveCustomPreset(req, res) {
    const body = req.body || {};
    const entry = normalizeUserPreset({ id: typeof body.id === 'string' ? body.id.trim() : '', ...whitelistedUserPresetFields(body) });

    const problem = userPresetProblem(entry);
    if (problem) {
        return res.status(400).json({ success: false, error: problem });
    }

    const result = upsertUserPreset(entry);
    if (!result.success) {
        return res.status(500).json({ success: false, error: result.error });
    }
    res.json({ success: true, id: entry.id, replaced: result.replaced, requiresRestart: true });
}

/**
 * DELETE /api/providers/custom-presets/:id
 * Remove one user-defined preset from the file. Built-ins are protected.
 */
export function handleDeleteCustomPreset(req, res) {
    const { id } = req.params;
    if (isBuiltinPresetId(id)) {
        return res.status(400).json({ success: false, error: `"${id}" is a built-in preset and cannot be deleted` });
    }

    const result = removeUserPreset(id);
    if (!result.success) {
        const status = result.error === 'not found' ? 404 : 500;
        return res.status(status).json({ success: false, error: result.error });
    }
    res.json({ success: true, requiresRestart: true });
}
