// TokenslashTelemetry - telemetry tracking for token savings and cost estimation

import { TOKEN_COST_PER_1K } from "./shared/constants.js";

export class TokenslashTelemetry {
  constructor() {
    this.totalTokensSaved = 0;
    this.estimatedCostSavedUsd = "0.00";
    this.subagentsDecoupledCount = 0;
    this.toolsPrunedCount = 0;
    this.promptsPrunedCount = 0;
    this.outputsCompactedCount = 0;
    this.history = [];
  }

  updateCost() {
    // Blended rate: $2.19 per 1M tokens ($0.00219 per 1K tokens)
    // 5,000,000 tokens * (2.19 / 1,000,000) = $10.95
    const blendedRatePerToken = 2.19 / 1000000;
    this.estimatedCostSavedUsd = (this.totalTokensSaved * blendedRatePerToken).toFixed(2);
  }

  record(action, tokens = 0, metadata = {}) {
    if (action === "subagent_decouple") {
      this.recordSubagentDecouple(tokens || 3500, metadata);
    } else if (action === "tool_prune") {
      this.recordToolPrune(tokens || 850, metadata);
    } else if (action === "prompt_prune") {
      this.recordPromptPrune(tokens || 2000, metadata);
    } else if (action === "output_compact") {
      this.recordOutputCompact(tokens || 1200, metadata);
    } else {
      this.totalTokensSaved += tokens;
      this.updateCost();
      this.history.push({ type: action, savedTokens: tokens, timestamp: Date.now(), ...metadata });
    }
  }

  recordSubagentDecouple(savedTokens = 3500, metadata = {}) {
    this.subagentsDecoupledCount++;
    this.totalTokensSaved += savedTokens;
    this.updateCost();
    this.history.push({ type: "subagent_decouple", savedTokens, timestamp: Date.now(), ...metadata });
  }

  recordToolPrune(savedTokens = 850, metadata = {}) {
    this.toolsPrunedCount++;
    this.totalTokensSaved += savedTokens;
    this.updateCost();
    this.history.push({ type: "tool_prune", savedTokens, timestamp: Date.now(), ...metadata });
  }

  recordPromptPrune(savedTokens = 2000, metadata = {}) {
    this.promptsPrunedCount++;
    this.totalTokensSaved += savedTokens;
    this.updateCost();
    this.history.push({ type: "prompt_prune", savedTokens, timestamp: Date.now(), ...metadata });
  }

  recordOutputCompact(savedTokens = 1200, metadata = {}) {
    this.outputsCompactedCount++;
    this.totalTokensSaved += savedTokens;
    this.updateCost();
    this.history.push({ type: "output_compact", savedTokens, timestamp: Date.now(), ...metadata });
  }

  reset() {
    this.totalTokensSaved = 0;
    this.estimatedCostSavedUsd = "0.00";
    this.subagentsDecoupledCount = 0;
    this.toolsPrunedCount = 0;
    this.promptsPrunedCount = 0;
    this.outputsCompactedCount = 0;
    this.history = [];
  }

  getStats() {
    return {
      totalTokensSaved: this.totalTokensSaved,
      estimatedCostSavedUsd: this.estimatedCostSavedUsd,
      subagentsDecoupledCount: this.subagentsDecoupledCount,
      toolsPrunedCount: this.toolsPrunedCount,
      promptsPrunedCount: this.promptsPrunedCount,
      outputsCompactedCount: this.outputsCompactedCount,
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
    telemetry.history = Array.isArray(json.history) ? json.history : [];
    return telemetry;
  }
}

export default TokenslashTelemetry;
