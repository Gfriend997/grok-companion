import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMedia, MEDIA_HOSTS } from "../scripts/lib/media.mjs";

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-media-"));
test.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

test("media create request bodies match the captured image and video shapes", async () => {
  const calls = [];
  const media = createMedia({ apiClient: { requestAuthenticated: async (path, init) => { calls.push({ path, body: init.body }); return path.includes("images") ? { data: [{ url: "https://imgen.x.ai/a.jpeg" }] } : { request_id: "job-1" }; } } });
  await media.generateImage({ prompt: "apple", sources: [], model: "grok-imagine-image-2.0" });
  await media.createVideoJob({ prompt: "apple", seconds: 2, model: "grok-imagine-video-1.5" });
  assert.deepEqual(calls, [
    { path: "/images/generations", body: { model: "grok-imagine-image-2.0", prompt: "apple", n: 1 } },
    { path: "/videos/generations", body: { model: "grok-imagine-video-1.5", prompt: "apple", duration: 2 } }
  ]);
});

test("image generation limits sources and maps moderation errors", async () => {
  const media = createMedia({ apiClient: { requestAuthenticated: async () => { const error = new Error("blocked"); error.error_class = "moderation"; throw error; } } });
  await assert.rejects(() => media.generateImage({ prompt: "x", sources: [], model: "m" }), (error) => error.error_class === "moderation");
  await assert.rejects(() => media.generateImage({ prompt: "x", sources: [1, 2, 3, 4], model: "m" }), /at most 3/);
});

test("image edits use the documented JSON endpoint and image objects", async () => {
  const calls = [];
  const media = createMedia({ apiClient: { requestAuthenticated: async (path, init) => { calls.push({ path, body: init.body }); return { data: [{ url: "https://imgen.x.ai/edit.jpg" }] }; } } });
  const source = "data:image/jpeg;base64,/9j/2Q==";
  await media.generateImage({ prompt: "red circle", sources: [source] });
  await media.generateImage({ prompt: "combine", sources: [source, "https://example.com/image.jpg"] });
  assert.deepEqual(calls, [
    { path: "/images/edits", body: { model: "grok-imagine-image-2.0", prompt: "red circle", n: 1, image: { url: source } } },
    { path: "/images/edits", body: { model: "grok-imagine-image-2.0", prompt: "combine", n: 1, images: [{ type: "image_url", url: source }, { type: "image_url", url: "https://example.com/image.jpg" }] } }
  ]);
});

test("image-to-video wraps the encoded source in a URL object", async () => {
  let call;
  const media = createMedia({ apiClient: { requestAuthenticated: async (path, init) => { call = { path, body: init.body }; return { request_id: "video-1" }; } } });
  await media.createVideoJob({ prompt: "animate", seconds: 1, fromImage: "data:image/jpeg;base64,/9j/2Q==" });
  assert.deepEqual(call, { path: "/videos/generations", body: { model: "grok-imagine-video-1.5", prompt: "animate", duration: 1, image: { url: "data:image/jpeg;base64,/9j/2Q==" } } });
});

test("artifact downloads reject unapproved hosts and off-list redirects", async () => {
  const media = createMedia({ fetchImpl: async () => new Response("x") });
  await assert.rejects(() => media.downloadArtifact("https://evil.test/file.jpg", outDir), /not allowlisted/);
  const redirecting = createMedia({ fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.test/file.jpg" } }) });
  await assert.rejects(() => redirecting.downloadArtifact("https://imgen.x.ai/file.jpg", outDir), /not allowlisted/);
});

test("artifact download sends no authorization header, rejects oversize, and avoids collisions", async () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const headersSeen = [];
  const media = createMedia({ fetchImpl: async (_url, init) => { headersSeen.push(init.headers); return new Response(image, { status: 200 }); } });
  const first = await media.downloadArtifact("https://imgen.x.ai/image", outDir);
  const second = await media.downloadArtifact("https://imgen.x.ai/image", outDir);
  assert.equal(headersSeen[0].Authorization, undefined);
  assert.notEqual(first.path, second.path);
  const oversized = createMedia({ fetchImpl: async () => new Response(image, { headers: { "content-length": "999" } }) });
  await assert.rejects(() => oversized.downloadArtifact("https://imgen.x.ai/image", outDir, { maxBytes: 10 }), /too large/);
});

test("pollVideo translates captured done status", async () => {
  const media = createMedia({ apiClient: { requestAuthenticated: async () => ({ status: "done", progress: 100, video: { url: "https://vidgen.x.ai/a.mp4" }, usage: { cost_in_usd_ticks: 5 } }) } });
  assert.deepEqual(await media.pollVideo("job-1"), { state: "done", progress: 100, url: "https://vidgen.x.ai/a.mp4", usageTicks: 5 });
  assert.deepEqual(MEDIA_HOSTS, ["imgen.x.ai", "vidgen.x.ai"]);
});
