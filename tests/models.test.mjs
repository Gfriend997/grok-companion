import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, resolveRole, findModel, normalize, priceChangedFor, keyFingerprint, FALLBACK_ROUTES, KINDS } from "../scripts/lib/models.mjs";

const fixture = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "catalog-2026-11-21.json"), "utf8"));
const env = { XAI_API_KEY: "test-key-not-for-logs" };
const tempHomes = [];
const tempHome = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-models-")); tempHomes.push(dir); return dir; };
test.after(() => { for (const dir of tempHomes) fs.rmSync(dir, { recursive: true, force: true }); });

const clone = (value) => JSON.parse(JSON.stringify(value));
const pathKind = Object.fromEntries(Object.entries(KINDS).map(([kind, p]) => [p, kind]));
function requester(raw = fixture, { fail = [] } = {}) {
  const calls = [];
  const request = async (p, init) => { calls.push({ p, init }); const kind = pathKind[p]; if (fail.includes(kind)) throw Object.assign(new Error("down"), { error_class: "network" }); return raw[kind]; };
  return { request, calls };
}
const catalogFrom = (raw = fixture) => ({ kinds: Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, { available: true, source: "live", entries: normalize(raw[kind], kind) }])) });
const withLanguage = (extra, raw = clone(fixture)) => { raw.language.models.push(extra); return raw; };
const flagship = (id, created, price, inputs = ["text", "image"]) => ({ id, created, input_modalities: inputs, output_modalities: ["text"], completion_text_token_price: price, capabilities: { reasoning_effort: ["low", "high"] }, aliases: [] });

test("2026-11-21 catalog resolves every role to the recorded defaults", () => {
  const catalog = catalogFrom();
  const resolved = Object.fromEntries(Object.keys(FALLBACK_ROUTES).map((role) => [role, resolveRole(role, catalog).model]));
  assert.deepEqual(resolved, FALLBACK_ROUTES);
  assert.deepEqual(resolveRole("coding", catalog), { model: "grok-4.5", routeSource: "live", modelVerified: true, priceChanged: false, roleFallback: null });
  assert.equal(resolveRole("video", catalog).priceChanged, null);
});

test("strong takes the newest model in the highest price tier and flags a price change", () => {
  const same = resolveRole("strong", catalogFrom(withLanguage(flagship("grok-4.8", 1799999999, 60000))));
  assert.equal(same.model, "grok-4.8");
  assert.equal(same.priceChanged, false);
  const pricier = resolveRole("strong", catalogFrom(withLanguage(flagship("grok-5", 1799999999, 150000))));
  assert.equal(pricier.model, "grok-5");
  assert.equal(pricier.priceChanged, true);
  const cheaper = resolveRole("strong", catalogFrom(withLanguage(flagship("grok-4.8-cheap", 1799999999, 30000))));
  assert.equal(cheaper.model, "grok-4.7", "a newer cheaper model never becomes strong");
  assert.equal(cheaper.priceChanged, false);
});

test("price comes before age: an older pricier model beats a newer cheaper one", () => {
  const raw = withLanguage(flagship("grok-old-max", 1700000000, 90000));
  raw.language.models.push(flagship("grok-new-mid", 1899999999, 60000));
  assert.equal(resolveRole("strong", catalogFrom(raw)).model, "grok-old-max");
  const tie = withLanguage(flagship("grok-9", 1788307200, 30000));
  assert.equal(resolveRole("strong", catalogFrom(tie)).model, "grok-4.7", "timestamp tie with unequal prices: price decides");
});

test("image filter runs before the tier for fast and strong", () => {
  const raw = withLanguage(flagship("grok-4.4-textonly", 1799999999, 10000, ["text"]));
  raw.language.models.push(flagship("grok-6-textonly", 1799999999, 200000, ["text"]));
  const catalog = catalogFrom(raw);
  assert.equal(resolveRole("fast", catalog).model, "grok-4.4-textonly");
  assert.equal(resolveRole("fast", catalog, { needsImageInput: true }).model, "grok-4.3");
  assert.equal(resolveRole("strong", catalog).model, "grok-6-textonly");
  assert.equal(resolveRole("strong", catalog, { needsImageInput: true }).model, "grok-4.7", "strong drops a tier for image input");
});

