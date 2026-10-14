/**
 * Generic OpenAI-compatible provider, driven by a preset entry from
 * `provider-presets.js`. Covers the common case where a vendor only differs
 * from OpenAI by base URL, model names, and pricing — so no bespoke class is
 * needed.
 *
 * Surfaces (see docs/multi-provider-integration.zh-CN.md):
 *   - OpenAI chat path (`/v1/chat/completions`, gateway): inherited `sendRequest`.
 *   - Claude Code (`/v1/messages`): `sendAnthropicRequest` below translates
 *     Anthropic Messages ⇄ OpenAI Chat (non-streaming upstream; messages-route
 *     synthesizes Anthropic SSE downstream when the client streams).
 *   - Codex (`/responses`): served by responses-route's EXISTING generic
 *     chat-completions fallback. We deliberately leave `sendResponsesRequest`
 *     undefined so `providerSupportsNativeResponses()` stays false and the route
 *     takes that fallback (these vendors have no native `/responses` endpoint).
 *
 * Only instantiated for preset providers (Qwen, OpenRouter); the bespoke
 * providers (openai/anthropic/gemini/deepseek/…) are untouched.
 */

import { OpenAIProvider } from './openai.js';
import { estimateCostWithRegistry, getDefaultPricing } from '../pricing-registry.js';
import { translateAnthropicToOpenAIChatRequest } from '../translators/request/anthropic-to-openai-chat.js';
import { translateOpenAIChatToAnthropicMessage } from '../translators/response/openai-chat-to-anthropic.js';

// ─── Usage/quota parsing (API Keys page) ─────────────────────────────────────

// Presets declare `usage.format`; these are the endpoint paths used when the
// preset doesn't override `usage.path` (resolved against usage.baseUrl or the
// preset's chat baseUrl).
const DEFAULT_USAGE_PATH = {
  'cline-plan': '/users/me/plan/usage-limits',
  'ollama-balance': '/api/balance',
};

/**
 * Tolerant reset-time normalization: accept ISO strings or epoch values
 * (seconds or milliseconds) and return an ISO string, or null.
 */
function toIsoOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ClinePass plan limits. Real response (2026-10):
//   { data: { limits: [{ type: 'five_hour', percentUsed, resetsAt }] }, success: true }
// Legacy direct-map shape ({ five_hour: { percentUsed, resetsAt }, … }) is
// still accepted. Total plan tokens are not published — only per-window usage.
const CLINE_PLAN_WINDOWS = [
  ['five_hour', '5h window'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
];

function parseClinePlanUsage(data) {
  const raw = data?.data?.limits ?? data;
  const byKey = new Map(
    Array.isArray(raw)
      ? raw.filter((w) => w && typeof w.type === 'string').map((w) => [w.type, w])
      : Object.entries(raw || {})
  );
  const windows = [];
  for (const [key, label] of CLINE_PLAN_WINDOWS) {
    const entry = byKey.get(key);
    const percentUsed = Number(entry?.percentUsed);
    if (!Number.isFinite(percentUsed)) continue;
    windows.push({
      id: key,
      label,
      percentUsed,
      resetsAt: toIsoOrNull(entry?.resetsAt),
    });
  }
  if (windows.length === 0) {
    throw new Error('usage-limits response contained no recognized windows');
  }
  return { kind: 'windows', windows, balance: null };
}

// Ollama Cloud balance. Real response (2026-10):
//   { included: { balance_usd: 0.46, allowance_usd: 60,
//                 period: { from, until } },
//     purchased: { balance_usd: 20 } }
// included.balance_usd is the remaining monthly credit (allowance_usd is the
// full grant — NOT remaining), purchased holds added one-time credits and may
// be an object or an array of buckets. remaining = monthly remainder + all
// purchased amounts; parts keeps the breakdown for the usage modal.
function parseOllamaBalanceUsage(data) {
  const included = data?.included ?? data; // tolerate a flat body
  const period = typeof included?.period === 'string'
    ? included.period
    : included?.period?.until || null;
  const monthly = Number(included?.balance_usd);
  const purchased = data?.purchased;
  const buckets = Array.isArray(purchased) ? purchased : purchased ? [purchased] : [];
  const purchasedAmounts = buckets
    .map((p) => Number(p?.balance_usd ?? p?.amount_usd ?? p?.usd))
    .filter(Number.isFinite);
  if (!Number.isFinite(monthly) && purchasedAmounts.length === 0) {
    throw new Error('balance response contained no numeric balance');
  }
  const purchasedTotal = purchasedAmounts.reduce((sum, n) => sum + n, 0);
  const parts = [];
  if (Number.isFinite(monthly)) {
    parts.push({ kind: 'monthly', remaining: monthly, until: period });
  }
  if (purchasedAmounts.length > 0) {
    parts.push({ kind: 'purchased', remaining: purchasedTotal });
  }
  return {
    kind: 'balance',
    windows: [],
    balance: {
      remaining: (Number.isFinite(monthly) ? monthly : 0) + purchasedTotal,
      unit: 'USD',
      period,
      parts,
    },
  };
}

const USAGE_PARSERS = {
  'cline-plan': parseClinePlanUsage,
  'ollama-balance': parseOllamaBalanceUsage,
};

/**
 * Build a concrete provider class bound to a preset.
 * @param {object} preset - an entry from PROVIDER_PRESETS
 * @returns {typeof OpenAIProvider}
 */
export function makeOpenAICompatibleProvider(preset) {
  return class OpenAICompatibleProvider extends OpenAIProvider {
    constructor(config) {
      super({ ...config, baseUrl: config.baseUrl || preset.baseUrl });
      this.type = preset.id;

      // Chat-completions-only vendors expose no native `/responses`. Leaving
      // sendResponsesRequest undefined routes Codex through responses-route's
      // chat fallback (Responses⇄Chat), which already buffers + synthesizes SSE.
      // (OpenAIProvider's inherited sendResponsesRequest would POST to a
      // nonexistent `/responses` endpoint.)
      this.sendResponsesRequest = undefined;
    }

    /**
     * Serve Anthropic Messages (Claude Code) by translating to/from OpenAI Chat.
     * Returns a fetch-style Response carrying an Anthropic-format JSON body, or
     * the raw upstream Response on error (handled by messages-route).
     *
     * Overrides OpenAIProvider.sendAnthropicRequest (which targets `/responses`)
     * with a chat-completions implementation suited to these vendors.
     */
    async sendAnthropicRequest(body = {}) {
      const { _proxypoolAppId, ...anthropicBody } = body;
      const chatBody = translateAnthropicToOpenAIChatRequest(anthropicBody);
      const response = await this.sendRequest(chatBody);
      if (!response.ok) return response;

      const chatData = await response.json();
      const anthropicMessage = translateOpenAIChatToAnthropicMessage(chatData, { model: anthropicBody.model });
      return new Response(JSON.stringify(anthropicMessage), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    estimateCost(model, inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0) {
      return estimateCostWithRegistry(this.type, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
    }

    // Vendors without a GET /models endpoint declare a `validateModel` in
    // their preset; validation then probes a 1-token chat request instead.
    async validateKey() {
      if (!preset.validateModel) {
        return super.validateKey();
      }
      try {
        const response = await this.sendRequest({
          model: preset.validateModel,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        });
        return response.status !== 401 && response.status !== 403;
      } catch {
        return false;
      }
    }

    /**
     * Fetch the subscription/quota snapshot declared by the preset's `usage`
     * field (API Keys page limits column). Only presets with `usage` carry
     * this method's implementation — providers built from presets without one
     * still expose fetchUsage, which throws "does not define a usage
     * endpoint"; api-key-manager gates on the preset, not on the method.
     * @returns {Promise<{ kind: 'windows'|'balance', windows: Array<{id, label, percentUsed, resetsAt}>, balance: {remaining, unit, period?}|null, fetchedAt: string }>}
     */
    async fetchUsage() {
      const usage = preset.usage;
      if (!usage?.format) {
        throw new Error(`${this.type} does not define a usage endpoint`);
      }
      const base = (usage.baseUrl || this.baseUrl || '').replace(/\/+$/, '');
      const path = usage.path || DEFAULT_USAGE_PATH[usage.format];
      if (!base || !path) {
        throw new Error(`${this.type} has an incomplete usage endpoint configuration`);
      }

      const response = await fetch(`${base}${path}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      if (!response.ok) {
        const suffix = response.status === 402 ? ' (no subscription credits)' : '';
        throw new Error(`usage request failed with HTTP ${response.status}${suffix}`);
      }

      const data = await response.json();
      const parser = USAGE_PARSERS[usage.format];
      if (!parser) throw new Error(`${this.type} uses an unknown usage format: ${usage.format}`);
      return { ...parser(data), fetchedAt: new Date().toISOString() };
    }

    static get pricing() {
      return getDefaultPricing(preset.id);
    }
  };
}

export default makeOpenAICompatibleProvider;
