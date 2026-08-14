import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requestAuthenticated as defaultRequest } from "./api.mjs";

export const MEDIA_HOSTS = ["imgen.x.ai", "vidgen.x.ai"];
export const DEFAULT_MEDIA_DIR = path.join(os.homedir(), ".grok-companion", "media");
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

export function createMedia({ apiClient = { requestAuthenticated: defaultRequest }, fetchImpl = globalThis.fetch } = {}) {
  async function generateImage({ prompt, sources = [], model = "grok-imagine-image-2.0" }) {
    if (!Array.isArray(sources) || sources.length > 3) throw usage("image generation accepts at most 3 sources");
    const body = { model, prompt, n: 1, ...(sources.length ? { images: sources } : {}) };
    const raw = await apiClient.requestAuthenticated("/images/generations", { method: "POST", body });
    const item = raw?.data?.[0];
    if (!item?.url && !item?.b64_json) throw usage("image generation response has no artifact");
    return { ...(item.url ? { url: item.url } : { b64: item.b64_json }), raw };
  }

  async function createVideoJob({ prompt, seconds, fromImage, model = "grok-imagine-video-1.5" }) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) throw usage("video seconds must be an integer from 1 to 30");
    const body = { model, prompt, duration: seconds, ...(fromImage ? { image: fromImage } : {}) };
    const raw = await apiClient.requestAuthenticated("/videos/generations", { method: "POST", body });
    if (!raw?.request_id) throw usage("video generation response has no request_id");
    return { providerJobId: raw.request_id };
  }

  async function pollVideo(providerJobId) {
    const raw = await apiClient.requestAuthenticated(`/videos/${encodeURIComponent(providerJobId)}`);
    const state = raw?.status === "done" ? "done" : raw?.status === "failed" ? "failed" : "running";
    return { state, progress: raw?.progress ?? null, url: raw?.video?.url ?? null, usageTicks: raw?.usage?.cost_in_usd_ticks ?? null };
  }

  async function downloadArtifact(url, outDir = DEFAULT_MEDIA_DIR, { out, maxBytes = MAX_ARTIFACT_BYTES } = {}) {
    let current = allowed(url);
    for (let redirects = 0; redirects < 4; redirects += 1) {
      const response = await fetchImpl(current, { method: "GET", redirect: "manual", headers: {} });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw usage("artifact redirect has no location");
        current = allowed(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw usage(`artifact download failed with ${response.status}`);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) throw usage("artifact is too large");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw usage("artifact is too large");
      const type = sniff(bytes);
      fs.mkdirSync(outDir, { recursive: true });
      const requested = out ? path.parse(path.basename(out)).name : path.parse(current.pathname).name || "grok-artifact";
      const target = unusedPath(outDir, requested || "grok-artifact", type.extension);
      fs.writeFileSync(target, bytes, { mode: 0o600 });
      return { path: target, mime: type.mime, bytes: bytes.length };
    }
    throw usage("too many artifact redirects");
  }
  return { generateImage, createVideoJob, pollVideo, downloadArtifact };
}

const defaultMedia = createMedia();
export const generateImage = defaultMedia.generateImage;
export const createVideoJob = defaultMedia.createVideoJob;
export const pollVideo = defaultMedia.pollVideo;
export const downloadArtifact = defaultMedia.downloadArtifact;