test("R17 table: on the 2026-11-21 catalog the 0.1.5 rule and the new rule pick the same five models", () => {
  const catalog = catalogFrom();
  const table = { fast: "grok-4.3", strong: "grok-4.7", coding: "grok-4.5", image: "grok-imagine-image-2.0", video: "grok-imagine-video-1.5" };
  // The 0.1.5 strong rule: the newest eligible language model at any price.
  const eligible = catalog.kinds.language.entries.filter((entry) => entry.outputModalities.includes("text") && entry.capabilities.reasoningEffort.length && Number.isFinite(entry.prices.completion_text_token_price));
  const oldStrong = (needsImage) => eligible.filter((entry) => !needsImage || entry.inputModalities.includes("image")).sort((a, b) => b.created - a.created || b.id.localeCompare(a.id, "en", { numeric: true }))[0].id;
  for (const needsImageInput of [false, true]) {
    assert.deepEqual(Object.fromEntries(Object.keys(table).map((role) => [role, resolveRole(role, catalog, { needsImageInput }).model])), table, `image input ${needsImageInput}`);
    assert.equal(oldStrong(needsImageInput), table.strong);
  }
  assert.equal(resolveRole("coding", catalog).roleFallback, null);
  assert.deepEqual([resolveRole("strong", catalog), resolveRole("coding", catalog)].map((route) => route.priceChanged), [false, false]);
});
test("fast stays in the cheapest tier and takes the newest model in it", () => {
  assert.equal(resolveRole("fast", catalogFrom(withLanguage(flagship("grok-4.8", 1799999999, 60000)))).model, "grok-4.3");
  assert.equal(resolveRole("fast", catalogFrom(withLanguage(flagship("grok-4.4-mini", 1799999999, 25000)))).model, "grok-4.4-mini");
});

const noAlias = (raw) => { for (const model of raw.language.models) model.aliases = (model.aliases ?? []).filter((alias) => alias !== "grok-build-latest"); return raw; };

test("coding defers to strong when the build alias disappears or fails the light check", () => {
  assert.deepEqual(resolveRole("coding", catalogFrom(noAlias(clone(fixture)))), { defer: "strong" });
  const textOnly = clone(fixture);
  textOnly.language.models.find((model) => model.id === "grok-4.5").input_modalities = ["text"];
  assert.equal(resolveRole("coding", catalogFrom(textOnly)).model, "grok-4.5");
  assert.deepEqual(resolveRole("coding", catalogFrom(textOnly), { needsImageInput: true }), { defer: "strong" });
  const noText = clone(fixture);
  noText.language.models.find((model) => model.id === "grok-4.5").output_modalities = ["image"];
  assert.deepEqual(resolveRole("coding", catalogFrom(noText)), { defer: "strong" });
});
test("image and video take the newest non-lite model; lite stays selectable", () => {
  const raw = clone(fixture);
  raw.image.models.push({ id: "grok-imagine-image-3.0", created: 1799999999, input_modalities: ["text"], output_modalities: ["image"], image_price: 900000000 });
  raw.image.models.push({ id: "grok-imagine-image-3.0-lite", created: 1800000000, input_modalities: ["text"], output_modalities: ["image"] });
  const catalog = catalogFrom(raw);
  assert.deepEqual(resolveRole("image", catalog), { model: "grok-imagine-image-3.0", routeSource: "live", modelVerified: true, priceChanged: true });
  assert.equal(resolveRole("video", catalog).model, "grok-imagine-video-1.5");
  assert.ok(findModel("grok-imagine-video-1.5-lite", "video", catalog).entry);
});

