import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requestAuthenticated as defaultRequest } from "./api.mjs";

export const MEDIA_HOSTS = ["imgen.x.ai", "vidgen.x.ai"];
export const DEFAULT_MEDIA_DIR = path.join(os.homedir(), ".codex-grok-companion", "media");
const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024;

function usage(message) {
  const error = new Error(message);
  error.error_class = "usage";
  return error;
}

function allowed(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw usage("artifact URL is invalid"); }
  if (parsed.protocol !== "https:" || !MEDIA_HOSTS.includes(parsed.hostname)) throw usage("artifact host is not allowlisted");
  return parsed;
}

function sniff(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: "image/jpeg", extension: ".jpg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", extension: ".png" };
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return { mime: "video/mp4", extension: ".mp4" };
  throw usage("artifact MIME could not be verified from bytes");
}

function unusedPath(dir, stem, extension) {
  let index = 0;
  let candidate;
  do { candidate = path.join(dir, `${stem}${index ? `-${index}` : ""}${extension}`); index += 1; } while (fs.existsSync(candidate));
  return candidate;
}

function saveArtifact(bytes, outDir, out, stem = "grok-artifact") {
  const type = sniff(bytes);
  if (out) outDir = path.dirname(path.resolve(out));
  fs.mkdirSync(outDir, { recursive: true });
  const requested = out ? path.parse(path.basename(out)).name : stem;
  for (let attempt = 0; attempt < 100; attempt++) {
    const target = unusedPath(outDir, requested || "grok-artifact", type.extension);
    try {
      fs.writeFileSync(target, bytes, { mode: 0o600, flag: "wx" });
      return { path: target, mime: type.mime, bytes: bytes.length };
    } catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  throw usage("artifact filename is busy");
}

export function createMedia({ apiClient = { requestAuthenticated: defaultRequest }, fetchImpl = globalThis.fetch, signal } = {}) {
  function saveBase64(value, { out, outDir = DEFAULT_MEDIA_DIR, maxBytes = MAX_ARTIFACT_BYTES } = {}) {
    if (typeof value !== "string") throw usage("invalid base64 image");
    const text = value.replace(/\s/g, "");
    if (text.length > Math.ceil(maxBytes / 3) * 4) throw usage("artifact is too large");
    if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw usage("invalid base64 image");
    const bytes = Buffer.from(text, "base64");
    if (bytes.length > maxBytes) throw usage("artifact is too large");
    if (sniff(bytes).mime === "video/mp4") throw usage("base64 artifact must be an image");
    return saveArtifact(bytes, outDir, out);
  }
  async function generateImage({ prompt, sources = [], model = "grok-imagine-image-2.0" }) {
    if (!Array.isArray(sources) || sources.length > 3) throw usage("image generation accepts at most 3 sources");
    const input = sources.length === 1 ? { image: { url: sources[0] } } : sources.length ? { images: sources.map(url => ({ type: "image_url", url })) } : {};
    const body = { model, prompt, n: 1, ...input };
    const raw = await apiClient.requestAuthenticated(sources.length ? "/images/edits" : "/images/generations", { method: "POST", body });
    const item = raw?.data?.[0];
    if (!item?.url && !item?.b64_json) throw usage("image generation response has no artifact");
    return { ...(item.url ? { url: item.url } : { b64: item.b64_json }), raw };
  }

  async function createVideoJob({ prompt, seconds, fromImage, model = "grok-imagine-video-1.5" }) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) throw usage("video seconds must be an integer from 1 to 30");
    const body = { model, prompt, duration: seconds, ...(fromImage ? { image: { url: fromImage } } : {}) };
    const raw = await apiClient.requestAuthenticated("/videos/generations", { method: "POST", body });
    if (!raw?.request_id) throw usage("video generation response has no request_id");
    return { providerJobId: raw.request_id };
  }

  async function pollVideo(providerJobId) {
    const raw = await apiClient.requestAuthenticated(`/videos/${encodeURIComponent(providerJobId)}`);
    const state = raw?.status === "done" ? "done" : raw?.status === "failed" ? "failed" : "running";
    return { state, progress: raw?.progress ?? null, url: raw?.video?.url ?? null, usageTicks: raw?.usage?.cost_in_usd_ticks ?? null };
  }

  async function downloadArtifact(url, outDir = DEFAULT_MEDIA_DIR, { out, maxBytes = MAX_ARTIFACT_BYTES, timeoutMs = 300_000 } = {}) {
    let current = allowed(url);
    if (signal?.aborted) throw usage("artifact download canceled");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
    for (let redirects = 0; redirects < 4; redirects += 1) {
      const response = await fetchImpl(current, { method: "GET", redirect: "manual", headers: {}, signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw usage("artifact redirect has no location");
        current = allowed(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw usage(`artifact download failed with ${response.status}`);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) throw usage("artifact is too large");
      if (!response.body) throw usage("artifact has no response body");
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) throw usage("artifact is too large");
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks, total);
      return saveArtifact(bytes, outDir, out, path.parse(current.pathname).name || "grok-artifact");
    }
    throw usage("too many artifact redirects");
    } catch (error) {
      if (controller.signal.aborted) throw usage(signal?.aborted ? "artifact download canceled" : "artifact download timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  return { generateImage, createVideoJob, pollVideo, downloadArtifact, saveBase64 };
}

const defaultMedia = createMedia();
export const generateImage = defaultMedia.generateImage;
export const createVideoJob = defaultMedia.createVideoJob;
export const pollVideo = defaultMedia.pollVideo;
export const downloadArtifact = defaultMedia.downloadArtifact;
export const saveBase64 = defaultMedia.saveBase64;
