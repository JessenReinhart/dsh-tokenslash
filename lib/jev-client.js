// JevClient - native fetch client for System One triage API with retries and timeout
import { SYSTEM_ONE_ENDPOINT } from "./shared/constants.js";
import { getConfigForProvider } from "./config.js";
import { getProviderConfig } from "./providers.js";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JevClient {
  constructor(config = {}, options = {}) {
    this.config = getConfigForProvider(config.provider, config);
    this.provider = getProviderConfig(this.config.provider, this.config);
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
  }

  buildUrl(path = "") {
    const base = (this.provider.baseUrl || "").replace(/\/+$/, "");
    if (!path || path === SYSTEM_ONE_ENDPOINT) {
      if (base.endsWith("/systemone") || base.endsWith("/triage")) return base;
      return `${base}/v1/systemone`;
    }
    if (path.startsWith("http")) return path;
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  buildHeaders(extra = {}) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      ...extra,
    };
    if (this.provider.apiKey) {
      headers.authorization = `Bearer ${this.provider.apiKey}`;
    }
    return headers;
  }

  async request(path, { method = "POST", body, headers = {}, timeoutMs, retries } = {}) {
    const timeout = timeoutMs || this.timeoutMs;
    const maxRetries = retries ?? this.retries;
    const url = this.buildUrl(path);
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, {
          method,
          headers: this.buildHeaders(headers),
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} from ${url}: ${text || res.statusText}`);
        }
        const contentType = res.headers?.get ? res.headers.get("content-type") || "" : "";
        if (contentType.includes("application/json")) {
          return typeof res.json === "function" ? await res.json() : JSON.parse(await res.text());
        }
        if (typeof res.text === "function") return await res.text();
        if (typeof res.json === "function") return await res.json();
        return "";
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (attempt < maxRetries) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        throw lastError;
      }
    }
    throw lastError;
  }

  async triage(questions, options = {}) {
    const payload = {
      model: options.model || this.config.model,
      state: options.state || "triage",
      questions,
    };
    return this.request(options.path || SYSTEM_ONE_ENDPOINT, {
      method: "POST",
      body: payload,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    });
  }

  async testConnection(options = {}) {
    try {
      await this.request(options.path || SYSTEM_ONE_ENDPOINT, {
        method: "POST",
        body: {
          model: this.config.model,
          state: "ping",
          questions: {
            ping: { type: "noul", instructions: "ping" },
          },
        },
        timeoutMs: options.timeoutMs || 8000,
        retries: options.retries ?? 1,
      });
      return { ok: true, provider: this.provider.id, model: this.config.model };
    } catch (err) {
      return { ok: false, provider: this.provider.id, error: err.message };
    }
  }

  async getModels(options = {}) {
    const { fetchModels } = await import("./providers.js");
    return fetchModels(this.provider.id, {
      config: this.config,
      timeoutMs: options.timeoutMs || this.timeoutMs,
    });
  }
}

export default JevClient;