test("ties break by numeric-aware id and unpriced language models are skipped", () => {
  const raw = withLanguage(flagship("grok-4.9", 1799999999, 60000));
  raw.language.models.push(flagship("grok-4.10", 1799999999, 60000));
  raw.language.models.push({ ...flagship("grok-9", 1899999999, 60000), completion_text_token_price: undefined });
  assert.equal(resolveRole("strong", catalogFrom(raw)).model, "grok-4.10");
});

test("no eligible model uses the listed fallback under the light check, else asks for --model", () => {
  const raw = clone(fixture);
  for (const model of raw.language.models) delete model.capabilities;
  assert.deepEqual(resolveRole("strong", catalogFrom(raw)), { model: "grok-4.7", routeSource: "live", modelVerified: true, priceChanged: false });
  const textOnly = clone(raw);
  for (const model of textOnly.language.models) model.input_modalities = ["text"];
  assert.throws(() => resolveRole("strong", catalogFrom(textOnly), { needsImageInput: true }), (error) => error.error_class === "capability_unavailable");
  raw.language.models = [{ id: "grok-x", created: 1, output_modalities: ["text"], aliases: [] }];
  assert.throws(() => resolveRole("strong", catalogFrom(raw)), (error) => error.error_class === "capability_unavailable");
});

test("an unpriced listed fallback is used under the light check; a non-text one is not", () => {
  const raw = clone(fixture);
  raw.language.models = [{ id: "grok-4.7", created: 1788307200, output_modalities: ["text"], aliases: [] }];
  assert.equal(resolveRole("strong", catalogFrom(raw)).model, "grok-4.7");
  assert.deepEqual(resolveRole("coding", catalogFrom(raw)), { defer: "strong" });
  raw.language.models[0].output_modalities = ["image"];
  assert.throws(() => resolveRole("strong", catalogFrom(raw)), (error) => error.error_class === "capability_unavailable");
});
test("unavailable kind falls back unverified; offline coding is grok-4.5 with roleFallback null", () => {
  const catalog = { kinds: { language: { available: false, source: "none", entries: [] }, image: { available: false, source: "none", entries: [] }, video: { available: false, source: "none", entries: [] } } };
  assert.deepEqual(resolveRole("fast", catalog), { model: "grok-4.3", routeSource: "fallback", modelVerified: false, priceChanged: null });
  assert.deepEqual(resolveRole("coding", catalog, { needsImageInput: true }), { model: "grok-4.5", routeSource: "fallback", modelVerified: false, priceChanged: null, roleFallback: null });
});
test("findModel accepts ids and aliases, and spots unknown and wrong-kind models", () => {
  const catalog = catalogFrom();
  assert.equal(findModel("grok-4.20-multi-agent", "language", catalog).entry.id, "grok-4.20-multi-agent-0309");
  assert.deepEqual(findModel("grok-nope", "language", catalog), { error: "unknown" });
  assert.deepEqual(findModel("grok-imagine-image-2.0", "language", catalog), { error: "wrong_kind" });
  assert.equal(priceChangedFor(undefined, "fast"), null);
});

test("normalize drops invalid ids and keeps only listed fields", () => {
  const entries = normalize({ models: [{ id: "../evil" }, { id: "Grok" }, { id: "grok-ok", aliases: ["fine", "BAD alias"], extra: "x", prompt_text_token_price: 1 }] }, "language");
  assert.deepEqual(entries, [{ id: "grok-ok", kind: "language", aliases: ["fine"], created: 0, inputModalities: [], outputModalities: [], prices: { prompt_text_token_price: 1 }, capabilities: { reasoningEffort: [] } }]);
});

