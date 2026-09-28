// TokenslashTelemetry - telemetry tracking for token savings and cost estimation

import { TOKEN_COST_PER_1K } from "./shared/constants.js";

const MAX_HISTORY = 500;
// Blended fallback rate for models not in TOKEN_COST_PER_1K table
const FALLBACK_COST_PER_1K = 0.001;

export class TokenslashTelemetry {
  constructor() {
    this.totalTokensSaved = 0;
    this.estimatedCostSavedUsd = "0.00";
    this.subagentsDecoupledCount = 0;
    this.toolsPrunedCount = 0;
    this.promptsPrunedCount = 0;
    this.outputsCompactedCount = 0;
    this.history = [];
    this._lastModel = null;
    this.lastPruneEvent = null; // { at, toolsCount, sectionsCount, tokensSaved, mode }
  }

  updateCost(model) {
    const modelKey = model || this._lastModel;
    const ratePerK = (modelKey && TOKEN_COST_PER_1K[modelKey] != null)
      ? TOKEN_COST_PER_1K[modelKey]
      : (2.19 / 1000); // Default blended rate $2.19/1M tokens ($0.00219/1K)
    const ratePerToken = ratePerK / 1000;
    this.estimatedCostSavedUsd = (this.totalTokensSaved * ratePerToken).toFixed(2);
  }

  _pushHistory(entry) {
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
  }

  record(action, tokens = 0, metadata = {}) {
    if (action === "subagent_decouple") {
      this.recordSubagentDecouple(tokens, metadata);
    } else if (action === "tool_prune") {
      this.recordToolPrune(tokens, metadata);
    } else if (action === "prompt_prune") {
      this.recordPromptPrune(tokens, metadata);
    } else if (action === "output_compact") {
      this.recordOutputCompact(tokens, metadata);
    } else {
      this.totalTokensSaved += tokens;
      this.updateCost(metadata?.model);
      this._pushHistory({ type: action, savedTokens: tokens, timestamp: Date.now(), ...metadata });
    }
  }

  recordSubagentDecouple(savedTokens = 0, metadata = {}) {
    this.subagentsDecoupledCount++;
    this.totalTokensSaved += savedTokens;
    if (metadata?.model) this._lastModel = metadata.model;
    this.updateCost(metadata?.model);
    this._pushHistory({ type: "subagent_decouple", savedTokens, timestamp: Date.now(), ...metadata });
  }

  recordToolPrune(savedTokens = 0, metadata = {}) {
    this.toolsPrunedCount++;
    this.totalTokensSaved += savedTokens;
    this.updateCost(metadata?.model);
    this._pushHistory({ type: "tool_prune", savedTokens, timestamp: Date.now(), ...metadata });
  }

  recordPromptPrune(savedTokens = 0, metadata = {}) {
    this.promptsPrunedCount++;
    this.totalTokensSaved += savedTokens;
    this.updateCost(metadata?.model);
    this._pushHistory({ type: "prompt_prune", savedTokens, timestamp: Date.now(), ...metadata });
  }

  recordOutputCompact(savedTokens = 0, metadata = {}) {
    this.outputsCompactedCount++;
    this.totalTokensSaved += savedTokens;
    this.updateCost(metadata?.model);
    this._pushHistory({ type: "output_compact", savedTokens, timestamp: Date.now(), ...metadata });
  }

  reset() {
    this.totalTokensSaved = 0;
    this.estimatedCostSavedUsd = "0.00";
    this.subagentsDecoupledCount = 0;
    this.toolsPrunedCount = 0;
    this.promptsPrunedCount = 0;
    this.outputsCompactedCount = 0;
    this.history = [];
    this._lastModel = null;
    this.lastPruneEvent = null;
  }

  setLastPruneEvent(evt) {
    this.lastPruneEvent = evt;
  }

  getStats() {
    return {
      totalTokensSaved: this.totalTokensSaved,
      estimatedCostSavedUsd: this.estimatedCostSavedUsd,
      subagentsDecoupledCount: this.subagentsDecoupledCount,
      toolsPrunedCount: this.toolsPrunedCount,
      promptsPrunedCount: this.promptsPrunedCount,
      outputsCompactedCount: this.outputsCompactedCount,
      lastPruneEvent: this.lastPruneEvent,
    };
  }

  getHistory(limit = 100) {
    return this.history.slice(-limit);
  }

  toJSON() {
    return {
      totalTokensSaved: this.totalTokensSaved,
      estimatedCostSavedUsd: this.estimatedCostSavedUsd,
      subagentsDecoupledCount: this.subagentsDecoupledCount,
      toolsPrunedCount: this.toolsPrunedCount,
      promptsPrunedCount: this.promptsPrunedCount,
      outputsCompactedCount: this.outputsCompactedCount,
      history: this.history,
    };
  }

  static fromJSON(json) {
    const telemetry = new TokenslashTelemetry();
    if (!json) return telemetry;
    telemetry.totalTokensSaved = json.totalTokensSaved ?? 0;
    telemetry.estimatedCostSavedUsd = json.estimatedCostSavedUsd ?? "0.00";
    telemetry.subagentsDecoupledCount = json.subagentsDecoupledCount ?? 0;
    telemetry.toolsPrunedCount = json.toolsPrunedCount ?? 0;
    telemetry.promptsPrunedCount = json.promptsPrunedCount ?? 0;
    telemetry.outputsCompactedCount = json.outputsCompactedCount ?? 0;
    telemetry.history = Array.isArray(json.history) ? json.history.slice(-MAX_HISTORY) : [];
    return telemetry;
  }
}

export default TokenslashTelemetry;
