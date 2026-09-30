// lib/shared/tokenizer.js
// Real BPE token counting for dsh-tokenslash telemetry. Falls back to chars/4 when
// the tokenizer cannot be loaded (e.g. missing dep in a stripped runtime copy).

const encoderCache = new Map();

let cl100kModule = null;
let o200kModule = null;

try {
  // eslint-disable-next-line no-undef
  const [cl, o2] = await Promise.all([
    import("gpt-tokenizer/encoding/cl100k_base"),
    import("gpt-tokenizer/encoding/o200k_base")
  ]);
  cl100kModule = cl;
  o200kModule = o2;
} catch {
  cl100kModule = null;
  o200kModule = null;
}

export const TOKENIZER_MODE = {
  current: cl100kModule ? "bpe" : "fallback"
};

export function isBpeActive() {
  return TOKENIZER_MODE.current === "bpe";
}

export function resolveEncodingName(model) {
  if (!model || typeof model !== "string") {
    return "cl100k_base";
  }
  const lower = model.toLowerCase();
  if (
    lower.includes("o200k") ||
    lower.includes("gpt-4o") ||
    lower.includes("gpt-4.1") ||
    lower.includes("o1") ||
    lower.includes("o3")
  ) {
    return "o200k_base";
  }
  return "cl100k_base";
}

export function getEncoder(encodingName) {
  if (!isBpeActive()) {
    return null;
  }
  if (encoderCache.has(encodingName)) {
    return encoderCache.get(encodingName);
  }

  let encoder = null;
  if (encodingName === "o200k_base" && o200kModule) {
    encoder = o200kModule.default || o200kModule;
  } else if (cl100kModule) {
    encoder = cl100kModule.default || cl100kModule;
  }

  if (encoder) {
    encoderCache.set(encodingName, encoder);
  }
  return encoder;
}

export function countText(text, model) {
  const str = typeof text === "string" ? text : String(text ?? "");
  if (!isBpeActive()) {
    return Math.ceil(str.length / 4);
  }
  const encodingName = resolveEncodingName(model);
  const encoder = getEncoder(encodingName);
  if (!encoder || typeof encoder.countTokens !== "function") {
    return Math.ceil(str.length / 4);
  }
  try {
    return encoder.countTokens(str);
  } catch {
    return Math.ceil(str.length / 4);
  }
}

export function countTokens(textOrObj, model) {
  if (typeof textOrObj === "string") {
    return countText(textOrObj, model);
  }
  let serialized;
  try {
    serialized = JSON.stringify(textOrObj);
  } catch {
    serialized = String(textOrObj);
  }
  return countText(serialized, model);
}
