// lib/triage.js
// Shared TypeSafe Jev triage engine wrapper:
// - Batches questions into single System One POST requests
// - In-flight promise deduplication (stampede prevention)
// - LRU result cache with TTL (TTFT acceleration)
// - Head+Tail contextual state clipping
// - Fail-open / fallback resilience

export const TRIAGE_CACHE_MAX = 128;
export const TRIAGE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const _triageCache = new Map();
const _inFlight = new Map();

/**
 * Clips state to maxChars preserving both the beginning (instructions/preamble)
 * and the end (most recent user input/error/tail) of the text.
 */
export function clipState(text, maxChars = 800) {
  if (!text || typeof text !== "string") return "";
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const half = Math.floor((maxChars - 7) / 2); // 7 for "\n...\n"
  return `${trimmed.slice(0, half)}\n...\n${trimmed.slice(-half)}`;
}

/**
 * Deterministic hash key for questions + state + model to power the LRU cache.
 */
export function triageHashKey(questions, state = "", model = "") {
  const parts = [];
  if (model) parts.push(`m:${model}`);
  if (state) parts.push(`s:${state.slice(0, 300)}`);
  if (questions && typeof questions === "object") {
    const sortedKeys = Object.keys(questions).sort();
    for (const k of sortedKeys) {
      const q = questions[k];
      if (typeof q === "string") {
        parts.push(`${k}:${q.slice(0, 100)}`);
      } else if (q && typeof q === "object") {
        parts.push(`${k}:${q.type || ""}:${(q.instructions || "").slice(0, 100)}`);
      }
    }
  }
  const str = parts.join("|");
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/**
 * Clear the internal triage cache (useful for tests and settings changes).
 */
export function clearTriageCache() {
  _triageCache.clear();
  _inFlight.clear();
}

/**
 * Executes a batched triage request against Jev with cache, deduplication, and fail-open.
 *
 * @param {object|function} jevClientOrGetter - JevClient instance or getter function
 * @param {object} questions - Map of questionId to { type: "noul"|"choice", ... }
 * @param {object} options
 * @param {string} [options.state] - Contextual text (will be head+tail clipped)
 * @param {string} [options.model] - Override model
 * @param {number} [options.timeoutMs] - Timeout in ms
 * @param {number} [options.retries] - Retries
 * @param {boolean} [options.noCache=false] - Skip cache read/write
 * @param {object} [options.logger] - Logger instance
 * @param {object} [options.telemetry] - Telemetry recorder
 * @returns {Promise<object>} Map of answers
 */
export async function triageBatch(jevClientOrGetter, questions, options = {}) {
  if (!questions || typeof questions !== "object" || Object.keys(questions).length === 0) {
    return { answers: {} };
  }

  const client = typeof jevClientOrGetter === "function" ? jevClientOrGetter() : jevClientOrGetter;
  if (!client || typeof client.triage !== "function") {
    return { answers: {}, skipped: true, reason: "no_client" };
  }

  const {
    state = "",
    model,
    timeoutMs = 5000,
    retries = 0,
    noCache = false,
    logger,
    telemetry,
  } = options;

  const clippedState = clipState(state, 800);
  const cacheKey = triageHashKey(questions, clippedState, model);

  // 1. Check cache
  if (!noCache) {
    const cached = _triageCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < TRIAGE_CACHE_TTL_MS) {
      logger?.debug?.(`[tokenslash] triage cache hit (key=${cacheKey})`);
      telemetry?.record?.("triage_cache_hit", 0, { key: cacheKey });
      return cached.result;
    }
  }

  // 2. In-flight request deduplication (prevents stampede when parallel callers need same triage)
  if (_inFlight.has(cacheKey)) {
    return _inFlight.get(cacheKey);
  }

  const flightPromise = (async () => {
    try {
      const startTime = Date.now();
      const res = await client.triage(questions, {
        state: clippedState,
        model,
        timeoutMs,
        retries,
      });

      const latencyMs = Date.now() - startTime;
      const answers = res?.answers || res || {};

      const result = { answers, raw: res, cached: false, latencyMs };

      // Cache result
      if (!noCache && answers && typeof answers === "object" && Object.keys(answers).length > 0) {
        if (_triageCache.size >= TRIAGE_CACHE_MAX) {
          const oldest = _triageCache.keys().next().value;
          _triageCache.delete(oldest);
        }
        _triageCache.set(cacheKey, { result, ts: Date.now() });
      }

      telemetry?.record?.("triage_batch", 0, {
        questionCount: Object.keys(questions).length,
        latencyMs,
        model,
      });

      return result;
    } finally {
      _inFlight.delete(cacheKey);
    }
  })();

  _inFlight.set(cacheKey, flightPromise);
  return flightPromise;
}
