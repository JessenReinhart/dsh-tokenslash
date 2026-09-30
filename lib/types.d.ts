// lib/types.d.ts
// TypeScript definitions for dsh-tokenslash

export interface JEVProviderMetadata {
  name: string;
  baseUrl: string;
  defaultModel: string;
  needsAuth: boolean;
}

export interface ProviderConfig {
  id: string;
  provider: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  needsAuth: boolean;
}

export interface ModelTiers {
  cheap: string[];
  medium: string[];
  smart: string[];
}

export interface ModulesConfig {
  subagentRouting: boolean;
  toolPruning: boolean;
  outputCompacting: boolean;
  goalGuard: boolean;
}

export interface Config {
  enabled: boolean;
  provider: string;
  customBaseUrl: string;
  apiKey: string;
  model: string;
  decoupleThreshold: number;
  modelTiers: ModelTiers;
  pinnedTools?: string[];
  failOpen?: boolean;
  modules: ModulesConfig;
}

export interface TriageDecision {
  route?: string;
  prune?: string;
  compact?: string;
  summarize?: string;
  [key: string]: unknown;
}

export interface TriageResult extends TriageDecision {
  ok?: boolean;
  provider?: string;
  model?: string;
  error?: string;
}

export interface TelemetryEntry {
  type: string;
  savedTokens: number;
  originalTokens?: number | null;
  compactedTokens?: number | null;
  tokenizerMode?: string | null;
  timestamp: number;
  [key: string]: unknown;
}

export interface TelemetryStats {
  totalTokensSaved: number;
  estimatedCostSavedUsd: string;
  subagentsDecoupledCount: number;
  toolsPrunedCount: number;
  promptsPrunedCount?: number;
  outputsCompactedCount: number;
  lastPruneEvent?: unknown;
  tokenizerMode?: string | null;
  bpeEventCount?: number;
  fallbackEventCount?: number;
}

export interface TokenslashTelemetryInstance {
  record(action: string, tokens?: number, metadata?: Record<string, unknown>): void;
  recordSubagentDecouple(savedTokens?: number, metadata?: Record<string, unknown>): void;
  recordToolPrune(savedTokens?: number, metadata?: Record<string, unknown>): void;
  recordPromptPrune(savedTokens?: number, metadata?: Record<string, unknown>): void;
  recordOutputCompact(savedTokens?: number, metadata?: Record<string, unknown>): void;
  setLastPruneEvent(evt: unknown): void;
  reset(): void;
  getStats(): TelemetryStats;
  getHistory(limit?: number): TelemetryEntry[];
  toJSON(): TelemetryStats & { history: TelemetryEntry[] };
  fromJSON(json: unknown): TokenslashTelemetryInstance;
}

export interface JevClientOptions {
  timeoutMs?: number;
  retries?: number;
}

export interface JevClientInstance {
  triage(questions: Record<string, unknown>, options?: TriageOptions): Promise<TriageResult>;
  testConnection(options?: ConnectionTestOptions): Promise<{ ok: boolean; provider?: string; model?: string; error?: string }>;
  getModels(options?: { timeoutMs?: number }): Promise<string[]>;
  buildUrl(path: string): string;
  request(path: string, options: RequestOptions): Promise<unknown>;
}

export interface TriageOptions {
  model?: string;
  path?: string;
  timeoutMs?: number;
  retries?: number;
}

export interface ConnectionTestOptions {
  path?: string;
  timeoutMs?: number;
  retries?: number;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export interface BridgeRoutes {
  routes: Array<{
    path: string;
    method: string;
    handler: (request: Request) => Promise<Response>;
  }>;
  updateConfig: (newConfig: Partial<Config>) => void;
  updateJevClient: (client: JevClientInstance) => void;
}

export interface PluginExports {
  apply: (ctx: unknown, rawConfig?: Partial<Config>) => {
    config: Config;
    telemetry: TokenslashTelemetryInstance;
    jevClient: JevClientInstance;
    providers: ProviderConfig[];
    dispose: () => void;
  };
  inject: (ctx: unknown) => void;
}

export declare const apply: PluginExports["apply"];
export declare const inject: PluginExports["inject"];

export default PluginExports;
