import React from "react";
import { fetchModels } from "../api.js";

const DEFAULT_TIERS = [
  { key: "cheap", label: "Cheap", color: "#3fb950", badge: "Fast", hint: "Simple, highly bounded tasks" },
  { key: "medium", label: "Medium", color: "#58a6ff", badge: "Balanced", hint: "Moderate reasoning, balanced cost" },
  { key: "smart", label: "Smart", color: "#bc8cff", badge: "Deep", hint: "Complex context, high-end reasoning" },
];

export function TierSelect({ tier, label, color, badge, hint, value, models, onChange }) {
  const displayLabel = label || tier?.label || tier?.key || "Tier";
  const displayHint = hint || tier?.hint || "";
  const displayBadge = badge || tier?.badge;
  const displayColor = color || tier?.color || "#58a6ff";

  return (
    <div className="ts-tier-box" style={{ borderLeftColor: displayColor }}>
      <div className="ts-tier-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: displayColor, fontWeight: "600", fontSize: "13px" }}>{displayLabel}</span>
          {displayBadge && (
            <span className="ts-badge" style={{ fontSize: "10px", padding: "1px 5px" }}>
              {displayBadge}
            </span>
          )}
        </div>
        {displayHint && <span className="ts-hint" style={{ fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #8b949e)" }}>{displayHint}</span>}
      </div>
      <select
        className="ts-select"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Inherit / default</option>
        {models.map((m) => {
          const id = m.id || m.name;
          const label = m.displayName || (m.name || m.id) + (m.provider ? ` (${m.provider})` : "");
          return (
            <option key={id} value={id}>
              {label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export default function ModelPicker(props) {
  // Mode A: Single tier selector when key or label is provided (called inside DEFAULT_TIERS.map in SettingsCard)
  // Mode A: Single tier selector when tierKey or label is provided (called inside DEFAULT_TIERS.map in SettingsCard)
  // Mode B: Full tier group selector when value is an object mapping tier keys to model strings
  const isSingleTier = Boolean(props.tierKey || props.label);

  const [models, setModels] = React.useState(props.availableModels || []);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (props.availableModels && props.availableModels.length > 0) {
      setModels(props.availableModels);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await fetchModels();
      if (!cancelled && res.ok) {
        const list = res.data.models || res.data.data || [];
        setModels(Array.isArray(list) ? list : []);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [props.availableModels]);

  if (isSingleTier) {
    return (
      <TierSelect
        tier={{ key: props.tierKey, label: props.label, color: props.color, badge: props.badge, hint: props.hint }}
        label={props.label}
        color={props.color}
        badge={props.badge}
        hint={props.hint}
        value={props.value}
        models={models}
        onChange={(val) => {
          if (props.onChange) {
            props.onChange(val);
          }
        }}
      />
    );
  }

  const tiers = React.useMemo(() => {
    if (props.value && typeof props.value === "object") return props.value;
    return {};
  }, [props.value]);

  function handleTierChange(tierKey, modelId) {
    const next = { ...tiers, [tierKey]: modelId };
    if (props.onChange) props.onChange(next);
  }

  return (
    <div className="ts-provider-select">
      {props.providers && props.providers.length > 0 && props.currentProvider && (
        <div className="ts-field">
          <span className="ts-label">Active provider: {props.currentProvider}</span>
        </div>
      )}
      {loading && <div className="ts-hint">Loading models…</div>}
      {DEFAULT_TIERS.map((tier) => (
        <TierSelect
          key={tier.key}
          tier={tier}
          label={tier.label}
          color={tier.color}
          badge={tier.badge}
          hint={tier.hint}
          value={tiers[tier.key]}
          models={models}
          onChange={(modelId) => handleTierChange(tier.key, modelId)}
        />
      ))}
      <div className="ts-hint">Pick one model per tier. Empty inherits primary model.</div>
    </div>
  );
}
