import test from "node:test";
import assert from "node:assert/strict";
import { API_HOST, classifyError, createApiClient } from "../scripts/lib/api.mjs";

const env = { XAI_API_KEY: "test-key-not-for-logs" };
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("authenticated requests use only the exact API host and bearer header", async () => {
  let seen;
  const api = createApiClient({ env, fetchImpl: async (url, init) => { seen = { url, init }; return ok({ data: [] }); } });
  await api.listModels();
  assert.equal(new URL(seen.url).hostname, API_HOST);
  assert.equal(seen.init.headers.Authorization, "Bearer test-key-not-for-logs");
  await assert.rejects(() => api.requestAuthenticated("https://example.com/nope"), /path must start/);
});

test("chat does not automatically resubmit a billable server failure", async () => {
  let calls = 0;
  const api = createApiClient({ env, sleep: async () => {}, fetchImpl: async () => {
    calls += 1;
    return calls === 1 ? new Response('{"error":"temporary"}', { status: 503 }) : ok({ choices: [{ message: { content: "pong" } }], usage: { total_tokens: 2 } });
  } });
  await assert.rejects(api.chat({ model: "grok-4.3", messages: [{ role: "user", content: "ping" }] }), error => error.error_class === "network" && error.retryable === false);
  assert.equal(calls, 1);
});

test("chat does not retry a client error or expose the key", async () => {
  let calls = 0;
  const api = createApiClient({ env, fetchImpl: async () => { calls += 1; return new Response('{"code":"bad_request","error":"bad"}', { status: 400 }); } });
  await assert.rejects(() => api.chat({ model: "grok-4.3", messages: [] }), (error) => {
    assert.equal(error.error_class, "usage");
    assert.ok(!error.message.includes(env.XAI_API_KEY));
    return true;
  });
  assert.equal(calls, 1);
});

test("classifyError maps the runtime taxonomy", () => {
  assert.equal(classifyError(401, { error: "no" }).error_class, "auth");
  assert.equal(classifyError(402, { error: "no" }).error_class, "quota");
  assert.equal(classifyError(429, { error: "no" }).error_class, "rate_limit");
  assert.equal(classifyError(400, { error: "moderation blocked" }).error_class, "moderation");
  assert.equal(classifyError(410, { error: "deprecated" }).error_class, "capability_unavailable");
  assert.equal(classifyError(503, { error: "down" }).error_class, "network");
});

test("request timeout aborts the injected fetch", async () => {
  let aborted = false;
  const api = createApiClient({ env, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); })) });
  await assert.rejects(() => api.listModels({ timeoutMs: 1 }), (error) => error.error_class === "network");
  assert.equal(aborted, true);
});

test("respond uses the captured responses API shape and extracts citations", async () => {
  let body;
  const api = createApiClient({ env, fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body);
    return ok({ output: [{ type: "message", content: [{ type: "output_text", text: "fresh", annotations: [{ type: "url_citation", url: "https://example.test", title: "Example" }] }] }], usage: { num_sources_used: 1 } });
  } });
  const result = await api.respond({ model: "grok-4.6", input: [{ role: "user", content: "now" }], tools: [{ type: "web_search" }, { type: "x_search" }] });
  assert.deepEqual(body.tools, [{ type: "web_search" }, { type: "x_search" }]);
  assert.equal(result.content, "fresh");
  assert.deepEqual(result.citations, [{ url: "https://example.test", title: "Example" }]);
});
