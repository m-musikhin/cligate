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
import { presetUiList } from '../providers/provider-presets.js';

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
