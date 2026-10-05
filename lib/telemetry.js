// TokenslashTelemetry - telemetry tracking for token savings and cost estimation

import { TOKEN_COST_PER_1K } from "./shared/constants.js";

const MAX_HISTORY = 500;
// Default blended rate $2.19/1M tokens ($0.00219/1K)
export const DEFAULT_BLENDED_COST_PER_1K = 2.19 / 1000;

export class TokenslashTelemetry {
  constructor() {
    this.totalTokensSaved = 0;
    this.estimatedCostSavedUsd = "0.00";
    this.subagentsDecoupledCount = 0;
    this.toolsPrunedCount = 0;
    this.promptsPrunedCount = 0;
    this.outputsCompactedCount = 0;
    this.bpeEvents = 0;
    this.fallbackEvents = 0;
    this._lastTokenizerMode = null;
    this.history = [];
    this._lastModel = null;
    this._lastModelPick = null;
    this.lastPruneEvent = null; // { at, toolsCount, sectionsCount, tokensSaved, mode }
  }

  updateCost(model) {
    const modelKey = model || this._lastModel;
    const ratePerK = (modelKey && TOKEN_COST_PER_1K[modelKey] != null)
      ? TOKEN_COST_PER_1K[modelKey]
      : DEFAULT_BLENDED_COST_PER_1K;
    const ratePerToken = ratePerK / 1000;
    this.estimatedCostSavedUsd = (this.totalTokensSaved * ratePerToken).toFixed(2);
  }

  _trackMode(mode) {
    if (mode === "bpe") {
      this.bpeEvents++;
      this._lastTokenizerMode = "bpe";
    } else if (mode === "fallback") {
      this.fallbackEvents++;
      this._lastTokenizerMode = "fallback";
    }
  }

  _resolveTokenizerMode() {
    if (this.bpeEvents > 0 && this.fallbackEvents > 0) return "mixed";
    if (this.bpeEvents > 0) return "bpe";
    if (this.fallbackEvents > 0) return "fallback";
    return this._lastTokenizerMode ?? null;
  }

  _createHistoryEntry(type, savedTokens, metadata = {}) {
    const meta = metadata || {};
    const mode = meta.tokenizerMode ?? null;
    this._trackMode(mode);
    return {
      ...meta,
      type,
      savedTokens,
      originalTokens: meta.originalTokens ?? null,
      compactedTokens: meta.compactedTokens ?? null,
      tokenizerMode: mode,
      timestamp: meta.timestamp ?? Date.now(),
    };
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
      this._pushHistory(this._createHistoryEntry(action, tokens, metadata));
    }
  }

  recordSubagentDecouple(savedTokens = 0, metadata = {}) {
    this.subagentsDecoupledCount++;
    this.totalTokensSaved += savedTokens;
    if (metadata?.model) this._lastModel = metadata.model;
    this.updateCost(metadata?.model);
    this._pushHistory(this._createHistoryEntry("subagent_decouple", savedTokens, metadata));
  }

  recordSubagentModel({ model, tier, task }) {
    this._lastModelPick = {
      model,
      tier,
      timestamp: Date.now(),
    };
    if (model) this._lastModel = model;
    this.updateCost(model);
  }

  getLastModelPick() {
    return this._lastModelPick;
  }

  recordToolPrune(savedTokens = 0, metadata = {}) {
    this.toolsPrunedCount++;
    this.totalTokensSaved += savedTokens;
    this.updateCost(metadata?.model);
    this._pushHistory(this._createHistoryEntry("tool_prune", savedTokens, metadata));
  }

  recordPromptPrune(savedTokens = 0, metadata = {}) {
    this.promptsPrunedCount++;
    this.totalTokensSaved += savedTokens;
    this.updateCost(metadata?.model);
    this._pushHistory(this._createHistoryEntry("prompt_prune", savedTokens, metadata));
  }

  recordOutputCompact(savedTokens = 0, metadata = {}) {
    this.outputsCompactedCount++;
    this.totalTokensSaved += savedTokens;
    this.updateCost(metadata?.model);
    this._pushHistory(this._createHistoryEntry("output_compact", savedTokens, metadata));
  }

  reset() {
    this.totalTokensSaved = 0;
    this.estimatedCostSavedUsd = "0.00";
    this.subagentsDecoupledCount = 0;
    this.toolsPrunedCount = 0;
    this.promptsPrunedCount = 0;
    this.outputsCompactedCount = 0;
    this.bpeEvents = 0;
    this.fallbackEvents = 0;
    this._lastTokenizerMode = null;
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
      tokenizerMode: this._resolveTokenizerMode(),
      bpeEventCount: this.bpeEvents,
      fallbackEventCount: this.fallbackEvents,
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
      bpeEvents: this.bpeEvents,
      fallbackEvents: this.fallbackEvents,
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
    telemetry.bpeEvents = json.bpeEvents ?? 0;
    telemetry.fallbackEvents = json.fallbackEvents ?? 0;
    telemetry.history = Array.isArray(json.history) ? json.history.slice(-MAX_HISTORY) : [];
    return telemetry;
  }
}

export default TokenslashTelemetry;
