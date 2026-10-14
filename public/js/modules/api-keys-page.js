import { i18n } from '../i18n.js';

export function createApiKeysPageModule() {
  return {
    keyPlaceholders: {
      'openai': { name: 'My OpenAI Key', key: 'sk-...', url: 'https://api.openai.com/v1' },
      'anthropic': { name: 'My Anthropic Key', key: 'sk-ant-...', url: 'https://api.anthropic.com' },
      'gemini': { name: 'My Gemini Key', key: 'AIza...', url: 'https://generativelanguage.googleapis.com/v1beta' },
      'azure-openai': { name: 'My Azure OpenAI Key', key: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', url: 'https://{resource}.openai.azure.com' },
      'vertex-ai': { name: 'My Vertex AI Key', key: '{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}', url: '' },
      'deepseek': { name: 'My DeepSeek Key', key: 'sk-...', url: 'https://api.deepseek.com' },
      'minimax': { name: 'My MiniMax Key', key: 'eyJ...', url: 'https://api.minimax.io/v1' },
      'moonshot': { name: 'My Moonshot Key', key: 'sk-...', url: 'https://api.moonshot.ai/v1' },
      'zhipu': { name: 'My ZhipuAI Key', key: 'xxxxxxxx.xxxxxxxx', url: 'https://open.bigmodel.cn/api/paas/v4' }
    },
    apiKeysList: [],
    presetProviders: [],
    apiKeyStats: { totalKeys: 0, activeKeys: 0, totalRequests: 0, totalCost: 0 },
    showAddKeyModal: false,
    newKeyType: 'openai',
    newKeyName: '',
    newKeyValue: '',
    newKeyBaseUrl: '',
    newKeyExtra: { deploymentName: '', apiVersion: '2024-10-21', projectId: '', location: 'global' },
    showEditKeyModal: false,
    editKeyData: { id: '', name: '', type: '', apiKey: '', baseUrl: '', maskedKey: '', deploymentName: '', apiVersion: '', projectId: '', location: '', loading: false },
    editKeyTesting: false,
    // Custom-provider preset form (POST /api/providers/custom-presets).
    // tiers holds every tier key so Alpine's bracket x-model stays reactive.
    showCustomProviderModal: false,
    showKeyUsageModal: false,
    selectedUsageKeyId: null,
    customPresetSaving: false,
    customPresetTiers: ['fable', 'flagship', 'reasoning', 'standard', 'fast', 'default'],
    customPresetForm: { id: '', label: '', badge: '', baseUrl: '', apiFormat: 'openai_chat', models: '', tiers: {}, nativeModelPrefixes: '', passthroughModelMatch: '', validateModel: '' },

    apiKeyStateValue(key) {
      if (key?.enabled === false) return 'disabled';
      if (key?.isAvailable) return 'active';
      return 'idle';
    },

    apiKeyStateLabel(key) {
      const state = this.apiKeyStateValue(key);
      if (state === 'disabled') return this.t('disabled');
      if (state === 'active') return this.t('activeStatus');
      return this.t('idleStatus');
    },

    apiKeyStateDotClass(key) {
      const state = this.apiKeyStateValue(key);
      if (state === 'disabled') return 'bg-red-500';
      if (state === 'active') return 'bg-neon-green shadow-[0_0_8px_rgba(34,197,94,0.6)]';
      return 'bg-gray-500';
    },

    apiKeyStateTextClass(key) {
      const state = this.apiKeyStateValue(key);
      if (state === 'disabled') return 'text-red-400';
      if (state === 'active') return 'text-neon-green';
      return 'text-gray-500';
    },

    // ─── Usage/limits column (ClinePass plan limits, Ollama Cloud balance) ──
    // A key supports the limits cell when its preset declares a `usage`
    // endpoint; the backend serves a ≤5-min cached snapshot, refresh on click.

    apiKeyUsageSupported(key) {
      const preset = this.presetProviders.find((p) => p.id === key.type);
      return !!preset?.usage?.format;
    },

    apiKeyUsageLoading(key) {
      return key._usageLoading === true;
    },

    // Normalized snapshot: { kind: 'percent', remaining, window } |
    // { kind: 'balance', remaining, unit } | null. For window-based plans the
    // bar tracks the most-consumed window (the binding limit).
    apiKeyUsageState(key) {
      const usage = key?.usage;
      if (!usage) return null;

      const windows = Array.isArray(usage.windows) ? usage.windows : [];
      const binding = windows
        .map((w) => ({ ...w, used: Number(w.percentUsed) }))
        .filter((w) => Number.isFinite(w.used))
        .sort((a, b) => b.used - a.used)[0] || null;
      if (binding) {
        const used = Math.max(0, Math.min(100, binding.used));
        return { kind: 'percent', remaining: Math.round(100 - used), window: binding };
      }

      const balance = usage.balance;
      if (balance && Number.isFinite(Number(balance.remaining))) {
        return { kind: 'balance', remaining: Number(balance.remaining), unit: balance.unit || 'USD' };
      }
      return null;
    },

    apiKeyUsageRemaining(key) {
      const state = this.apiKeyUsageState(key);
      return state?.kind === 'percent' ? state.remaining : null;
    },

    apiKeyUsageBalanceRemaining(key) {
      const state = this.apiKeyUsageState(key);
      return state?.kind === 'balance' ? state.remaining : 0;
    },

    apiKeyUsageBarClass(key) {
      const remaining = this.apiKeyUsageRemaining(key);
      if (remaining === null) return 'bg-gray-500';
      if (remaining > 50) return 'bg-neon-green';
      if (remaining > 20) return 'bg-yellow-500';
      return 'bg-red-500';
    },

    apiKeyUsageTextClass(key) {
      const remaining = this.apiKeyUsageRemaining(key);
      return remaining !== null && remaining <= 20 ? 'text-red-400' : 'text-gray-400';
    },

    apiKeyUsageResetSummary(key) {
      const state = this.apiKeyUsageState(key);
      return this._formatResetIn(state?.window?.resetsAt);
    },

    apiKeyUsagePeriodSummary(key) {
      const period = key?.usage?.balance?.period;
      return typeof period === 'string' && period ? period : null;
    },

    _formatResetIn(resetsAt) {
      if (!resetsAt) return null;
      const resetMs = new Date(resetsAt).getTime();
      if (!Number.isFinite(resetMs)) return null;

      const deltaSec = Math.max(0, Math.floor((resetMs - Date.now()) / 1000));
      if (deltaSec === 0) return this.t('resetDueNow');

      const days = Math.floor(deltaSec / 86400);
      const hours = Math.floor((deltaSec % 86400) / 3600);
      const minutes = Math.floor((deltaSec % 3600) / 60);

      const dict = i18n[this.lang] || i18n.en;
      if (days > 0) return dict.resetsInDH(days, hours);
      if (hours > 0) return dict.resetsInHM(hours, minutes);
      return dict.resetsInM(minutes);
    },

    _formatResetAt(resetsAt) {
      if (!resetsAt) return null;
      const date = new Date(resetsAt);
      return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
    },

    _usageWindowBarClass(percentUsed) {
      const remaining = Math.max(0, Math.min(100, 100 - Number(percentUsed)));
      if (remaining > 50) return 'bg-neon-green';
      if (remaining > 20) return 'bg-yellow-500';
      return 'bg-red-500';
    },

    // ─── Usage details modal (unified with the accounts quota modal) ────────
    // Clicking a key's limits cell opens this modal (like showQuotaModal for
    // ChatGPT accounts) and silently refreshes the snapshot. Windows plans
    // list every window with its own bar + reset time; balance plans list the
    // breakdown parts (monthly credits / added credits) plus the total.

    apiKeyUsageWindowRows(key) {
      const usage = key?.usage;
      const windows = Array.isArray(usage?.windows) ? usage.windows : [];
      return windows.map((w) => ({
        label: w.label || w.id,
        remaining: Math.max(0, Math.min(100, Math.round(100 - Number(w.percentUsed)))),
        resetSummary: this._formatResetIn(w.resetsAt),
        resetAtLabel: this._formatResetAt(w.resetsAt),
        barClass: this._usageWindowBarClass(w.percentUsed),
      }));
    },

    apiKeyUsageBalanceParts(key) {
      const parts = key?.usage?.balance?.parts;
      if (!Array.isArray(parts)) return [];
      return parts.map((p) => ({
        label: p.kind === 'purchased'
          ? this.t('apiKeyUsageAddedCredits')
          : this.t('apiKeyUsageMonthlyCredits'),
        remaining: Number(p.remaining),
        untilLabel: this._formatResetAt(p.until),
      }));
    },

    selectedUsageKey() {
      return this.apiKeysList.find((entry) => entry.id === this.selectedUsageKeyId) || null;
    },

    openKeyUsageModal(key) {
      this.selectedUsageKeyId = key.id;
      this.showKeyUsageModal = true;
      // Same pattern as the accounts quota cells: opening the modal refreshes.
      this.refreshApiKeyUsage(key, { silent: true });
    },

    async refreshApiKeyUsage(key, { silent = false } = {}) {
      const target = typeof key === 'string'
        ? this.apiKeysList.find((entry) => entry.id === key)
        : key;
      if (!target) return;
      target._usageLoading = true;
      const { ok, data } = await this.api(`/api/keys/${target.id}/usage?refresh=true`);
      target._usageLoading = false;
      if (ok && data?.success && data?.usage) {
        target.usage = data.usage;
        target.usageUpdatedAt = data.usageUpdatedAt;
        if (!silent) this.showToast(this.t('apiKeyUsageRefreshed'), 'success');
      } else if (ok && data?.supported === false) {
        if (!silent) this.showToast(this.t('apiKeyUsageUnsupported'), 'error');
      } else {
        if (!silent) this.showToast(data?.error || this.t('apiKeyUsageRefreshFailed'), 'error');
      }
    },

    // Load declarative provider presets (provider-presets.js) and merge them
    // into the add-key form so new vendors need no frontend code — just data.
    async loadProviderPresets() {
      if (this.presetProviders.length) return;
      const { ok, data } = await this.api('/api/providers/presets');
      if (!ok || !Array.isArray(data?.presets)) return;
      this.presetProviders = data.presets;
      for (const p of data.presets) {
        if (!this.keyPlaceholders[p.id]) {
          this.keyPlaceholders[p.id] = {
            name: `My ${this.providerLabel(p)} Key`,
            key: p.keyHint || 'API Key',
            url: p.baseUrl || ''
          };
        }
      }
    },

    isPresetProvider(type) {
      return this.presetProviders.some((p) => p.id === type);
    },

    // Localized provider display name. Accepts a preset object or a type id.
    // Resolves the preset's i18n `labelKey` via t() (reactive on language
    // switch), falling back to the neutral `label`.
    providerLabel(p) {
      const preset = typeof p === 'string' ? this.presetProviders.find((x) => x.id === p) : p;
      if (!preset) return typeof p === 'string' ? p : '';
      if (preset.labelKey) {
        const translated = this.t(preset.labelKey);
        if (translated && translated !== preset.labelKey) return translated;
      }
      return preset.label || preset.id || '';
    },

    apiKeyBadgeLabel(type) {
      const preset = this.presetProviders.find((p) => p.id === type);
      if (preset) return preset.badge || preset.label;
      const legacy = { 'azure-openai': 'AZURE', deepseek: 'DEEPSEEK', 'vertex-ai': 'VERTEX', moonshot: 'KIMI', zhipu: 'GLM' };
      return legacy[type] || String(type || '').toUpperCase();
    },

    async loadApiKeys() {
      await this.loadProviderPresets();
      const { ok, data } = await this.api('/api/keys');
      if (ok) {
        this.apiKeysList = (data.keys || []).map((key) => ({ ...key, _testing: false }));
        if (data.stats) {
          this.apiKeyStats = {
            totalKeys: data.stats.totalKeys || 0,
            activeKeys: data.stats.activeKeys || 0,
            totalRequests: data.stats.totalRequests || 0,
            totalCost: data.stats.totalCost || 0
          };
        }
        // Warm the limits cell for usage-enabled keys that have no snapshot
        // yet (first visit or pre-feature records). The backend serves a
        // ≤5-min cached snapshot, so this is at most one request per key.
        for (const key of this.apiKeysList) {
          if (this.apiKeyUsageSupported(key) && !key.usage && !key._usageLoading) {
            this.refreshApiKeyUsage(key, { silent: true });
          }
        }
      }
    },

    // ─── Custom provider preset form ────────────────────────────────────────
    openCustomProviderModal() {
      const tiers = {};
      for (const tier of this.customPresetTiers) tiers[tier] = '';
      this.customPresetForm = {
        id: '', label: '', badge: '', baseUrl: '', apiFormat: 'openai_chat',
        models: '', tiers, nativeModelPrefixes: '', passthroughModelMatch: '', validateModel: '',
      };
      this.showCustomProviderModal = true;
    },

    _csvToList(value) {
      return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
    },

    async submitCustomProvider() {
      const form = this.customPresetForm;
      if (!form.id.trim()) {
        this.showToast(this.t('customProviderId') + ' — required', 'error');
        return;
      }
      if (!form.baseUrl.trim()) {
        this.showToast(this.t('customProviderBaseUrl') + ' — required', 'error');
        return;
      }
      const tiers = {};
      for (const tier of this.customPresetTiers) {
        const model = (form.tiers[tier] || '').trim();
        if (model) tiers[tier] = model;
      }
      const body = {
        id: form.id.trim(),
        baseUrl: form.baseUrl.trim(),
        apiFormat: form.apiFormat,
        models: this._csvToList(form.models),
        nativeModelPrefixes: this._csvToList(form.nativeModelPrefixes),
      };
      if (form.label.trim()) body.label = form.label.trim();
      if (form.badge.trim()) body.badge = form.badge.trim().toUpperCase();
      if (Object.keys(tiers).length) body.tiers = tiers;
      if (form.passthroughModelMatch.trim()) body.passthroughModelMatch = form.passthroughModelMatch.trim();
      if (form.validateModel.trim()) body.validateModel = form.validateModel.trim();

      this.customPresetSaving = true;
      const { ok, data } = await this.api('/api/providers/custom-presets', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      this.customPresetSaving = false;
      if (ok && data?.success) {
        this.showToast(this.t('customProviderSaved'), 'success');
        this.showCustomProviderModal = false;
        // Presets changed server-side (hot reloaded) — bust the cache and
        // preselect the new type in the add-key form.
        this.presetProviders = [];
        await this.loadProviderPresets();
        this.newKeyType = body.id;
        this.loadApiKeys();
      } else {
        this.showToast(data?.error || this.t('customProviderSaveFailed'), 'error');
      }
    },

    async submitAddKey() {
      if (!this.newKeyValue.trim()) {
        this.showToast(this.t('apiKeyRequired'), 'error');
        return;
      }
      const type = this.newKeyType;
      const body = {
        type,
        name: this.newKeyName.trim() || `${type}-key`,
        apiKey: this.newKeyValue.trim()
      };

      if (type === 'azure-openai') {
        if (!this.newKeyBaseUrl.trim()) {
          this.showToast(this.t('azureEndpointRequired'), 'error');
          return;
        }
        if (!this.newKeyExtra.deploymentName.trim()) {
          this.showToast(this.t('azureDeploymentRequired'), 'error');
          return;
        }
        body.baseUrl = this.newKeyBaseUrl.trim();
        body.deploymentName = this.newKeyExtra.deploymentName.trim();
        body.apiVersion = this.newKeyExtra.apiVersion.trim() || '2024-10-21';
      } else if (type === 'vertex-ai') {
        if (!this.newKeyExtra.projectId.trim()) {
          this.showToast(this.t('vertexProjectRequired'), 'error');
          return;
        }
        body.projectId = this.newKeyExtra.projectId.trim();
        body.location = this.newKeyExtra.location.trim() || 'global';
      } else if (this.newKeyBaseUrl.trim()) {
        body.baseUrl = this.newKeyBaseUrl.trim();
      }

      const { ok, data } = await this.api('/api/keys', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (ok && data?.success) {
        this.showToast(this.t('apiKeyAdded'), 'success');
        this.showAddKeyModal = false;
        this.newKeyType = 'openai';
        this.newKeyName = '';
        this.newKeyValue = '';
        this.newKeyBaseUrl = '';
        this.newKeyExtra = { deploymentName: '', apiVersion: '2024-10-21', projectId: '', location: 'global' };
        this.loadApiKeys();
      } else {
        this.showToast(data?.error || this.t('apiKeyAddFailed'), 'error');
      }
    },

    async toggleApiKey(id, enabled) {
      const { ok } = await this.api(`/api/keys/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled })
      });
      if (ok) {
        this.loadApiKeys();
      } else {
        this.showToast(this.t('apiKeyUpdateFailed'), 'error');
      }
    },

    async deleteApiKey(id) {
      const { ok } = await this.api(`/api/keys/${id}`, { method: 'DELETE' });
      if (ok) {
        this.showToast(this.t('apiKeyDeleted'), 'success');
        this.loadApiKeys();
      } else {
        this.showToast(this.t('apiKeyDeleteFailed'), 'error');
      }
    },

    async validateApiKey(id) {
      const { ok, data } = await this.api(`/api/keys/${id}/validate`, { method: 'POST' });
      if (ok && data?.valid) {
        this.showToast(this.t('apiKeyValid'), 'success');
      } else {
        this.showToast(data?.error || this.t('apiKeyInvalid'), 'error');
      }
      this.loadApiKeys();
    },

    async testApiKey(id) {
      const key = this.apiKeysList.find((entry) => entry.id === id);
      if (key) key._testing = true;
      const { ok, data } = await this.api(`/api/keys/${id}/validate`, { method: 'POST' });
      if (key) key._testing = false;
      if (ok && data?.valid) {
        this.showToast(this.t('apiKeyValid'), 'success');
      } else {
        this.showToast(data?.error || this.t('apiKeyInvalid'), 'error');
      }
    },

    async openEditKeyModal(key) {
      this.editKeyData = {
        id: key.id,
        name: key.name,
        type: key.type,
        apiKey: '',
        baseUrl: key.baseUrl || '',
        maskedKey: key.apiKey,
        deploymentName: key.deploymentName || '',
        apiVersion: key.apiVersion || '2024-10-21',
        projectId: key.projectId || '',
        location: key.location || 'global',
        loading: true
      };
      this.showEditKeyModal = true;

      const { ok, data } = await this.api(`/api/keys/${key.id}`);
      if (ok && data?.key) {
        this.editKeyData = {
          ...this.editKeyData,
          name: data.key.name || this.editKeyData.name,
          apiKey: data.key.apiKey || '',
          baseUrl: data.key.baseUrl || '',
          deploymentName: data.key.deploymentName || '',
          apiVersion: data.key.apiVersion || this.editKeyData.apiVersion,
          projectId: data.key.projectId || '',
          location: data.key.location || this.editKeyData.location,
          loading: false
        };
      } else {
        this.editKeyData.loading = false;
        this.showToast(data?.error || this.t('apiKeyUpdateFailed'), 'error');
      }
    },

    _buildEditPatch() {
      const data = this.editKeyData;
      const patch = { name: data.name.trim() };
      if (data.apiKey.trim()) patch.apiKey = data.apiKey.trim();
      patch.baseUrl = data.baseUrl.trim() || undefined;
      if (data.type === 'azure-openai') {
        patch.deploymentName = data.deploymentName.trim();
        patch.apiVersion = data.apiVersion.trim() || '2024-10-21';
      }
      if (data.type === 'vertex-ai') {
        patch.projectId = data.projectId.trim();
        patch.location = data.location.trim() || 'global';
      }
      return patch;
    },

    async submitEditKey() {
      const patch = this._buildEditPatch();
      const { ok, data } = await this.api(`/api/keys/${this.editKeyData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (ok && data?.success) {
        this.showToast(this.t('apiKeyUpdated'), 'success');
        this.showEditKeyModal = false;
        this.loadApiKeys();
      } else {
        this.showToast(data?.error || this.t('apiKeyUpdateFailed'), 'error');
      }
    },

    async testEditingKey() {
      this.editKeyTesting = true;
      const patch = this._buildEditPatch();
      await this.api(`/api/keys/${this.editKeyData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });

      const { ok, data } = await this.api(`/api/keys/${this.editKeyData.id}/validate`, { method: 'POST' });
      this.editKeyTesting = false;

      if (ok && data?.valid) {
        this.showToast(this.t('apiKeyValid'), 'success');
      } else {
        this.showToast(data?.error || this.t('apiKeyInvalid'), 'error');
      }
    }
  };
}
