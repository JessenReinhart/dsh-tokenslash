import React from "react";
import ModelPicker from "./ModelPicker.jsx";
import { fetchConfig, saveConfig, testConnection, fetchStats, fetchModels } from "../api.js";

const DEFAULT_TIERS = [
  { key: "cheap", label: "Cheap", color: "#3fb950", badge: "Fast", hint: "Simple, highly bounded tasks" },
  { key: "medium", label: "Medium", color: "#58a6ff", badge: "Balanced", hint: "Moderate reasoning, balanced cost" },
  { key: "smart", label: "Smart", color: "#d29922", badge: "Deep", hint: "Complex context, high-end reasoning" },
  { key: "extreme", label: "Extreme", color: "#bc8cff", badge: "Max", hint: "Most capable model for hardest tasks" },
];

export default function SettingsCard({
  page = false,
  config: externalConfig,
  onConfigChange,
  stats: externalStats,
  onTest,
  onFetchModels,
}) {
  const [internalConfig, setInternalConfig] = React.useState({
    enabled: true,
    provider: "deepseek",
    customBaseUrl: "",
    apiKey: "",
    model: "deepseek-chat",
    decoupleThreshold: 0.6,
    modelTiers: { cheap: "", medium: "", smart: "", extreme: "" },
    modules: {
      subagentRouting: true,
      forkDecoupling: true,
      toolPruning: true,
      compaction: true,
      goalGuard: true,
    },
  });

  const [internalStats, setInternalStats] = React.useState(null);
  const [availableModels, setAvailableModels] = React.useState([]);
  const [providers, setProviders] = React.useState([]);
  const [testResult, setTestResult] = React.useState(null);
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState("");

  const activeConfig = externalConfig || internalConfig;
  const activeStats = externalStats || internalStats;

  const updateConfig = React.useCallback(
    (nextConfig) => {
      if (onConfigChange) {
        onConfigChange(nextConfig);
      } else {
        setInternalConfig(nextConfig);
      }
    },
    [onConfigChange]
  );

  React.useEffect(() => {
    async function loadData() {
      if (!externalConfig) {
        const res = await fetchConfig();
        if (res.ok && res.data) {
          if (res.data.config) setInternalConfig(res.data.config);
          if (res.data.providers) setProviders(res.data.providers);
          if (res.data.availableModels) setAvailableModels(res.data.availableModels);
        }
      }
      if (!externalStats) {
        const statsRes = await fetchStats();
        if (statsRes.ok && statsRes.data) {
          setInternalStats(statsRes.data);
        }
      }
      if (onFetchModels) {
        const models = await onFetchModels();
        if (models) setAvailableModels(models);
      } else {
        const modelsRes = await fetchModels();
        if (modelsRes.ok && modelsRes.data?.models) {
          setAvailableModels(modelsRes.data.models);
        }
      }
    }
    loadData();
  }, [externalConfig, externalStats, onFetchModels]);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      if (onTest) {
        const res = await onTest(activeConfig);
        setTestResult(res);
      } else {
        const res = await testConnection(activeConfig);
        if (res.ok && res.data) {
          setTestResult({ ok: true, latencyMs: res.data.latencyMs, model: res.data.model });
        } else {
          setTestResult({ ok: false, message: res.error || "Connection test failed", latencyMs: 0 });
        }
      }
    } catch (err) {
      setTestResult({ ok: false, message: err.message, latencyMs: 0 });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await saveConfig(activeConfig);
      if (res.ok) {
        setSaveMessage("Configuration saved successfully.");
      } else {
        setSaveMessage(`Failed to save: ${res.error}`);
      }
    } catch (err) {
      setSaveMessage(`Save error: ${err.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(""), 4000);
    }
  }

  return (
    <div className="ts-card">
      <div className="ts-card-header">
        TokenSlash System One Token Optimization
      </div>

      {/* Section 1: Provider and Model */}
      <div className="ts-section">
        <div className="ts-section-title">1. Provider and Model</div>
        <div className="ts-grid">
          <div className="ts-field">
            <label className="ts-label">Provider</label>
            <select
              className="ts-select ts-provider-select"
              value={activeConfig.provider || "deepseek"}
              onChange={(e) => updateConfig({ ...activeConfig, provider: e.target.value })}
            >
              <option value="deepseek">DeepSeek (Official)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
              <option value="groq">Groq</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama (Local)</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </select>
          </div>

          <div className="ts-field">
            <label className="ts-label">Primary Fast Model</label>
            <input
              type="text"
              className="ts-input"
              value={activeConfig.model || ""}
              placeholder="e.g. deepseek-chat, gpt-4o-mini"
              onChange={(e) => updateConfig({ ...activeConfig, model: e.target.value })}
            />
          </div>

          <div className="ts-field">
            <label className="ts-label">Base URL (optional)</label>
            <input
              type="text"
              className="ts-input"
              value={activeConfig.customBaseUrl || ""}
              placeholder="https://api.example.com/v1"
              onChange={(e) => updateConfig({ ...activeConfig, customBaseUrl: e.target.value })}
            />
          </div>

          <div className="ts-field">
            <label className="ts-label">API Key (optional override)</label>
            <input
              type="password"
              className="ts-input"
              value={activeConfig.apiKey || ""}
              placeholder="Defaults to harness environment"
              onChange={(e) => updateConfig({ ...activeConfig, apiKey: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Section 2: Tiers and Thresholds */}
      <div className="ts-section">
        <div className="ts-section-title">2. Tiers and Thresholds</div>
        <div className="ts-field" style={{ marginBottom: "12px" }}>
          <label className="ts-label">
            Fork Decouple Threshold ({activeConfig.decoupleThreshold ?? 0.6})
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={activeConfig.decoupleThreshold ?? 0.6}
            onChange={(e) =>
              updateConfig({ ...activeConfig, decoupleThreshold: parseFloat(e.target.value) })
            }
          />
          <div className="ts-hint">
            Confidence score boundary above which subagent_fork is severed to save memory.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {DEFAULT_TIERS.map((tier) => (
            <ModelPicker
              key={tier.key}
              label={tier.label}
              color={tier.color}
              badge={tier.badge}
              hint={tier.hint}
              value={activeConfig.modelTiers?.[tier.key] || ""}
              providers={providers}
              currentProvider={activeConfig.provider}
              availableModels={availableModels}
              onChange={(val) =>
                updateConfig({
                  ...activeConfig,
                  modelTiers: {
                    ...(activeConfig.modelTiers || {}),
                    [tier.key]: val,
                  },
                })
              }
            />
          ))}
        </div>

        {/* Tool Pruning Mode Selector */}
        <div className="ts-field" style={{ marginTop: "14px" }}>
          <label className="ts-label">Tool Pruning Mode</label>
          <select
            className="ts-select"
            value={activeConfig.toolPruningMode || activeConfig.modules?.toolPruningMode || "normal"}
            onChange={(e) => {
              const val = e.target.value;
              updateConfig({
                ...activeConfig,
                toolPruningMode: val,
                modules: {
                  ...(activeConfig.modules || {}),
                  toolPruningMode: val,
                  toolPruning: val !== "off",
                },
              });
            }}
          >
            <option value="normal">Normal (Intent-based pruning, keep core tools)</option>
            <option value="extreme">Extreme (Prune ALL tools & tool guides)</option>
            <option value="off">Off (Do not prune tools)</option>
          </select>
          <div className="ts-hint">
            Extreme strips all tool schemas for pure reasoning / text turns. Off keeps all tools.
          </div>
        </div>
      </div>

      {/* Section 3: Telemetry Stats */}
      <div className="ts-section">
        <div className="ts-section-title">3. Telemetry Stats</div>
        <div className="ts-stats">
          <div className="ts-stats-grid">
            <div className="ts-stat-card">
              <span className="ts-stat-value">
                {activeStats?.tokensSaved ? activeStats.tokensSaved.toLocaleString() : "0"}
              </span>
              <span className="ts-stat-label">Estimated Tokens Saved</span>
            </div>
            <div className="ts-stat-card">
              <span className="ts-stat-value">
                {activeStats?.forksDecoupled ?? 0}
              </span>
              <span className="ts-stat-label">Forks Decoupled</span>
            </div>
            <div className="ts-stat-card">
              <span className="ts-stat-value">
                {activeStats?.schemasPruned ?? 0}
              </span>
              <span className="ts-stat-label">Tool Schemas Pruned</span>
            </div>
            <div className="ts-stat-card">
              <span className="ts-stat-value">
                {activeStats?.outputsCompacted ?? 0}
              </span>
              <span className="ts-stat-label">Outputs Compacted</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Test Connection */}
      <div className="ts-section">
        <div className="ts-section-title">4. Test Connection</div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            className="ts-button"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? "Testing..." : "Test Provider Connection"}
          </button>
          <button
            type="button"
            className="ts-button ts-button-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
          {saveMessage && <span className="ts-hint">{saveMessage}</span>}
        </div>

        {testResult && (
          <div
            className={`ts-test-result ${testResult.ok ? "ts-test-ok" : "ts-test-fail"}`}
          >
            {testResult.ok
              ? `Connected in ${testResult.latencyMs || 0}ms (Model: ${testResult.model || "OK"})`
              : `Connection failed: ${testResult.message}`}
          </div>
        )}
      </div>
    </div>
  );
}
