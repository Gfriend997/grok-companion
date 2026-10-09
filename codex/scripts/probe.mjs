#!/usr/bin/env node
// Live capability probe against api.x.ai. Dev tool: records scrubbed fixtures
// that become mocked-test ground truth. Run: node scripts/probe.mjs [--video]
// Video probe is paid (~$0.08/sec) and only runs with the explicit --video flag.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = process.env.XAI_API_KEY;
if (!KEY) { console.error("XAI_API_KEY not set"); process.exit(2); }
const BASE = "https://api.x.ai/v1";
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
mkdirSync(FIXTURES, { recursive: true });

const scrub = (s) => s
  .replace(/xai-[A-Za-z0-9]{20,}/g, "xai-REDACTED")
  .replace(/(sig|signature|token|key)=[^&"\s]+/gi, "$1=REDACTED");

function save(name, request, response, note = "") {
  const body = JSON.stringify({ note, request, response }, null, 2);
  writeFileSync(join(FIXTURES, name + ".json"), scrub(body));
  console.log(`fixture: ${name}.json ${note ? "(" + note + ")" : ""}`);
}

async function call(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }
  return { status: res.status, json };
}

// 1x1 white JPEG, tiniest legal file, for the vision probe.
const TINY_JPG_B64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";

const summary = {};

// --- 1. models
{
  const { status, json } = await call("/models");
  save("models", { method: "GET", path: "/v1/models" }, { status, body: json });
  summary.models = json.data?.map((m) => `${m.id}:${m.context_length ?? "?"}`) ?? status;
}

// --- 2. chat minimal
{
  const request = { model: "grok-4.3", messages: [{ role: "user", content: "Reply with the single word: pong" }], max_tokens: 10 };
  const { status, json } = await call("/chat/completions", { method: "POST", body: JSON.stringify(request) });
  save("chat-minimal", request, { status, body: json });
  summary.chat = json.choices?.[0]?.message?.content ?? status;
}

// --- 3. live search via Agent Tools API (/v1/responses; search_parameters on chat is 410-deprecated)
{
  const request = {
    model: "grok-4.6",
    input: [{ role: "user", content: "In one sentence: one notable news item from this week." }],
    tools: [{ type: "web_search" }, { type: "x_search" }],
  };
  const { status, json } = await call("/responses", { method: "POST", body: JSON.stringify(request) });
  save("live-search", request, { status, body: json }, "Responses API + server-side tools; records citations + usage fields");
  summary.liveSearch = { status, keys: Object.keys(json), citations: json.citations ?? "see-fixture", usage: json.usage };
}

// --- 4. image generation (before vision so vision can reuse the artifact URL)
{
  const request = { model: "grok-imagine-image-2.0", prompt: "a single red apple on a white table, studio light", n: 1 };
  const { status, json } = await call("/images/generations", { method: "POST", body: JSON.stringify(request) });
  const item = json.data?.[0] ?? {};
  save("image-generation", request, { status, body: { ...json, data: json.data?.map((d) => ({ ...d, b64_json: d.b64_json ? `(b64 ${d.b64_json.length} chars)` : undefined })) } });
  let host = null;
  if (item.url) { try { host = new URL(item.url).host; } catch {} }
  summary.imageGen = { status, format: item.b64_json ? "b64_json" : item.url ? "url" : Object.keys(item).join(","), artifactHost: host };

  // --- 4b. vision input, reusing the generated artifact URL (proves web-URL image input)
  if (item.url) {
    const vreq = {
      model: "grok-4.3",
      messages: [{ role: "user", content: [
        { type: "text", text: "One word: what fruit is in this image?" },
        { type: "image_url", image_url: { url: item.url } },
      ] }],
      max_tokens: 10,
    };
    const { status: vs, json: vj } = await call("/chat/completions", { method: "POST", body: JSON.stringify(vreq) });
    save("vision-input", { ...vreq, messages: "(generated image URL + question)" }, { status: vs, body: vj });
    summary.vision = vj.choices?.[0]?.message?.content ?? `${vs}: ${JSON.stringify(vj).slice(0, 200)}`;

    // --- 4c. artifact download behavior (no auth header): status + content-type + redirect handling
    const dres = await fetch(item.url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    summary.artifactDownload = { status: dres.status, contentType: dres.headers.get("content-type"), location: dres.headers.get("location") ? new URL(dres.headers.get("location")).host : null };
    save("artifact-download", { url: "(generated image url)" }, summary.artifactDownload);
  }
}

// --- 6. bad model -> error schema
{
  const request = { model: "grok-nonexistent-model", messages: [{ role: "user", content: "hi" }], max_tokens: 5 };
  const { status, json } = await call("/chat/completions", { method: "POST", body: JSON.stringify(request) });
  save("error-bad-model", request, { status, body: json });
  summary.errorSchema = { status, keys: Object.keys(json) };
}

// --- 7. video (paid, flag-gated). Endpoint shape unknown: try candidates, record everything.
if (process.argv.includes("--video")) {
  const candidates = ["/videos/generations", "/video/generations", "/imagine/videos"];
  const request = { model: "grok-imagine-video-1.5", prompt: "a red apple rotating on a white table", duration: 2 };
  for (const path of candidates) {
    const { status, json } = await call(path, { method: "POST", body: JSON.stringify(request) });
    save(`video-${path.replaceAll("/", "_")}`, { path, ...request }, { status, body: json });
    summary[`video ${path}`] = { status, keys: Object.keys(json) };
    if (status !== 404) break; // found the real endpoint (or a real error) — stop guessing
  }
} else {
  console.log("video probe skipped (pass --video to run, paid)");
}

console.log("\n=== PROBE SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
