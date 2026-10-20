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
    this.observationMaskCount = 0;
    this.observationMaskTokensSaved = 0;
    this.outputDistillCount = 0;
    this.outputDistillTokensSaved = 0;
    this.cacheAlignmentEvents = 0;
    this.sessionTurnsCount = 0;
    this.topPrunedTools = {};
    this.toolPruneTokensSaved = 0;
    this.promptPruneTokensSaved = 0;
    this.outputCompactTokensSaved = 0;
    this.subagentDecoupleTokensSaved = 0;
    this.bpeEvents = 0;
    this.fallbackEvents = 0;
    this._lastTokenizerMode = null;
    this.history = [];
    this._lastModel = null;
    this._lastModelPick = null;
    this.lastPruneEvent = null; // { at, toolsCount, sectionsCount, tokensSaved, mode }
    this.tokenMeter = null;
  }

  attachTokenMeter(meter) {
    if (!meter) return;
    this.tokenMeter = meter;
  }

  get hasNativeTokenMeter() {
    return Boolean(this.tokenMeter);
  }

  _resolveSavedTokens(savedTokens, metadata) {
    if (this.tokenMeter && (savedTokens === undefined || Number.isNaN(savedTokens))) {
      const candidate = typeof metadata?.text === "string"
        ? metadata.text
        : (typeof metadata?.original === "string" ? metadata.original : null);
      if (candidate !== null) {
        try {
          const measured = this.tokenMeter?.measure?.(candidate);
          if (typeof measured === "number" && !Number.isNaN(measured)) {
            return measured;
          }
        } catch {
          // fallback to 0
        }
      }
    }
    return (typeof savedTokens === "number" && !Number.isNaN(savedTokens)) ? savedTokens : 0;
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
    } else if (action === "observation_mask" || action === "observation-mask") {
      this.recordObservationMask(tokens, metadata);
    } else if (action === "output_distill" || action === "output-distill") {
      this.recordOutputDistill(tokens, metadata);
    } else if (action === "cache_alignment" || action === "cache-alignment") {
      this.recordCacheAlignment(metadata);
    } else {
      this.totalTokensSaved += tokens;
      this.updateCost(metadata?.model);
      this._pushHistory(this._createHistoryEntry(action, tokens, metadata));
    }
  }

  recordSaved(action, tokens = 0, metadata = {}) {
    return this.record(action, tokens, metadata);
  }

  recordSubagentDecouple(savedTokens = 0, metadata = {}) {
    this.subagentsDecoupledCount++;
    this.subagentDecoupleTokensSaved += savedTokens;
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

  recordToolPrune(savedTokens, metadata = {}) {
    const tokens = this._resolveSavedTokens(savedTokens, metadata);
    this.toolsPrunedCount++;
    this.toolPruneTokensSaved += tokens;
    this.sessionTurnsCount++;
    this.totalTokensSaved += tokens;
    const tools = Array.isArray(metadata?.prunedTools)
      ? metadata.prunedTools
      : (Array.isArray(metadata?.tools) ? metadata.tools : null);
    if (tools) {
      for (const t of tools) {
        const name = typeof t === "string" ? t : (t?.name ?? null);
        if (typeof name === "string" && name) {
          this.topPrunedTools[name] = (this.topPrunedTools[name] || 0) + 1;
        }
      }
    }
    this.updateCost(metadata?.model);
    this._pushHistory(this._createHistoryEntry("tool_prune", tokens, metadata));
  }

  recordPromptPrune(savedTokens, metadata = {}) {
    const tokens = this._resolveSavedTokens(savedTokens, metadata);
    this.promptsPrunedCount++;
    this.promptPruneTokensSaved += tokens;
    this.sessionTurnsCount++;
    this.totalTokensSaved += tokens;
    this.updateCost(metadata?.model);
    this._pushHistory(this._createHistoryEntry("prompt_prune", tokens, metadata));
  }

  recordOutputCompact(savedTokens, metadata = {}) {
    const tokens = this._resolveSavedTokens(savedTokens, metadata);
    this.outputsCompactedCount++;
    this.outputCompactTokensSaved += tokens;
    this.totalTokensSaved += tokens;
    this.updateCost(metadata?.model);
    this._pushHistory(this._createHistoryEntry("output_compact", tokens, metadata));
  }

  recordObservationMask(savedTokens = 0, metadata = {}) {
    const tokens = this._resolveSavedTokens(savedTokens, metadata);
    this.observationMaskCount++;
    this.observationMaskTokensSaved += tokens;
    this.sessionTurnsCount++;
    this.totalTokensSaved += tokens;
    if (metadata?.model) this._lastModel = metadata.model;
    this.updateCost(metadata?.model);
    this._pushHistory(this._createHistoryEntry("observation_mask", tokens, metadata));
  }

  recordOutputDistill(savedTokens = 0, metadata = {}) {
    const tokens = this._resolveSavedTokens(savedTokens, metadata);
    this.outputDistillCount++;
    this.outputDistillTokensSaved += tokens;
    this.totalTokensSaved += tokens;
    if (metadata?.model) this._lastModel = metadata.model;
    this.updateCost(metadata?.model);
    this._pushHistory(this._createHistoryEntry("output_distill", tokens, metadata));
  }

  recordCacheAlignment(metadata = {}) {
    this.cacheAlignmentEvents++;
    if (metadata?.model) this._lastModel = metadata.model;
    this.updateCost(metadata?.model);
    this._pushHistory(this._createHistoryEntry("cache_alignment", 0, metadata));
  }

  _getTopPrunedTools(limit = 10) {
    const entries = Object.entries(this.topPrunedTools);
    entries.sort((a, b) => b[1] - a[1]);
    return Object.fromEntries(entries.slice(0, limit));
  }

  get byModule() {
    return {
      toolPrune: { events: this.toolsPrunedCount > 0 ? this.toolsPrunedCount : 0, tokens: this.toolPruneTokensSaved },
      promptPrune: { events: this.promptsPrunedCount, tokens: this.promptPruneTokensSaved },
      outputCompact: { events: this.outputsCompactedCount, tokens: this.outputCompactTokensSaved },
      observationMask: { events: this.observationMaskCount, tokens: this.observationMaskTokensSaved },
      outputDistill: { events: this.outputDistillCount, tokens: this.outputDistillTokensSaved },
      subagentDecouple: { events: this.subagentsDecoupledCount, tokens: this.subagentDecoupleTokensSaved },
      cacheAlignment: { events: this.cacheAlignmentEvents, tokens: 0 },
    };
  }

  getByModule() {
    return this.byModule;
  }

  reset() {
    this.totalTokensSaved = 0;
    this.estimatedCostSavedUsd = "0.00";
    this.subagentsDecoupledCount = 0;
    this.toolsPrunedCount = 0;
    this.promptsPrunedCount = 0;
    this.outputsCompactedCount = 0;
    this.observationMaskCount = 0;
    this.observationMaskTokensSaved = 0;
    this.outputDistillCount = 0;
    this.outputDistillTokensSaved = 0;
    this.cacheAlignmentEvents = 0;
    this.sessionTurnsCount = 0;
    this.topPrunedTools = {};
    this.toolPruneTokensSaved = 0;
    this.promptPruneTokensSaved = 0;
    this.outputCompactTokensSaved = 0;
    this.subagentDecoupleTokensSaved = 0;
    this.bpeEvents = 0;
    this.fallbackEvents = 0;
    this._lastTokenizerMode = null;
    this.history = [];
    this._lastModel = null;
    this._lastModelPick = null;
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
      observationMaskCount: this.observationMaskCount,
      observationMaskTokensSaved: this.observationMaskTokensSaved,
      outputDistillCount: this.outputDistillCount,
      outputDistillTokensSaved: this.outputDistillTokensSaved,
      cacheAlignmentEvents: this.cacheAlignmentEvents,
      sessionTurnsCount: this.sessionTurnsCount,
      topPrunedTools: this._getTopPrunedTools(10),
      byModule: this.byModule,
      avgTokensSavedPerTurn: Math.round(this.totalTokensSaved / Math.max(1, this.sessionTurnsCount)),
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
      observationMaskCount: this.observationMaskCount,
      observationMaskTokensSaved: this.observationMaskTokensSaved,
      outputDistillCount: this.outputDistillCount,
      outputDistillTokensSaved: this.outputDistillTokensSaved,
      cacheAlignmentEvents: this.cacheAlignmentEvents,
      sessionTurnsCount: this.sessionTurnsCount,
      topPrunedTools: { ...this.topPrunedTools },
      toolPruneTokensSaved: this.toolPruneTokensSaved,
      promptPruneTokensSaved: this.promptPruneTokensSaved,
      outputCompactTokensSaved: this.outputCompactTokensSaved,
      subagentDecoupleTokensSaved: this.subagentDecoupleTokensSaved,
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
    telemetry.observationMaskCount = json.observationMaskCount ?? 0;
    telemetry.observationMaskTokensSaved = json.observationMaskTokensSaved ?? 0;
    telemetry.outputDistillCount = json.outputDistillCount ?? 0;
    telemetry.outputDistillTokensSaved = json.outputDistillTokensSaved ?? 0;
    telemetry.cacheAlignmentEvents = json.cacheAlignmentEvents ?? 0;
    telemetry.sessionTurnsCount = json.sessionTurnsCount ?? 0;
    telemetry.topPrunedTools = (json.topPrunedTools && typeof json.topPrunedTools === "object")
      ? { ...json.topPrunedTools }
      : {};
    telemetry.toolPruneTokensSaved = json.toolPruneTokensSaved ?? 0;
    telemetry.promptPruneTokensSaved = json.promptPruneTokensSaved ?? 0;
    telemetry.outputCompactTokensSaved = json.outputCompactTokensSaved ?? 0;
    telemetry.subagentDecoupleTokensSaved = json.subagentDecoupleTokensSaved ?? 0;
    if (json.toolPruneTokensSaved == null && Array.isArray(json.history)) {
      for (const entry of json.history) {
        if (entry.type === "tool_prune") telemetry.toolPruneTokensSaved += (entry.savedTokens || 0);
        else if (entry.type === "prompt_prune") telemetry.promptPruneTokensSaved += (entry.savedTokens || 0);
        else if (entry.type === "output_compact") telemetry.outputCompactTokensSaved += (entry.savedTokens || 0);
        else if (entry.type === "subagent_decouple") telemetry.subagentDecoupleTokensSaved += (entry.savedTokens || 0);
      }
    }
    telemetry.bpeEvents = json.bpeEvents ?? 0;
    telemetry.fallbackEvents = json.fallbackEvents ?? 0;
    telemetry.history = Array.isArray(json.history) ? json.history.slice(-MAX_HISTORY) : [];
    return telemetry;
  }
}

export default TokenslashTelemetry;