test("loadCatalog fetches with bounds, caches by key fingerprint, and reuses a warm cache", async () => {
  const home = tempHome();
  let time = 1_000_000_000_000;
  const first = requester();
  const live = await loadCatalog({ request: first.request, env, home, now: () => time });
  assert.equal(first.calls.length, 3);
  assert.deepEqual(first.calls[0].init, { timeoutMs: 5000, redirect: "error", maxBytes: 1_000_000 });
  assert.equal(live.kinds.language.source, "live");
  const file = path.join(home, ".grok-companion", "models.json");
  const stored = fs.readFileSync(file, "utf8");
  assert.ok(!stored.includes(env.XAI_API_KEY));
  assert.equal(JSON.parse(stored).fingerprint, keyFingerprint(env.XAI_API_KEY));
  assert.equal(JSON.parse(stored).fingerprint.length, 12);
  time += 60_000;
  const warm = requester();
  const cached = await loadCatalog({ request: warm.request, env, home, now: () => time });
  assert.equal(warm.calls.length, 0);
  assert.equal(cached.kinds.image.source, "cache");
  const other = requester();
  await loadCatalog({ request: other.request, env: { XAI_API_KEY: "different-key" }, home, now: () => time });
  assert.equal(other.calls.length, 3, "a different key ignores the cache");
});

test("expired cache refetches; failure uses stale cache up to 7 days, then nothing", async () => {
  const home = tempHome();
  let time = 1_000_000_000_000;
  await loadCatalog({ request: requester().request, env, home, now: () => time });
  time += 2 * 24 * 60 * 60 * 1000;
  const down = requester(fixture, { fail: ["language"] });
  const stale = await loadCatalog({ request: down.request, env, home, now: () => time });
  assert.equal(stale.kinds.language.source, "cache-stale");
  assert.equal(stale.kinds.image.source, "live");
  const again = requester();
  const negative = await loadCatalog({ request: again.request, env, home, now: () => time + 60_000 });
  assert.equal(again.calls.length, 0, "failure is remembered for 5 minutes");
  assert.equal(negative.kinds.language.source, "cache-stale");
  const fresh = requester();
  assert.equal((await loadCatalog({ request: fresh.request, env, home, now: () => time + 60_000, fresh: true })).kinds.language.source, "live");
  assert.equal(fresh.calls.length, 3, "setup bypasses cache and negative window");
  const old = tempHome();
  await loadCatalog({ request: requester().request, env, home: old, now: () => time });
  const gone = await loadCatalog({ request: requester(fixture, { fail: ["video"] }).request, env, home: old, now: () => time + 8 * 24 * 60 * 60 * 1000 });
  assert.equal(gone.kinds.video.available, false);
});

test("loadCatalog without a key or request function never touches the network and tolerates a bad cache", async () => {
  const home = tempHome();
  const none = requester();
  const keyless = await loadCatalog({ request: none.request, env: {}, home });
  assert.equal(none.calls.length, 0);
  assert.equal(keyless.kinds.language.available, false);
  fs.mkdirSync(path.join(home, ".grok-companion"), { recursive: true });
  fs.writeFileSync(path.join(home, ".grok-companion", "models.json"), "{not json");
  const missing = await loadCatalog({ env, home });
  assert.equal(missing.kinds.language.available, false);
  const tampered = JSON.parse(fs.readFileSync(path.join(home, ".grok-companion", "models.json"), "utf8"));
  tampered.failedAt = {};
  tampered.kinds.language = { fetchedAt: Date.now(), entries: [{ id: "../../evil", kind: "language", aliases: [] }] };
  fs.writeFileSync(path.join(home, ".grok-companion", "models.json"), JSON.stringify(tampered));
  const fetched = requester();
  const result = await loadCatalog({ request: fetched.request, env, home });
  assert.equal(result.kinds.language.source, "live", "invalid cached ids are ignored");
});

test("a cache write failure does not block loading", async () => {
  const home = tempHome();
  fs.writeFileSync(path.join(home, ".grok-companion"), "a file where the cache folder should be");
  const result = await loadCatalog({ request: requester().request, env, home });
  assert.equal(result.kinds.language.source, "live");
});

