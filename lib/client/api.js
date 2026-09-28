const BRIDGE_PREFIX = "/api/dsh-tokenslash";

async function request(path, options = {}) {
  try {
    const res = await fetch(`${BRIDGE_PREFIX}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, data: null, error: data.error || data.message || `HTTP ${res.status}` };
    }
    return { ok: true, data, error: null };
  } catch (err) {
    return { ok: false, data: null, error: err.message };
  }
}

export async function fetchConfig() {
  return request("/config");
}

export async function saveConfig(config) {
  return request("/save", { method: "POST", body: JSON.stringify(config) });
}

export async function testConnection(config) {
  return request("/test", { method: "POST", body: JSON.stringify(config) });
}

export async function describeTask(task, context, model) {
  return request("/describe", { method: "POST", body: JSON.stringify({ task, context, model }) });
}

export async function triageTask(questions, model, timeoutMs, retries) {
  return request("/triage", { method: "POST", body: JSON.stringify({ questions, model, timeoutMs, retries }) });
}

export async function fetchModels() {
  return request("/models");
}

export async function fetchStats() {
  return request("/stats");
}

export async function fetchHistory(limit = 100) {
  return request(`/history?limit=${limit}`);
}