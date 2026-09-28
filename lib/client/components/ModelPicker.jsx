import React from "react";
import { fetchModels } from "../api.js";

const TIERS = [
  { key: "cheap", label: "Cheap", hint: "Simple tasks, lowest cost" },
  { key: "medium", label: "Medium", hint: "Balanced cost and quality" },
  { key: "smart", label: "Smart", hint: "Complex reasoning tasks" },
  { key: "ultra", label: "Ultra", hint: "Maximum capability tasks" },
];

function TierSelect({ tier, value, models, onChange }) {
  return (
    <div className="ts-tier-row">
      <label className="ts-label" htmlFor={`ts-tier-${tier.key}`}>
        {tier.label}
      </label>
      <select
        id={`ts-tier-${tier.key}`}
        className="ts-select"
        value={value || ""}
        onChange={(e) => onChange(tier.key, e.target.value)}
      >
        <option value="">Inherit / default</option>
        {models.map((m) => (
          <option key={m.id || m.name} value={m.id || m.name}>
            {(m.name || m.id) + (m.provider ? ` (${m.provider})` : "")}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function ModelPicker({ value, onChange, providers, currentProvider }) {
  const [models, setModels] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  const tiers = React.useMemo(() => {
    if (value && typeof value === "object") return value;
    return {};
  }, [value]);

  React.useEffect(() => {
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
  }, []);

  function handleTierChange(tierKey, modelId) {
    const next = { ...tiers, [tierKey]: modelId };
    if (onChange) onChange(next);
  }

  return (
    <div className="ts-provider-select">
      {providers && providers.length > 0 && currentProvider && (
        <div className="ts-field">
          <span className="ts-label">Active provider: {currentProvider}</span>
        </div>
      )}
      {loading && <div className="ts-hint">Loading models…</div>}
      {TIERS.map((tier) => (
        <TierSelect
          key={tier.key}
          tier={tier}
          value={tiers[tier.key]}
          models={models}
          onChange={handleTierChange}
        />
      ))}
      <div className="ts-hint">Pick one model per tier. Empty inherits primary model.</div>
    </div>
  );
}
