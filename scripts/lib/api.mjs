export const API_HOST = "api.x.ai";
const API_BASE = `https://${API_HOST}/v1`;
const DEFAULT_CHAT_TIMEOUT_MS = 300_000;
const DEFAULT_MODELS_TIMEOUT_MS = 30_000;

function messageFor(body) {
  return String(body?.error?.message ?? body?.error ?? body?.message ?? "request failed").slice(0, 1000);
}

export function classifyError(status, bodyJson = {}) {
  const message = messageFor(bodyJson);
  const lower = message.toLowerCase();
  let error_class = "usage";
  if (status === 401 || status === 403) error_class = "auth";
  else if (status === 402 || /quota|billing|insufficient/.test(lower)) error_class = "quota";
  else if (status === 429) error_class = "rate_limit";
  else if (/moderation|safety/.test(lower)) error_class = "moderation";
  else if (status === 404 || status === 410 || /unsupported|unavailable|deprecated/.test(lower)) error_class = "capability_unavailable";
  else if (status >= 500) error_class = "network";
  return { error_class, message, retryable: error_class === "network" || error_class === "rate_limit" };
}

function runtimeError(detail) {
  const error = new Error(detail.message);
  Object.assign(error, detail);
  return error;
}

function parseContent(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw runtimeError({ error_class: "usage", message: "empty completion response", retryable: false });
  return { content: content.trim(), usage: body.usage ?? null, raw: body };
}

function parseResponse(body) {
  const messages = (body?.output ?? []).filter((item) => item?.type === "message");
  const parts = messages.flatMap((item) => item.content ?? []);
  const content = parts.filter((part) => part.type === "output_text" && typeof part.text === "string").map((part) => part.text).join("\n").trim();
  const citations = parts.flatMap((part) => part.annotations ?? []).filter((a) => a?.type === "url_citation" && a.url).map((a) => ({ url: a.url, title: a.title ?? a.url }));
  if (!content) throw runtimeError({ error_class: "usage", message: "empty responses API output", retryable: false });
  return { content, citations, usage: body.usage ?? null, raw: body };
}

export function createApiClient({ fetchImpl = globalThis.fetch, env = process.env, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  async function requestAuthenticated(path, { method = "GET", body, signal, timeoutMs = DEFAULT_CHAT_TIMEOUT_MS } = {}) {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
      throw runtimeError({ error_class: "usage", message: "path must start with a single slash", retryable: false });
    }
    const key = env.XAI_API_KEY;
    if (!key) throw runtimeError({ error_class: "auth", message: "XAI_API_KEY is not set", retryable: false });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      let response;
      try {
        response = await fetchImpl(`${API_BASE}${path}`, {
          method,
          headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
      } catch (cause) {
        throw runtimeError({ error_class: "network", message: cause?.name === "AbortError" ? "API request timed out" : "API network request failed", retryable: true });
      }
      const raw = await response.text();
      let parsed = {};
      // A delivered response with a garbage body may already be billed — never auto-retry it.
      try { parsed = raw ? JSON.parse(raw) : {}; } catch { throw runtimeError({ error_class: "network", message: "API returned non-JSON response", retryable: false }); }
      if (!response.ok) throw runtimeError(classifyError(response.status, parsed));
      return parsed;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function chat({ model, messages, maxTokens, signal }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const body = await requestAuthenticated("/chat/completions", { method: "POST", signal, body: { model, messages, ...(maxTokens ? { max_tokens: maxTokens } : {}) } });
        return parseContent(body);
      } catch (error) {
        if (attempt === 2 || error.error_class !== "network") throw error;
        await sleep(100 * (attempt + 1));
      }
    }
  }

  async function respond({ model, input, tools, signal }) {
    const body = await requestAuthenticated("/responses", { method: "POST", signal, body: { model, input, tools } });
    return parseResponse(body);
  }

  async function listModels({ signal, timeoutMs = DEFAULT_MODELS_TIMEOUT_MS } = {}) {
    const body = await requestAuthenticated("/models", { signal, timeoutMs });
    return (body.data ?? []).filter((model) => model?.id).map((model) => ({ id: model.id, contextLength: model.context_length ?? null }));
  }

  return { requestAuthenticated, chat, respond, listModels };
}

const defaultClient = createApiClient();
export const requestAuthenticated = defaultClient.requestAuthenticated;
export const chat = defaultClient.chat;
export const respond = defaultClient.respond;
export const listModels = defaultClient.listModels;
