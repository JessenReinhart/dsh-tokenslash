window.__ModuleLoader__.load({
  id: "dsh-tokenslash",
  factory: (require) => {
    const React = require("react");
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // Styles
    const CSS_ID = "dsh-tokenslash-styles";
    if (typeof document !== "undefined" && !document.getElementById(CSS_ID)) {
      const style = document.createElement("style");
      style.id = CSS_ID;
      style.textContent = `
        .ts-container { padding: 16px; font-family: var(--dsh-font-family, system-ui, sans-serif); color: var(--dsw-alias-label-primary, #e6edf3); }
        .ts-header { margin-bottom: 20px; }
        .ts-title { font-size: 18px; font-weight: 600; margin: 0 0 6px 0; display: flex; align-items: center; gap: 8px; }
        .ts-desc { font-size: 13px; color: var(--dsw-alias-label-secondary, #8b949e); margin: 0; }
        .ts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
        .ts-stat-card { background: var(--dsw-alias-bg-subtle, rgba(255,255,255,0.04)); border: 1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.1)); border-radius: 8px; padding: 12px 16px; }
        .ts-stat-value { font-size: 22px; font-weight: 700; color: var(--dsw-alias-state-business-primary, #58a6ff); font-family: var(--ds-font-family-code, monospace); }
        .ts-stat-label { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8b949e); margin-top: 4px; }
        .ts-section { background: var(--dsw-alias-bg-subtle, rgba(255,255,255,0.02)); border: 1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.08)); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        .ts-section-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
        .ts-row { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
        .ts-label { font-size: 13px; min-width: 140px; color: var(--dsw-alias-label-secondary, #c9d1d9); }
        .ts-input, .ts-select { flex: 1; background: var(--dsw-alias-bg-base, rgba(0,0,0,0.2)); border: 1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.15)); border-radius: 6px; padding: 6px 10px; color: inherit; font-size: 13px; outline: none; }
        .ts-input:focus, .ts-select:focus { border-color: var(--dsw-alias-state-business-primary, #58a6ff); }
        .ts-button { background: var(--dsw-alias-bg-subtle, rgba(255,255,255,0.08)); border: 1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.15)); border-radius: 6px; padding: 6px 14px; color: inherit; font-size: 13px; cursor: pointer; }
        .ts-button:hover { background: rgba(255,255,255,0.12); }
        .ts-button-primary { background: var(--dsw-alias-state-business-primary, #238636); border-color: transparent; color: #fff; }
        .ts-button-primary:hover { background: #2ea043; }
        .ts-button-disabled { opacity: 0.5; cursor: not-allowed; }
        .ts-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(88,166,255,0.15); color: #58a6ff; }
        .ts-preset-group { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
        .ts-preset-btn { background: var(--dsw-alias-bg-subtle, rgba(255,255,255,0.06)); border: 1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.15)); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: inherit; }
        .ts-preset-btn:hover { background: var(--dsw-alias-state-business-primary, #58a6ff); color: #000; border-color: transparent; font-weight: 600; }
        .ts-tier-box { border-left: 3px solid var(--dsw-alias-state-business-primary, #58a6ff); padding-left: 12px; margin-bottom: 12px; }
        .ts-tier-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .ts-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; background: rgba(88,166,255,0.1); border: 1px solid rgba(88,166,255,0.25); color: var(--dsw-alias-label-primary, #e6edf3); cursor: default; }
        .ts-pill-bolt { color: #f2cc60; font-size: 12px; }
        .ts-pill-cost { color: #3fb950; font-weight: 600; }
        .ts-turn-tail { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; padding: 3px 8px; border-radius: 6px; font-size: 11px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); color: var(--dsw-alias-label-secondary, #8b949e); }
        .ts-turn-tail-icon { color: #58a6ff; font-weight: 600; }
      `;
      document.head.appendChild(style);
    }

    const PRESETS = {
      "9router": {
        name: "9Router Proxy",
        provider: "9router",
        customBaseUrl: "https://api.9router.com/v1/systemone",
        model: "jev-1.13-free",
        modelTiers: {
          cheap: "gemini-2.5-flash, deepseek-chat",
          medium: "claude-3-5-haiku, gemini-2.5-pro",
          smart: "claude-3-7-sonnet, deepseek-reasoner",
        },
      },
      opencode: {
        name: "OpenCode Zen (Free)",
        provider: "opencode",
        customBaseUrl: "https://opencode.ai/v1/systemone",
        model: "jev-1.13-free",
        modelTiers: {
          cheap: "jev-1.13-free, deepseek-chat",
          medium: "gemini-2.5-flash, deepseek-chat",
          smart: "deepseek-reasoner",
        },
      },
      openrouter: {
        name: "OpenRouter Fast Tier",
        provider: "openrouter",
        customBaseUrl: "https://openrouter.ai/api/v1",
        model: "deepseek/deepseek-chat",
        modelTiers: {
          cheap: "google/gemini-2.5-flash, deepseek/deepseek-chat",
          medium: "anthropic/claude-3-5-haiku",
          smart: "anthropic/claude-3-7-sonnet, deepseek/deepseek-r1",
        },
      },
      typesafe: {
        name: "TypeSafe Jev Engine",
        provider: "typesafe",
        customBaseUrl: "https://jev.typesafe.ai/v1",
        model: "jev-1.13-fast",
        modelTiers: {
          cheap: "jev-1.13-fast",
          medium: "jev-1.13-balanced",
          smart: "jev-1.13-deep",
        },
      },
      deepseek: {
        name: "DeepSeek Direct",
        provider: "custom",
        customBaseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        modelTiers: {
          cheap: "deepseek-chat",
          medium: "deepseek-chat",
          smart: "deepseek-reasoner",
        },
      },
      custom: {
        name: "Custom Jev Provider",
        provider: "custom",
        customBaseUrl: "http://127.0.0.1:20128/v1/systemone",
        model: "custom",
        modelTiers: {
          cheap: "custom-fast",
          medium: "custom-balanced",
          smart: "custom-deep",
        },
      },
    };

    // 1. In-Chat Composer Pill Component
    function TokenSlashComposerPill() {
      const [stats, setStats] = React.useState(null);

      React.useEffect(() => {
        const fetchTelemetry = () => {
          fetch("/api/dsh-tokenslash/stats")
            .then((r) => r.json())
            .then((data) => {
              if (data && typeof data.totalTokensSaved === "number") {
                setStats(data);
              }
            })
            .catch(() => {});
        };
        fetchTelemetry();
        const interval = setInterval(fetchTelemetry, 10000);
        return () => clearInterval(interval);
      }, []);

      const savedTokens = stats ? stats.totalTokensSaved : 0;
      const savedUsd = stats ? stats.estimatedCostSavedUsd : "0.00";

      return React.createElement(
        "div",
        {
          className: "ts-pill",
          title: `TokenSlash active. Subagents routed: ${stats?.subagentsDecoupledCount || 0}, Tools pruned: ${stats?.toolsPrunedCount || 0}`,
        },
        React.createElement("span", { className: "ts-pill-bolt" }, "⚡"),
        React.createElement("span", null, `${savedTokens.toLocaleString()} saved`),
        React.createElement("span", { className: "ts-pill-cost" }, `(+$${savedUsd})`)
      );
    }

    // 4. Turn Tail Component (Appended to conversation turn end)
    function TokenSlashTurnTail({ turn } = {}) {
      const [stats, setStats] = React.useState(null);

      React.useEffect(() => {
        fetch("/api/dsh-tokenslash/stats")
          .then((r) => r.json())
          .then((data) => {
            if (data && typeof data.totalTokensSaved === "number") {
              setStats(data);
            }
          })
          .catch(() => {});
      }, [turn]);

      if (!stats || stats.totalTokensSaved === 0) return null;

      return React.createElement(
        "div",
        { className: "ts-turn-tail" },
        React.createElement("span", { className: "ts-turn-tail-icon" }, "⚡ TokenSlash:"),
        React.createElement("span", null, `Cumulative ${stats.totalTokensSaved.toLocaleString()} tokens pruned & routed (+$${stats.estimatedCostSavedUsd})`)
      );
    }

    // Searchable dropdown component
    function SearchableDropdown({ placeholder, value, options, onSelect, style, className, allowCustom = false, onChangeCustom }) {
      const [open, setOpen] = React.useState(false);
      const [query, setQuery] = React.useState("");
      const containerRef = React.useRef(null);

      React.useEffect(() => {
        function handleClickOutside(event) {
          if (containerRef.current && !containerRef.current.contains(event.target)) {
            setOpen(false);
          }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
      }, []);

      const filtered = (options || []).filter((opt) => {
        const label = opt.label || opt.id || "";
        const sub = opt.sub || "";
        const searchTarget = `${label} ${sub}`.toLowerCase();
        return searchTarget.includes((query || "").toLowerCase());
      });

      return React.createElement(
        "div",
        {
          ref: containerRef,
          style: { position: "relative", display: "inline-block", ...style },
          className: className || "",
        },
        React.createElement("input", {
          className: "ts-input",
          style: { width: "100%", cursor: allowCustom ? "text" : "pointer" },
          placeholder: placeholder || "Search or select model...",
          value: open ? query : (value || ""),
          onFocus: () => {
            setOpen(true);
            setQuery(allowCustom ? (value || "") : "");
          },
          onChange: (e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (allowCustom && typeof onChangeCustom === "function") {
              onChangeCustom(e.target.value);
            }
          },
        }),
        open && React.createElement(
          "div",
          {
            style: {
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              maxHeight: "220px",
              overflowY: "auto",
              background: "var(--dsw-alias-bg-floating, #161b22)",
              border: "1px solid var(--dsw-alias-border-subtle, #30363d)",
              borderRadius: "6px",
              zIndex: 1000,
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            },
          },
          filtered.length === 0
            ? React.createElement(
                "div",
                { style: { padding: "8px 12px", fontSize: "12px", color: "var(--dsw-alias-label-muted, #8b949e)" } },
                "No matching models"
              )
            : filtered.map((opt) =>
                React.createElement(
                  "div",
                  {
                    key: opt.id,
                    style: {
                      padding: "8px 12px",
                      fontSize: "12px",
                      cursor: "pointer",
                      color: "var(--dsw-alias-label-primary, #c9d1d9)",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    },
                    onMouseDown: (e) => {
                      e.preventDefault();
                      onSelect(opt.id);
                      setOpen(false);
                      setQuery("");
                    },
                    onMouseEnter: (e) => {
                      e.currentTarget.style.background = "var(--dsw-alias-bg-hover, rgba(255,255,255,0.08))";
                    },
                    onMouseLeave: (e) => {
                      e.currentTarget.style.background = "transparent";
                    },
                  },
                  React.createElement("div", { style: { fontWeight: "500" } }, opt.label || opt.id),
                  opt.sub ? React.createElement("div", { style: { fontSize: "10px", color: "var(--dsw-alias-label-muted, #8b949e)" } }, opt.sub) : null
                )
              )
        )
      );
    }

    // Settings View
    function TokenSlashView() {
      const [stats, setStats] = React.useState({
        totalTokensSaved: 0,
        estimatedCostSavedUsd: "0.00",
        subagentsDecoupledCount: 0,
        toolsPrunedCount: 0,
        outputsCompactedCount: 0,
      });

      const [config, setConfig] = React.useState({
        enabled: true,
        provider: "custom",
        customBaseUrl: "http://127.0.0.1:20128/v1/systemone",
        apiKey: "",
        model: "jev-1.13-free",
        decoupleThreshold: 0.85,
        modelTiers: {
          cheap: "gemini-2.5-flash, deepseek-chat, gpt-4o-mini",
          medium: "gemini-2.5-pro, claude-3-5-haiku",
          smart: "deepseek-reasoner, claude-3-7-sonnet, gpt-4o",
        },
        toolPruningMode: "normal",
        modules: {
          subagentRouting: true,
          toolPruning: true,
          toolPruningMode: "normal",
          outputCompacting: true,
          goalGuard: true,
        },
      });

      const [harnessModels, setHarnessModels] = React.useState([]);
      const [modelSearch, setModelSearch] = React.useState("");
      const filteredModels = harnessModels.filter((m) =>
        (m.displayName || m.id).toLowerCase().includes(modelSearch.toLowerCase())
      );
      const [testStatus, setTestStatus] = React.useState(null);
      const [testing, setTesting] = React.useState(false);

      const loadHarnessModels = () => {
        fetch("/api/dsh-tokenslash/harness-models")
          .then((r) => r.json())
          .then((data) => {
            if (data && Array.isArray(data.models)) {
              setHarnessModels(data.models);
            }
          })
          .catch(() => {});
      };

      React.useEffect(() => {
        fetch("/api/dsh-tokenslash/config")
          .then((r) => r.json())
          .then((data) => {
            if (data && data.config) {
              setConfig((prev) => ({
                ...prev,
                ...data.config,
                modelTiers: { ...prev.modelTiers, ...(data.config.modelTiers || {}) },
                modules: { ...prev.modules, ...(data.config.modules || {}) },
              }));
            }
          })
          .catch(() => {});

        fetch("/api/dsh-tokenslash/stats")
          .then((r) => r.json())
          .then((data) => {
            if (data && typeof data.totalTokensSaved === "number") {
              setStats(data);
            }
          })
          .catch(() => {});

        loadHarnessModels();
      }, []);

      const applyPreset = (presetKey) => {
        const p = PRESETS[presetKey];
        if (!p) return;
        setConfig((prev) => ({
          ...prev,
          provider: p.provider,
          customBaseUrl: p.customBaseUrl,
          model: prev.model ? prev.model : p.model,
        }));
        setTestStatus(`Loaded preset: ${p.name} (endpoint updated, model preserved)`);
      };

      const handleTest = async () => {
        setTesting(true);
        setTestStatus("Testing triage endpoint...");
        try {
          const res = await fetch("/api/dsh-tokenslash/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
          });
          const data = await res.json();
          if (data.ok) {
            setTestStatus(`Connected in ${data.latencyMs || 0}ms (Model: ${data.model || config.model})`);
          } else {
            setTestStatus(`Failed: ${data.message || data.error || "Unknown error"}`);
          }
        } catch (e) {
          setTestStatus(`Error: ${e.message}`);
        } finally {
          setTesting(false);
        }
      };

      const handleSave = async () => {
        try {
          const res = await fetch("/api/dsh-tokenslash/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
          });
          const data = await res.json();
          if (data.ok) {
            setTestStatus("Settings saved successfully.");
          } else {
            setTestStatus(`Save failed: ${data.error || "Server error"}`);
          }
        } catch (e) {
          setTestStatus(`Save failed: ${e.message}`);
        }
      };

      const addModelToTier = (tierKey, modelId) => {
        if (!modelId) return;
        const current = (config.modelTiers?.[tierKey] || "").trim();
        const parts = current ? current.split(",").map((s) => s.trim()).filter(Boolean) : [];
        if (!parts.includes(modelId)) {
          parts.unshift(modelId);
          setConfig({
            ...config,
            modelTiers: {
              ...config.modelTiers,
              [tierKey]: parts.join(", "),
            },
          });
        }
      };

      return React.createElement(
        "div",
        { className: "ts-container" },
        // Header
        React.createElement(
          "div",
          { className: "ts-header" },
          React.createElement("h2", { className: "ts-title" }, "⚡ TokenSlash - System One Token Optimization", React.createElement("span", { className: "ts-badge" }, config.enabled ? "Active" : "Disabled")),
          React.createElement("p", { className: "ts-desc" }, "Automated subagent model classifier & routing, tool pruning, and output compaction via System One Jev triage.")
        ),
        // Stats Grid
        React.createElement(
          "div",
          { className: "ts-grid" },
          React.createElement(
            "div",
            { className: "ts-stat-card" },
            React.createElement("div", { className: "ts-stat-value" }, (stats.totalTokensSaved || 0).toLocaleString()),
            React.createElement("div", { className: "ts-stat-label" }, "Tokens Saved")
          ),
          React.createElement(
            "div",
            { className: "ts-stat-card" },
            React.createElement("div", { className: "ts-stat-value" }, "$" + (stats.estimatedCostSavedUsd || "0.00")),
            React.createElement("div", { className: "ts-stat-label" }, "Estimated Cost Saved")
          ),
          React.createElement(
            "div",
            { className: "ts-stat-card" },
            React.createElement("div", { className: "ts-stat-value" }, stats.subagentsDecoupledCount || 0),
            React.createElement("div", { className: "ts-stat-label" }, "Subagents Routed")
          ),
          React.createElement(
            "div",
            { className: "ts-stat-card" },
            React.createElement("div", { className: "ts-stat-value" }, stats.toolsPrunedCount || 0),
            React.createElement("div", { className: "ts-stat-label" }, "Tools Pruned")
          )
        ),
        // Section: Presets & Custom Provider
        React.createElement(
          "div",
          { className: "ts-section" },
          React.createElement("div", { className: "ts-section-title" }, "1. Jev Provider Configuration & Presets"),
          React.createElement(
            "div",
            { className: "ts-preset-group" },
            Object.keys(PRESETS).map((key) =>
              React.createElement(
                "button",
                {
                  key,
                  type: "button",
                  className: "ts-preset-btn",
                  onClick: () => applyPreset(key),
                },
                PRESETS[key].name
              )
            )
          ),
          React.createElement(
            "div",
            { className: "ts-row" },
            React.createElement("span", { className: "ts-label" }, "Provider Type:"),
            React.createElement(
              "select",
              {
                className: "ts-select",
                value: config.provider,
                onChange: (e) => setConfig({ ...config, provider: e.target.value }),
              },
              React.createElement("option", { value: "custom" }, "Custom Jev Provider / Proxy"),
              React.createElement("option", { value: "opencode" }, "OpenCode Zen (Free)"),
              React.createElement("option", { value: "9router" }, "9Router Proxy"),
              React.createElement("option", { value: "openrouter" }, "OpenRouter Fast Tier"),
              React.createElement("option", { value: "typesafe" }, "TypeSafe Jev Engine")
            )
          ),
          React.createElement(
            "div",
            { className: "ts-row" },
            React.createElement("span", { className: "ts-label" }, "Base URL:"),
            React.createElement("input", {
              className: "ts-input",
              placeholder: "http://127.0.0.1:20128/v1/systemone",
              value: config.customBaseUrl,
              onChange: (e) => setConfig({ ...config, customBaseUrl: e.target.value }),
            })
          ),
          React.createElement(
            "div",
            { className: "ts-row" },
            React.createElement("span", { className: "ts-label" }, "API Key:"),
            React.createElement("input", {
              type: "password",
              className: "ts-input",
              placeholder: "Optional for custom local servers or free tiers",
              value: config.apiKey,
              onChange: (e) => setConfig({ ...config, apiKey: e.target.value }),
            })
          ),
          React.createElement(
            "div",
            { className: "ts-row" },
            React.createElement("span", { className: "ts-label" }, "Triage Model:"),
            React.createElement(SearchableDropdown, {
              placeholder: "e.g. oc/jev-1.13-free, jev-1.13-fast, deepseek-chat",
              value: config.model,
              allowCustom: true,
              style: { flex: 1 },
              options: [
                { id: "oc/jev-1.13-free", label: "oc/jev-1.13-free", sub: "9Router / OpenCode" },
                { id: "jev-1.13-free", label: "jev-1.13-free", sub: "OpenCode Zen" },
                { id: "jev-1.13-fast", label: "jev-1.13-fast", sub: "TypeSafe" },
                ...harnessModels.map((m) => ({ id: m.id, label: m.displayName || m.id, sub: m.provider })),
              ],
              onSelect: (selectedId) => setConfig({ ...config, model: selectedId }),
              onChangeCustom: (typedValue) => setConfig({ ...config, model: typedValue }),
            })
          )
        ),
        // Section: Subagent Model Classifier Tiers with Harness Model Dropdowns
        React.createElement(
          "div",
          { className: "ts-section" },
          React.createElement(
            "div",
            { className: "ts-section-title" },
            React.createElement("span", null, "2. Subagent Model Classifier Tiers (Synced with Harness)"),
            React.createElement(
              "button",
              {
                type: "button",
                className: "ts-button",
                style: { padding: "2px 8px", fontSize: "11px" },
                onClick: loadHarnessModels,
              },
              "↻ Sync Models"
            )
          ),
          React.createElement("p", { className: "ts-desc", style: { marginBottom: "14px" } }, "Select or search a registered harness model to prepend to a tier, or type comma-separated models:"),
          // Cheap Tier
          React.createElement(
            "div",
            { className: "ts-tier-box", style: { borderLeftColor: "#3fb950" } },
            React.createElement(
              "div",
              { className: "ts-tier-header" },
              React.createElement("span", { style: { color: "#3fb950", fontWeight: "600", fontSize: "13px" } }, "Cheap (Leaf Tasks / Simple Fast Queries)"),
              React.createElement(SearchableDropdown, {
                placeholder: "+ Search & add model...",
                value: "",
                style: { width: "240px" },
                options: harnessModels.map((m) => ({ id: m.id, label: m.displayName || m.id, sub: m.provider })),
                onSelect: (modelId) => addModelToTier("cheap", modelId),
              })
            ),
            React.createElement("input", {
              className: "ts-input",
              placeholder: "e.g. gemini-2.5-flash, deepseek-chat",
              value: config.modelTiers?.cheap || "",
              onChange: (e) => setConfig({
                ...config,
                modelTiers: { ...config.modelTiers, cheap: e.target.value },
              }),
            })
          ),
          // Medium Tier
          React.createElement(
            "div",
            { className: "ts-tier-box", style: { borderLeftColor: "#58a6ff" } },
            React.createElement(
              "div",
              { className: "ts-tier-header" },
              React.createElement("span", { style: { color: "#58a6ff", fontWeight: "600", fontSize: "13px" } }, "Medium (Balanced / Scoped Edits & Reviews)"),
              React.createElement(SearchableDropdown, {
                placeholder: "+ Search & add model...",
                value: "",
                style: { width: "240px" },
                options: harnessModels.map((m) => ({ id: m.id, label: m.displayName || m.id, sub: m.provider })),
                onSelect: (modelId) => addModelToTier("medium", modelId),
              })
            ),
            React.createElement("input", {
              className: "ts-input",
              placeholder: "e.g. gemini-2.5-pro, claude-3-5-haiku",
              value: config.modelTiers?.medium || "",
              onChange: (e) => setConfig({
                ...config,
                modelTiers: { ...config.modelTiers, medium: e.target.value },
              }),
            })
          ),
          // Smart Tier
          React.createElement(
            "div",
            { className: "ts-tier-box", style: { borderLeftColor: "#bc8cff" } },
            React.createElement(
              "div",
              { className: "ts-tier-header" },
              React.createElement("span", { style: { color: "#bc8cff", fontWeight: "600", fontSize: "13px" } }, "Smart (Deep Reasoning / Architecture Audits)"),
              React.createElement(SearchableDropdown, {
                placeholder: "+ Search & add model...",
                value: "",
                style: { width: "240px" },
                options: harnessModels.map((m) => ({ id: m.id, label: m.displayName || m.id, sub: m.provider })),
                onSelect: (modelId) => addModelToTier("smart", modelId),
              })
            ),
            React.createElement("input", {
              className: "ts-input",
              placeholder: "e.g. deepseek-reasoner, claude-3-7-sonnet",
              value: config.modelTiers?.smart || "",
              onChange: (e) => setConfig({
                ...config,
                modelTiers: { ...config.modelTiers, smart: e.target.value },
              }),
            })
          )
        ),
        // Section: Tool Pruning Mode
        React.createElement(
          "div",
          { className: "ts-section" },
          React.createElement("div", { className: "ts-section-title" }, "3. Tool Pruning Mode"),
          React.createElement(
            "p",
            { className: "ts-desc", style: { marginBottom: "10px" } },
            "Control tool schema pruning intensity before prompt assembly:"
          ),
          React.createElement(
            "div",
            { className: "ts-row" },
            React.createElement("span", { className: "ts-label" }, "Pruning Mode:"),
            React.createElement(
              "select",
              {
                className: "ts-select",
                value: config.toolPruningMode || config.modules?.toolPruningMode || "normal",
                onChange: (e) => {
                  const val = e.target.value;
                  setConfig({
                    ...config,
                    toolPruningMode: val,
                    modules: {
                      ...(config.modules || {}),
                      toolPruningMode: val,
                      toolPruning: val !== "off",
                    },
                  });
                },
              },
              React.createElement("option", { value: "normal" }, "Normal (Intent-based pruning, keep core tools)"),
              React.createElement("option", { value: "extreme" }, "Extreme (Strict intent pruning, no core fallback)"),
              React.createElement("option", { value: "off" }, "Off (Do not prune tools)")
            )
          )
        ),
        // Actions
        React.createElement(
          "div",
          { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "16px" } },
          React.createElement(
            "button",
            { className: "ts-button", onClick: handleTest, disabled: testing },
            testing ? "Testing..." : "Test Jev Connection"
          ),
          React.createElement(
            "button",
            { className: "ts-button ts-button-primary", onClick: handleSave },
            "Save Settings"
          )
        ),
        testStatus && React.createElement(
          "pre",
          {
            style: {
              marginTop: "12px",
              padding: "10px 14px",
              background: "rgba(0,0,0,0.45)",
              border: "1px solid var(--dsw-alias-border-subtle)",
              borderRadius: "6px",
              fontFamily: "var(--ds-font-family-code, monospace)",
              fontSize: "12px",
              color: "var(--dsw-alias-label-primary)",
              userSelect: "all",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: "180px",
              overflowY: "auto",
            },
          },
          testStatus
        )
      );
    }

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots) return;

      ctx.effect(() => {
        // 1. Settings tab item
        const dispose1 = slots.inject("settings.plugin.item", () =>
          slots.register(
            { name: "settings.plugin.item", key: "tokenslash" },
            (slotProps) =>
              slotProps && slotProps.view === "summary"
                ? "TypeSafe Jev token trimming suite, subagent routing & output compaction"
                : React.createElement(TokenSlashView, null)
          )
        );

        // 2. Installed row configuration
        const dispose2 = slots.inject("plugins.row.config", () =>
          slots.register(
            { name: "plugins.row.config", key: "tokenslash" },
            (slotProps) =>
              slotProps && slotProps.view === "summary"
                ? "TypeSafe Jev token trimming suite, subagent routing & output compaction"
                : React.createElement(TokenSlashView, null)
          )
        );

        // 3. In-Chat Composer Pill (conversation.input.left)
        const dispose3 = slots.inject("conversation.input.left", () =>
          slots.register(
            { name: "conversation.input.left", id: "tokenslash-pill", order: 50 },
            () => React.createElement(TokenSlashComposerPill, null)
          )
        );

        // 4. In-Chat Turn Tail (conversation.chat.turnTail)
        const dispose4 = slots.inject("conversation.chat.turnTail", () =>
          slots.register(
            { name: "conversation.chat.turnTail", select: () => true },
            (props) => React.createElement(TokenSlashTurnTail, props)
          )
        );

        return () => {
          if (typeof dispose1 === "function") dispose1();
          if (typeof dispose2 === "function") dispose2();
          if (typeof dispose3 === "function") dispose3();
          if (typeof dispose4 === "function") dispose4();
        };
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
