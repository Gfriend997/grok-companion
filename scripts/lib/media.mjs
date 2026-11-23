import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requestAuthenticated as defaultRequest } from "./api.mjs";
import { preflight, scrubDeep } from "./scrub.mjs";

export const MEDIA_HOSTS = ["imgen.x.ai", "vidgen.x.ai"];
export const DEFAULT_MEDIA_DIR = path.join(os.homedir(), ".grok-companion", "media");
export const DEFAULT_TRANSCRIBE_MODEL = "grok-voice-transcribe-2.0";
const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024;
const MAX_AUDIO_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_SPEECH_BYTES = 50 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const BILLED = "; the request may have been billed";

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

// Checked before a billed request so a bad name or directory cannot lose a paid artifact.
function outputStem(out, stem) {
  const name = out ? path.parse(path.basename(String(out))).name : stem;
  if (!name) return stem;
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) || name.length > 200) throw usage("--out is not a valid file name");
  return name;
}

function prepareOut(out, outDir, stem) {
  const name = outputStem(out, stem);
  try { fs.mkdirSync(outDir, { recursive: true }); } catch { throw usage("media directory cannot be created"); }
  return name;
}

// The artifact is already billed: on a name collision with a concurrent run, take the next free name instead of failing.
function saveBytes(bytes, type, { out, outDir, stem }) {
  const requested = prepareOut(out, outDir, stem);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const target = unusedPath(outDir, requested, type.extension);
    try {
      fs.writeFileSync(target, bytes, { mode: 0o600, flag: "wx" });
      return { path: target, mime: type.mime, bytes: bytes.length };
    } catch (error) {
      if (error?.code !== "EEXIST") throw usage(`artifact was billed but could not be saved (${error?.code ?? "write failed"})`);
    }
  }
  throw usage("artifact was billed but no free file name was found");
}

// An optional ID3v2 tag then one complete MPEG Layer III frame, or a PCM WAV with consistent chunk sizes.
function audioType(bytes) {
  let offset = 0;
  if (bytes.length >= 10 && bytes.toString("ascii", 0, 3) === "ID3") {
    if (![2, 3, 4].includes(bytes[3]) || bytes.subarray(6, 10).some((value) => value > 127)) throw usage("invalid MP3 audio tag");
    offset = 10 + bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9];
    if (bytes[3] === 4 && (bytes[5] & 16)) offset += 10;
  }
  if (bytes.length >= offset + 4) {
    const header = bytes.readUInt32BE(offset);
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const bitrateIndex = (header >>> 12) & 15;
    const sampleIndex = (header >>> 10) & 3;
    if ((header >>> 21) === 2047 && version !== 1 && layer === 1 && bitrateIndex > 0 && bitrateIndex < 15 && sampleIndex < 3) {
      const rates = version === 3 ? [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
      const sampleRate = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
      const frameBytes = Math.floor((version === 3 ? 144000 : 72000) * rates[bitrateIndex - 1] / sampleRate) + ((header >>> 9) & 1);
      if (bytes.length >= offset + frameBytes) return { mime: "audio/mpeg", extension: ".mp3" };
    }
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") {
    const end = bytes.readUInt32LE(4) + 8;
    let format;
    let dataBytes = 0;
    if (end !== bytes.length) throw usage("invalid WAV audio size");
    let index = 12;
    while (index + 8 <= end) {
      const name = bytes.toString("ascii", index, index + 4);
      const size = bytes.readUInt32LE(index + 4);
      const start = index + 8;
      if (size > end - start) throw usage("invalid WAV audio chunk");
      if (name === "fmt ") {
        if (size < 16) throw usage("invalid WAV audio format");
        format = { codec: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), rate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8), align: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
      }
      if (name === "data") dataBytes += size;
      index = start + size + (size & 1);
      if (index > end) throw usage("invalid WAV audio padding");
    }
    if (index !== end) throw usage("invalid WAV audio chunk boundary");
    if (format?.codec === 1 && [1, 2].includes(format.channels) && [8, 16, 24, 32].includes(format.bits) && format.rate >= 8000 && format.rate <= 192000
      && format.align === format.channels * format.bits / 8 && format.byteRate === format.rate * format.align && dataBytes > 0 && dataBytes % format.align === 0) return { mime: "audio/wav", extension: ".wav" };
    throw usage("WAV audio must contain supported PCM format and data");
  }
  throw usage("audio must be a verified MP3 or PCM WAV file");
}

function checkPath(file) {
  const check = preflight("", { sourcePath: file });
  if (!check.ok) throw usage(check.reason);
}

// One bounded read through one descriptor; a change to the file or its real path between checks fails.
function readAudio(file) {
  if (typeof file !== "string" || !file) throw usage("audio file path is required");
  const resolved = path.resolve(file);
  checkPath(file);
  checkPath(resolved);
  let real;
  try { real = fs.realpathSync.native(resolved); } catch (error) { throw usage(["ENOENT", "ENOTDIR"].includes(error?.code) ? "audio file not found" : "audio file cannot be read"); }
  checkPath(real);
  const inspected = fs.statSync(real);
  if (!inspected.isFile()) throw usage("audio file must be a regular file");
  // O_NONBLOCK is undefined on Windows.
  const fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const before = fs.fstatSync(fd);
    if (before.dev !== inspected.dev || before.ino !== inspected.ino) throw usage("audio file changed before reading");
    if (!before.isFile() || before.size === 0) throw usage("audio file must be a nonempty regular file");
    if (before.size > MAX_AUDIO_INPUT_BYTES) throw usage("audio file is too large (maximum 25 MiB)");
    const bytes = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = fs.readSync(fd, bytes, total, bytes.length - total, null);
      if (!count) break;
      total += count;
    }
    const after = fs.fstatSync(fd);
    if (total !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || fs.realpathSync.native(resolved) !== real) throw usage("audio file changed while reading");
    const content = bytes.subarray(0, total);
    const type = audioType(content);
    if (path.extname(file).toLowerCase() !== type.extension) throw usage("audio file extension does not match its format");
    return { content, type };
  } finally { fs.closeSync(fd); }
}