test("an empty or malformed 200 catalog is a discovery failure and never replaces a usable cache", async () => {
  const home = tempHome();
  let time = 1_000_000_000_000;
  await loadCatalog({ request: requester().request, env, home, now: () => time });
  time += 25 * 60 * 60 * 1000;
  const broken = { language: {}, image: { models: [] }, video: { models: null } };
  const result = await loadCatalog({ request: requester(broken).request, env, home, now: () => time });
  for (const kind of ["language", "image", "video"]) assert.equal(result.kinds[kind].source, "cache-stale", kind);
  assert.equal(resolveRole("strong", result).model, "grok-4.7");
  const cold = await loadCatalog({ request: requester(broken).request, env, home: tempHome() });
  assert.equal(cold.kinds.language.available, false);
  assert.equal(resolveRole("fast", cold).routeSource, "fallback");
  assert.throws(() => normalize({}, "language"), (error) => error.error_class === "network");
});

test("cache entries with missing fields, future times or a bad failedAt are ignored", async () => {
  const home = tempHome();
  const time = 1_000_000_000_000;
  await loadCatalog({ request: requester().request, env, home, now: () => time });
  const file = path.join(home, ".grok-companion", "models.json");
  const good = JSON.parse(fs.readFileSync(file, "utf8"));
  const write = (mutate) => { const copy = clone(good); mutate(copy); fs.writeFileSync(file, JSON.stringify(copy)); };
  write((c) => { delete c.kinds.language.entries[0].capabilities; });
  let fetched = requester();
  assert.equal((await loadCatalog({ request: fetched.request, env, home, now: () => time })).kinds.language.source, "live", "missing capabilities");
  write((c) => { c.kinds.language.entries[0].prices = { completion_text_token_price: "free" }; });
  assert.equal((await loadCatalog({ request: requester().request, env, home, now: () => time })).kinds.language.source, "live", "non-numeric price");
  write((c) => { c.kinds.language.fetchedAt = time + 365 * 24 * 60 * 60 * 1000; });
  assert.equal((await loadCatalog({ request: requester().request, env, home, now: () => time })).kinds.language.source, "live", "future fetchedAt");
  write((c) => { c.kinds.language.fetchedAt = 0; c.failedAt = { language: time + 365 * 24 * 60 * 60 * 1000 }; });
  fetched = requester();
  assert.equal((await loadCatalog({ request: fetched.request, env, home, now: () => time })).kinds.language.source, "live", "future failedAt");
  write((c) => { c.kinds.language.fetchedAt = 0; c.failedAt = "broken"; });
  assert.equal((await loadCatalog({ request: requester().request, env, home, now: () => time })).kinds.language.source, "live", "bad failedAt");
});

test("the alias target is exempt from the price and reasoning_effort rules", () => {
  const raw = clone(fixture);
  const target = raw.language.models.find((model) => model.id === "grok-4.5");
  delete target.capabilities;
  delete target.completion_text_token_price;
  const route = resolveRole("coding", catalogFrom(raw));
  assert.equal(route.model, "grok-4.5");
  assert.equal(route.priceChanged, null);
  assert.equal(route.roleFallback, null);
});
test("catalog fetch failures keep their error class", async () => {
  const denied = async () => { throw Object.assign(new Error("denied"), { error_class: "auth" }); };
  const result = await loadCatalog({ request: denied, env, home: tempHome() });
  assert.equal(result.kinds.language.error, "auth");
  assert.equal(result.kinds.language.available, false);
});

test("a 400 'Incorrect API key' catalog response counts as auth; other usage failures do not", async () => {
  const badKey = async () => { throw Object.assign(new Error("Incorrect API key provided. You can obtain an API key from https://console.x.ai."), { error_class: "usage" }); };
  const result = await loadCatalog({ request: badKey, env, home: tempHome() });
  for (const kind of Object.keys(KINDS)) assert.equal(result.kinds[kind].error, "auth", kind);
  const other = async () => { throw Object.assign(new Error("bad request"), { error_class: "usage" }); };
  assert.equal((await loadCatalog({ request: other, env, home: tempHome() })).kinds.language.error, "usage");
});
