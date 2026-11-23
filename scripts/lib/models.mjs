// Live xAI model catalog: fetch, cache and role-based routing.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const KINDS = { language: "/language-models", image: "/image-generation-models", video: "/video-generation-models" };
export const ROLE_KIND = { fast: "language", strong: "language", coding: "language", image: "image", video: "video" };
export const CODING_ALIAS = "grok-build-latest";
// The only model IDs in routing code. Used when the catalog is unavailable (2026-11-21 values).
export const FALLBACK_ROUTES = { fast: "grok-4.3", strong: "grok-4.7", coding: "grok-4.5", image: "grok-imagine-image-2.0", video: "grok-imagine-video-1.5" };
// Listed prices on 2026-11-21, in xAI integer units. Static by design: priceChanged compares against these.
export const PRICE_BASELINES = { fast: 25000, strong: 60000, coding: 60000, image: 600000000, video: null };

const FRESH_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_CATALOG_BYTES = 1_000_000;
export const ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const validId = (value) => typeof value === "string" && ID_PATTERN.test(value);
const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);

function routeError(error_class, message) {
  return Object.assign(new Error(message), { error_class, retryable: false });
}

// Throws on a malformed or empty catalog so it counts as a discovery failure, never a verified empty catalog.
export function normalize(raw, kind) {
  if (!Array.isArray(raw?.models)) throw routeError("network", `malformed ${kind} catalog response`);
  const entries = raw.models.filter((model) => validId(model?.id)).map((model) => {
    const prices = {};
    for (const [key, value] of Object.entries(model)) if (key.endsWith("_price") && Number.isFinite(value)) prices[key] = value;
    return {
      id: model.id,
      kind,
      aliases: strings(model.aliases).filter(validId),
      created: Number.isFinite(model.created) ? model.created : 0,
      inputModalities: strings(model.input_modalities),
      outputModalities: strings(model.output_modalities),
      prices,
      capabilities: { reasoningEffort: strings(model.capabilities?.reasoning_effort) }
    };
  });
  if (!entries.length) throw routeError("network", `empty ${kind} catalog response`);
  return entries;
}

const stringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Cached content is untrusted: require the full normalized shape before use.
function validEntry(entry, kind) {
  return plainObject(entry) && validId(entry.id) && entry.kind === kind && Number.isFinite(entry.created)
    && stringArray(entry.aliases) && entry.aliases.every(validId) && stringArray(entry.inputModalities) && stringArray(entry.outputModalities)
    && plainObject(entry.prices) && Object.values(entry.prices).every(Number.isFinite)
    && plainObject(entry.capabilities) && stringArray(entry.capabilities.reasoningEffort);
}

function validEntries(entries, kind) {
  return Array.isArray(entries) && entries.length > 0 && entries.every((entry) => validEntry(entry, kind));
}

export function keyFingerprint(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 12);
}

function readCache(file, fingerprint) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data?.version !== 1 || data.fingerprint !== fingerprint || !plainObject(data.kinds)) return null;
    const kinds = {};
    const failedAt = {};
    for (const kind of Object.keys(KINDS)) {
      const state = data.kinds[kind];
      if (plainObject(state) && Number.isFinite(state.fetchedAt) && validEntries(state.entries, kind)) kinds[kind] = { fetchedAt: state.fetchedAt, entries: state.entries };
      if (plainObject(data.failedAt) && Number.isFinite(data.failedAt[kind])) failedAt[kind] = data.failedAt[kind];
    }
    return { version: 1, fingerprint, kinds, failedAt };
  } catch {
    return null;
  }
}

function writeCache(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch { /* A cache write failure must never block a command. */ }
}

// xAI answers an invalid key with HTTP 400 "Incorrect API key provided", which api.mjs classes as usage.
// Discovery treats it as auth so setup exits 2; other commands keep the api.mjs class.
function discoveryErrorClass(reason) {
  if (reason?.error_class === "usage" && /incorrect api key|invalid api key/i.test(String(reason?.message ?? ""))) return "auth";
  return reason?.error_class ?? "network";
}

