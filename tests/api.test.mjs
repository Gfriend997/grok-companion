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
  const api = createApiClient({ env, fetchImpl: async () => {
    calls += 1;
    return calls === 1 ? new Response('{"error":"temporary"}', { status: 503 }) : ok({ choices: [{ message: { content: "pong" } }], usage: { total_tokens: 2 } });
  } });
  await assert.rejects(api.chat({ model: "grok-4.3", messages: [{ role: "user", content: "ping" }] }), (error) => error.error_class === "network" && error.retryable === false);
  assert.equal(calls, 1);
});

test("every failed non-GET request is not retryable, including 429; GET keeps its retryable value", async () => {
  for (const status of [503, 429]) {
    const api = createApiClient({ env, fetchImpl: async () => new Response('{"error":"busy"}', { status }) });
    await assert.rejects(api.requestAuthenticated("/chat/completions", { method: "POST", body: {} }), (error) => error.retryable === false, String(status));
  }
  const thrown = createApiClient({ env, fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(thrown.requestAuthenticated("/tts", { method: "POST", body: {} }), (error) => error.error_class === "network" && error.retryable === false && /may already have been accepted/.test(error.message));
  const timeout = createApiClient({ env, fetchImpl: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); } });
  await assert.rejects(timeout.requestAuthenticated("/tts", { method: "POST", body: {} }), (error) => error.retryable === false && /timed out; submission may already have been accepted/.test(error.message));
  const get = createApiClient({ env, fetchImpl: async () => new Response('{"error":"down"}', { status: 503 }) });
  await assert.rejects(get.requestAuthenticated("/models"), (error) => error.error_class === "network" && error.retryable === true);
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

test("catalog-style requests pass the redirect policy and enforce a byte cap", async () => {
  let seen;
  const api = createApiClient({ env, fetchImpl: async (_url, init) => { seen = init; return ok({ models: [] }); } });
  await api.requestAuthenticated("/language-models", { redirect: "error", maxBytes: 1000 });
  assert.equal(seen.redirect, "error");
  const defaults = createApiClient({ env, fetchImpl: async (_url, init) => { seen = init; return ok({}); } });
  await defaults.requestAuthenticated("/models");
  assert.equal(seen.redirect, "error", "authenticated requests refuse redirects by default");
  const big = createApiClient({ env, fetchImpl: async () => ok({ models: "x".repeat(2000) }) });
  await assert.rejects(() => big.requestAuthenticated("/language-models", { maxBytes: 1000 }), (error) => error.error_class === "network" && /too large/.test(error.message));
  const redirected = createApiClient({ env, fetchImpl: async () => { throw new TypeError("fetch failed: redirect mode is set to error"); } });
  await assert.rejects(() => redirected.requestAuthenticated("/language-models", { redirect: "error" }), (error) => error.error_class === "network");
});

test("the byte cap cancels an oversized streamed body before buffering it", async () => {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(400)); if (pulled > 100) controller.close(); },
    cancel() { cancelled = true; }
  });
  const api = createApiClient({ env, fetchImpl: async () => new Response(stream, { status: 200 }) });
  await assert.rejects(() => api.requestAuthenticated("/language-models", { maxBytes: 1000 }), (error) => error.error_class === "network" && /too large/.test(error.message));
  assert.equal(cancelled, true);
  assert.ok(pulled < 10, `stopped early (pulled ${pulled} chunks)`);
});

test("multipart keeps the native boundary and file-last field order with no JSON content type", async () => {
  const formData = new FormData();
  formData.append("model", "grok-voice-transcribe-2.0");
  formData.append("language", "en");
  formData.append("file", new Blob(["audio"]), "sample.mp3");
  const api = createApiClient({ env, fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.x.ai/v1/stt");
    assert.equal(init.headers.Authorization, `Bearer ${env.XAI_API_KEY}`);
    assert.equal(init.headers["Content-Type"], undefined);
    assert.equal(init.redirect, "error");
    const request = new Request(url, init);
    assert.match(request.headers.get("content-type"), /^multipart\/form-data; boundary=/);
    const received = await request.formData();
    assert.deepEqual([...received.keys()], ["model", "language", "file"]);
    assert.equal(await received.get("file").text(), "audio");
    return ok({ text: "hello" });
  } });
  assert.deepEqual(await api.requestAuthenticated("/stt", { method: "POST", formData, maxBytes: 1024 }), { text: "hello" });
});

test("bytes mode returns the exact Buffer", async () => {
  const bytes = Buffer.from([0xff, 0xfb, 0, 0x80]);
  const api = createApiClient({ env, fetchImpl: async () => new Response(bytes) });
  const result = await api.requestAuthenticated("/tts", { method: "POST", body: { text: "hello" }, responseType: "bytes", maxBytes: 4 });
  assert.ok(Buffer.isBuffer(result));
  assert.deepEqual(result, bytes);
});

test("invalid body and response-mode combinations fail before dispatch", async () => {
  let calls = 0;
  const api = createApiClient({ env, fetchImpl: async () => { calls += 1; return ok({}); } });
  for (const options of [{ body: {}, formData: new FormData() }, { formData: {} }, { responseType: "text" }, { responseType: "bytes" }]) {
    await assert.rejects(api.requestAuthenticated("/tts", { method: "POST", ...options }), (error) => error.error_class === "usage", JSON.stringify(options));
  }
  assert.equal(calls, 0);
});

test("bytes mode still classifies a provider error from its JSON body", async () => {
  const denied = createApiClient({ env, fetchImpl: async () => new Response('{"error":"denied"}', { status: 401 }) });
  await assert.rejects(denied.requestAuthenticated("/tts", { method: "POST", body: {}, responseType: "bytes", maxBytes: 100 }),
    (error) => error.error_class === "auth" && error.message === "denied" && error.retryable === false);
});

test("review fix: a POST body read that fails or times out is network, not retryable, and says it may be accepted", async () => {
  const stalled = { ok: true, status: 200, headers: new Headers(), text: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); } };
  const api = createApiClient({ env, fetchImpl: async () => stalled });
  await assert.rejects(() => api.chat({ model: "m", messages: [] }), (error) => error.error_class === "network" && error.retryable === false && /read failed; submission may already have been accepted/.test(error.message));
  const big = createApiClient({ env, fetchImpl: async () => new Response("x".repeat(20), { status: 200 }) });
  await assert.rejects(() => big.requestAuthenticated("/tts", { method: "POST", body: {}, responseType: "bytes", maxBytes: 5 }), (error) => error.retryable === false && /too large; submission may already have been accepted/.test(error.message));
});
