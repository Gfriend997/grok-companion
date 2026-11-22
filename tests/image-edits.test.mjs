// Spec 003: image edits and image-input routing, ported from codex-plugin.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMedia } from "../scripts/lib/media.mjs";
import * as models from "../scripts/lib/models.mjs";
import { main, selectModel } from "../scripts/grok-companion.mjs";

const fixture = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "catalog-2026-11-21.json"), "utf8"));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-edits-"));
test.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

const clone = (value) => JSON.parse(JSON.stringify(value));
const catalogFrom = (raw) => ({ kinds: Object.fromEntries(Object.keys(models.KINDS).map((kind) => [kind, { available: true, source: "live", entries: models.normalize(raw[kind], kind) }])) });
// Fixture copy where only the listed ids accept image input.
function imageOnly(kind, ids) {
  const raw = clone(fixture);
  for (const model of raw[kind].models) model.input_modalities = ids.includes(model.id) ? ["text", "image"] : ["text"];
  return raw;
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test("imagine with sources posts to /images/edits in the codex-plugin body shape", async () => {
  const calls = [];
  const media = createMedia({ apiClient: { requestAuthenticated: async (p, init) => { calls.push({ p, body: init.body }); return { data: [{ url: "https://imgen.x.ai/a.png" }] }; } } });
  await media.generateImage({ prompt: "p", sources: [], model: "m" });
  await media.generateImage({ prompt: "p", sources: ["data:image/png;base64,AA=="], model: "m" });
  await media.generateImage({ prompt: "p", sources: ["data:a", "data:b"], model: "m" });
  assert.deepEqual(calls, [
    { p: "/images/generations", body: { model: "m", prompt: "p", n: 1 } },
    { p: "/images/edits", body: { model: "m", prompt: "p", n: 1, image: { url: "data:image/png;base64,AA==" } } },
    { p: "/images/edits", body: { model: "m", prompt: "p", n: 1, images: [{ type: "image_url", url: "data:a" }, { type: "image_url", url: "data:b" }] } }
  ]);
});

test("saveBase64 verifies the signature, never overwrites, and rejects bad input", () => {
  const media = createMedia();
  const b64 = PNG.toString("base64");
  const first = media.saveBase64(b64, { outDir, out: "edit.png" });
  const second = media.saveBase64(b64, { outDir, out: "edit.png" });
  assert.equal(first.mime, "image/png");
  assert.notEqual(first.path, second.path);
  assert.deepEqual(fs.readFileSync(first.path), PNG);
  assert.throws(() => media.saveBase64("not base64!", { outDir }), /invalid base64/);
  assert.throws(() => media.saveBase64(Buffer.from("plain text").toString("base64"), { outDir }), /could not be verified/);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(4)]);
  assert.throws(() => media.saveBase64(mp4.toString("base64"), { outDir }), /must be an image/);
  assert.throws(() => media.saveBase64(b64, { outDir, maxBytes: 4 }), /too large/);
});

test("role routing with image input considers only models that accept images", () => {
  const raw = imageOnly("language", ["grok-4.6"]);
  const catalog = catalogFrom(raw);
  assert.equal(models.resolveRole("strong", catalog).model, "grok-4.7");
  assert.equal(models.resolveRole("strong", catalog, { needsImageInput: true }).model, "grok-4.6");
  assert.equal(models.resolveRole("coding", catalog, { needsImageInput: true }).model, "grok-4.6", "coding alias without image input defers to strong");
  const none = catalogFrom(imageOnly("language", []));
  assert.throws(() => models.resolveRole("fast", none, { needsImageInput: true }), (error) => error.error_class === "capability_unavailable" && /with image input/.test(error.message));
});

test("an explicit model without image input is rejected before any billed request", async () => {
  const catalog = catalogFrom(imageOnly("image", ["grok-imagine-image"]));
  const ctx = { models, env: {}, catalog: async () => catalog };
  await assert.rejects(() => selectModel("image", { model: "grok-imagine-image-2.0" }, ctx, { needsImageInput: true }), (error) => error.error_class === "usage" && /does not accept image input/.test(error.message));
  assert.equal((await selectModel("image", { model: "grok-imagine-image" }, ctx, { needsImageInput: true })).model, "grok-imagine-image");
  assert.equal((await selectModel("image", { model: "grok-imagine-image-2.0" }, ctx)).model, "grok-imagine-image-2.0", "no image input, no filter");
});