// Options: fresh bypasses cache and the negative window (setup); refetch bypasses only the cache (unknown --model).
export async function loadCatalog({ request, env = process.env, home = os.homedir(), now = Date.now, fresh = false, refetch = false } = {}) {
  const kinds = Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, { available: false, source: "none", entries: [] }]));
  if (!env.XAI_API_KEY) return { kinds };
  const file = path.join(home, ".grok-companion", "models.json");
  const fingerprint = keyFingerprint(env.XAI_API_KEY);
  const cache = readCache(file, fingerprint) ?? { version: 1, fingerprint, kinds: {}, failedAt: {} };
  const time = now();
  const toFetch = [];
  // A timestamp in the future is untrusted: treat it as expired, never as fresh forever.
  const within = (stamp, limit) => Number.isFinite(stamp) && time - stamp >= 0 && time - stamp <= limit;
  const useStale = (kind, error) => {
    const cached = cache.kinds[kind];
    if (cached && within(cached.fetchedAt, STALE_MS)) kinds[kind] = { available: true, source: "cache-stale", entries: cached.entries, ...(error ? { error } : {}) };
    else if (error) kinds[kind].error = error;
  };
  for (const kind of Object.keys(KINDS)) {
    const cached = cache.kinds[kind];
    if (!fresh && !refetch && cached && within(cached.fetchedAt, FRESH_MS)) kinds[kind] = { available: true, source: "cache", entries: cached.entries };
    else if (!fresh && within(cache.failedAt[kind], NEGATIVE_MS)) useStale(kind);
    else toFetch.push(kind);
  }
  if (!toFetch.length) return { kinds };
  const results = await Promise.allSettled(toFetch.map(async (kind) => {
    if (typeof request !== "function") throw new Error("no request function");
    return normalize(await request(KINDS[kind], { timeoutMs: FETCH_TIMEOUT_MS, redirect: "error", maxBytes: MAX_CATALOG_BYTES }), kind);
  }));
  toFetch.forEach((kind, index) => {
    const result = results[index];
    if (result.status === "fulfilled") {
      kinds[kind] = { available: true, source: "live", entries: result.value };
      cache.kinds[kind] = { fetchedAt: time, entries: result.value };
      delete cache.failedAt[kind];
    } else {
      cache.failedAt[kind] = time;
      useStale(kind, discoveryErrorClass(result.reason));
    }
  });
  writeCache(file, cache);
  return { kinds };
}

const byNewest = (a, b) => b.created - a.created || b.id.localeCompare(a.id, "en", { numeric: true });

function priceOf(entry, role) {
  const value = ROLE_KIND[role] === "image" ? entry?.prices?.image_price : entry?.prices?.completion_text_token_price;
  return Number.isFinite(value) ? value : null;
}

export function priceChangedFor(entry, role) {
  const baseline = PRICE_BASELINES[role];
  const price = priceOf(entry, role);
  return baseline === null || baseline === undefined || price === null ? null : price !== baseline;
}

function lookup(idOrAlias, entries) {
  return entries.find((entry) => entry.id === idOrAlias || entry.aliases.includes(idOrAlias)) ?? null;
}

export function findModel(idOrAlias, kind, catalog) {
  if (!catalog.kinds[kind]?.available) return { unverified: true };
  const entry = lookup(idOrAlias, catalog.kinds[kind].entries);
  if (entry) return { entry };
  for (const [other, state] of Object.entries(catalog.kinds)) if (other !== kind && state.available && lookup(idOrAlias, state.entries)) return { error: "wrong_kind" };
  return { error: "unknown" };
}

function eligible(entry, kind) {
  if (kind !== "language") return !entry.id.endsWith("-lite");
  return entry.outputModalities.includes("text") && entry.capabilities.reasoningEffort.length > 0 && Number.isFinite(entry.prices.completion_text_token_price);
}

export const acceptsImage = (entry) => entry.inputModalities.includes("image");

// Light check, for the coding alias target and the built-in fallback: right kind (the lookup is per kind), text output for language, image filter.
function passesLightCheck(entry, kind, needsImageInput) {
  if (!entry) return false;
  if (kind === "language" && !entry.outputModalities.includes("text")) return false;
  return !needsImageInput || acceptsImage(entry);
}

const route = (entry, role, source) => ({ model: entry.id, routeSource: source, modelVerified: true, priceChanged: priceChangedFor(entry, role) });

// Pure: reads no env. Returns a route, or { defer: "strong" } for coding without a usable alias (selectModel resolves strong).
export function resolveRole(role, catalog, { needsImageInput = false } = {}) {
  const kind = ROLE_KIND[role];
  if (!kind) throw routeError("usage", `unknown routing role: ${role}`);
  const state = catalog.kinds[kind];
  if (!state?.available) {
    const fallback = { model: FALLBACK_ROUTES[role], routeSource: "fallback", modelVerified: false, priceChanged: null };
    return role === "coding" ? { ...fallback, roleFallback: null } : fallback;
  }
  if (role === "coding") {
    const target = lookup(CODING_ALIAS, state.entries);
    return passesLightCheck(target, kind, needsImageInput) ? { ...route(target, role, state.source), roleFallback: null } : { defer: "strong" };
  }
  const pool = state.entries.filter((entry) => eligible(entry, kind) && (!needsImageInput || acceptsImage(entry))).sort(byNewest);
  let chosen = null;
  if (pool.length && (role === "fast" || role === "strong")) {
    // fast: newest in the cheapest tier; strong: newest in the highest price tier.
    const prices = pool.map((entry) => entry.prices.completion_text_token_price);
    const tier = role === "fast" ? Math.min(...prices) : Math.max(...prices);
    chosen = pool.find((entry) => entry.prices.completion_text_token_price === tier);
  } else if (pool.length) {
    chosen = pool[0];
  }
  if (!chosen) {
    const fallback = lookup(FALLBACK_ROUTES[role], state.entries);
    if (passesLightCheck(fallback, kind, needsImageInput)) chosen = fallback;
  }
  if (!chosen) throw routeError("capability_unavailable", `no listed ${kind} model fits the ${role} role${needsImageInput ? " with image input" : ""}; pass --model with a listed model`);
  return route(chosen, role, state.source);
}