function audioOption(value, name, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw usage(`invalid audio ${name}`);
}

const finite = (value) => Number.isFinite(value);
function validTranscript(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.text !== "string") return false;
  if (raw.language !== undefined && typeof raw.language !== "string") return false;
  if (raw.duration !== undefined && (!finite(raw.duration) || raw.duration < 0)) return false;
  return raw.words === undefined || (Array.isArray(raw.words) && raw.words.every((word) => word && typeof word.text === "string" && finite(word.start) && finite(word.end) && word.start >= 0 && word.end >= word.start));
}

export function createMedia({ apiClient = { requestAuthenticated: defaultRequest }, fetchImpl = globalThis.fetch } = {}) {
  async function generateImage({ prompt, sources = [], model }) {
    if (!Array.isArray(sources) || sources.length > 3) throw usage("image generation accepts at most 3 sources");
    const input = sources.length === 1 ? { image: { url: sources[0] } } : sources.length ? { images: sources.map((url) => ({ type: "image_url", url })) } : {};
    const body = { model, prompt, n: 1, ...input };
    const raw = await apiClient.requestAuthenticated(sources.length ? "/images/edits" : "/images/generations", { method: "POST", body });
    const item = raw?.data?.[0];
    if (!item?.url && !item?.b64_json) throw usage("image generation response has no artifact");
    return { ...(item.url ? { url: item.url } : { b64: item.b64_json }), raw };
  }

  function saveBase64(value, { out, outDir = DEFAULT_MEDIA_DIR, maxBytes = MAX_ARTIFACT_BYTES } = {}) {
    if (typeof value !== "string") throw usage("invalid base64 image");
    const text = value.replace(/\s/g, "");
    if (text.length > Math.ceil(maxBytes / 3) * 4) throw usage("artifact is too large");
    if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw usage("invalid base64 image");
    const bytes = Buffer.from(text, "base64");
    if (bytes.length > maxBytes) throw usage("artifact is too large");
    const type = sniff(bytes);
    if (type.mime === "video/mp4") throw usage("base64 artifact must be an image");
    return saveBytes(bytes, type, { out, outDir, stem: "grok-image" });
  }

  async function synthesizeSpeech({ text, voice = "eve", language = "auto", out, outDir = DEFAULT_MEDIA_DIR }) {
    if (typeof text !== "string" || !text.trim() || [...text].length > 60000) throw usage("speech text must contain 1 to 60000 characters");
    const check = preflight(text);
    if (!check.ok) throw usage(`content rejected before dispatch: ${check.reason}`);
    audioOption(voice, "voice", /^[A-Za-z0-9_-]{1,128}$/);
    audioOption(language, "language", LANGUAGE_PATTERN);
    prepareOut(out, outDir, "grok-speech");
    const bytes = await apiClient.requestAuthenticated("/tts", { method: "POST", body: { text, voice_id: voice, language }, responseType: "bytes", maxBytes: MAX_SPEECH_BYTES });
    let type = null;
    if (Buffer.isBuffer(bytes) && bytes.length && bytes.length <= MAX_SPEECH_BYTES) { try { type = audioType(bytes); } catch { /* reported below */ } }
    if (type?.mime !== "audio/mpeg") throw usage(`speech response is not a verified MP3${BILLED}`);
    return saveBytes(bytes, type, { out, outDir, stem: "grok-speech" });
  }

  async function transcribeAudio({ file, language, model = DEFAULT_TRANSCRIBE_MODEL }) {
    audioOption(model, "model", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    if (language !== undefined) audioOption(language, "language", LANGUAGE_PATTERN);
    const { content, type } = readAudio(file);
    const formData = new FormData();
    formData.append("model", model);
    if (language !== undefined) formData.append("language", language);
    formData.append("file", new Blob([content], { type: type.mime }), path.basename(file));
    const raw = await apiClient.requestAuthenticated("/stt", { method: "POST", formData, maxBytes: MAX_TRANSCRIPT_BYTES });
    if (!validTranscript(raw)) throw usage(`invalid transcription response${BILLED}`);
    return scrubDeep({
      text: raw.text,
      ...(raw.language !== undefined ? { language: raw.language } : {}),
      ...(raw.duration !== undefined ? { duration: raw.duration } : {}),
      ...(raw.words !== undefined ? { words: raw.words.map(({ text, start, end }) => ({ text, start, end })) } : {}),
      untrusted: true
    });
  }

  async function createVideoJob({ prompt, seconds, fromImage, model }) {
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
  return { generateImage, createVideoJob, pollVideo, downloadArtifact, saveBase64, synthesizeSpeech, transcribeAudio };
}

const defaultMedia = createMedia();
export const generateImage = defaultMedia.generateImage;
export const createVideoJob = defaultMedia.createVideoJob;
export const pollVideo = defaultMedia.pollVideo;
export const downloadArtifact = defaultMedia.downloadArtifact;
export const saveBase64 = defaultMedia.saveBase64;
export const synthesizeSpeech = defaultMedia.synthesizeSpeech;
export const transcribeAudio = defaultMedia.transcribeAudio;