function cliDeps({ parts = [], b64 = PNG.toString("base64") } = {}) {
  const lines = [];
  const calls = [];
  const raw = imageOnly("image", ["grok-imagine-image"]);
  const deps = {
    env: { XAI_API_KEY: "hidden-key" },
    home: fs.mkdtempSync(path.join(outDir, "home-")),
    stdout: { write: (line) => lines.push(String(line).trim()) },
    scrub: { preflight: () => ({ ok: true }), scrubDeep: (value) => value },
    attach: { toParts: () => ({ parts, tokenEstimate: 1, totalBytes: 0 }) },
    api: { requestAuthenticated: async (p) => raw[Object.entries(models.KINDS).find(([, value]) => value === p)[0]] },
    media: {
      generateImage: async (request) => { calls.push(request); return { b64 }; },
      saveBase64: (value, options) => { calls.push({ saved: value, options }); return { path: "saved.png", mime: "image/png", bytes: 12 }; },
      downloadArtifact: async () => ({ path: "out.png", mime: "image/png", bytes: 2 })
    }
  };
  return { deps, lines, calls };
}
const imagePart = { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } };

test("imagine saves base64 results, routes sources to an image-input model, and limits sources before routing", async () => {
  const edit = cliDeps({ parts: [imagePart] });
  assert.equal(await main(["imagine", "edit it", "--source", "a.png", "--out", "x.png"], edit.deps), 0);
  assert.equal(edit.calls[0].model, "grok-imagine-image", "only the image-input model qualifies");
  assert.deepEqual(edit.calls[0].sources, ["data:image/png;base64,AA=="]);
  assert.equal(edit.calls[1].options.out, "x.png");
  const output = JSON.parse(edit.lines.at(-1));
  assert.equal(output.path, "saved.png");
  assert.equal(output.b64, undefined, "raw base64 is never printed");

  const many = cliDeps({ parts: [imagePart, imagePart, imagePart, imagePart] });
  assert.equal(await main(["imagine", "x", "--source", "a", "--source", "b", "--source", "c", "--source", "d"], many.deps), 9);
  assert.equal(many.calls.length, 0);
});

test("saveBase64 takes the next free name when a concurrent run claims the same file", () => {
  const media = createMedia();
  const original = fs.writeFileSync;
  let raced = false;
  fs.writeFileSync = (target, ...rest) => {
    if (!raced && String(target).endsWith("race.png")) { raced = true; original(target, "other run"); }
    return original(target, ...rest);
  };
  try {
    const saved = media.saveBase64(PNG.toString("base64"), { outDir, out: "race.png" });
    assert.ok(raced);
    assert.match(saved.path, /race-1\.png$/);
    assert.deepEqual(fs.readFileSync(saved.path), PNG);
  } finally {
    fs.writeFileSync = original;
  }
});

test("video --from-image and text image attachments route to image-input models", async () => {
  const catalog = catalogFrom(imageOnly("video", ["grok-imagine-video"]));
  const ctx = { models, env: {}, catalog: async () => catalog };
  assert.equal((await selectModel("video", {}, ctx, { needsImageInput: true })).model, "grok-imagine-video");
  assert.equal((await selectModel("video", {}, ctx)).model, "grok-imagine-video-1.5");

  const run = cliDeps({ parts: [imagePart] });
  const calls = [];
  const raw = imageOnly("language", ["grok-4.5"]);
  run.deps.api = {
    requestAuthenticated: async (p) => raw[Object.entries(models.KINDS).find(([, value]) => value === p)[0]],
    chat: async (request) => { calls.push(request); return { content: "ok", usage: null }; }
  };
  assert.equal(await main(["ask", "describe", "--file", "shot.png"], run.deps), 0);
  assert.equal(calls[0].model, "grok-4.5", "the only image-input language model is chosen");
});
