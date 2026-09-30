import fs from "node:fs";
import path from "node:path";
import { preflight } from "./scrub.mjs";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function usage(message) {
  const error = new Error(message);
  error.error_class = "usage";
  error.retryable = false;
  return error;
}

const BINARY_DOC_EXT = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".zip", ".7z", ".rar", ".epub"
]);
const BINARY_MAGIC = [
  Buffer.from("%PDF-"),
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.from("{\rtf")
];

// Binary documents decode to garbage as UTF-8 and the model answers confidently wrong.
export function isBinaryDoc(file, buffer) {
  if (BINARY_DOC_EXT.has(path.extname(file).toLowerCase())) return true;
  if (!buffer) return false;
  if (BINARY_MAGIC.some((m) => buffer.subarray(0, m.length).equals(m))) return true;
  return buffer.subarray(0, 8192).includes(0);
}

function binaryDocError(file) {
  return usage(`attachment rejected: ${path.basename(file)} is a binary document; convert it to markdown first (MarkItDown) and attach the .md`);
}

function kindFor(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "png";
  return null;
}

export function stripExif(buffer, kind) {
  if (kind === "jpg") {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer;
    const chunks = [buffer.subarray(0, 2)];
    let offset = 2;
    while (offset + 1 < buffer.length) {
      if (buffer[offset] !== 0xff) { chunks.push(buffer.subarray(offset)); break; }
      const marker = buffer[offset + 1];
      if (marker === 0xda || marker === 0xd9) { chunks.push(buffer.subarray(offset)); break; }
      if (marker === 0x00 || marker === 0xff || offset + 4 > buffer.length) { chunks.push(buffer.subarray(offset)); break; }
      const length = buffer.readUInt16BE(offset + 2);
      const end = offset + 2 + length;
      if (length < 2 || end > buffer.length) { chunks.push(buffer.subarray(offset)); break; }
      if (marker < 0xe0 || marker > 0xef) chunks.push(buffer.subarray(offset, end));
      offset = end;
    }
    return Buffer.concat(chunks);
  }
  if (kind === "png" && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const chunks = [buffer.subarray(0, 8)];
    let offset = 8;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > buffer.length) return buffer;
      const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
      if (!["eXIf", "tEXt", "zTXt", "iTXt"].includes(type)) chunks.push(buffer.subarray(offset, end));
      offset = end;
      if (type === "IEND") return Buffer.concat(chunks);
    }
  }
  return buffer;
}

export function estimateTokens(parts) {
  return parts.reduce((total, part) => total + (part.type === "text" ? Math.ceil(String(part.text ?? "").length / 4) : 256), 0);
}

export function toParts(paths, { maxFileBytes = MAX_FILE_BYTES, maxTotalBytes = MAX_TOTAL_BYTES } = {}) {
  if (!Array.isArray(paths)) throw usage("paths must be an array");
  let totalBytes = 0;
  const parts = paths.map((inputPath) => {
    const resolved = path.resolve(inputPath);
    let stat;
    try { stat = fs.statSync(resolved); } catch { throw usage(`file not found: ${inputPath}`); }
    if (!stat.isFile()) throw usage(`not a regular file: ${inputPath}`);
    if (stat.size > maxFileBytes) throw usage(`file exceeds the 20 MiB attachment limit: ${inputPath}`);
    totalBytes += stat.size;
    if (totalBytes > maxTotalBytes) throw usage("attachments exceed the 100 MiB total limit");
    const buffer = fs.readFileSync(resolved);
    const kind = kindFor(buffer);
    if (!kind) {
      if (isBinaryDoc(inputPath, buffer)) throw binaryDocError(inputPath);
      const text = buffer.toString("utf8");
      const approval = preflight(text, { sourcePath: inputPath });
      if (!approval.ok) throw usage(`attachment rejected: ${approval.reason}`);
      return { type: "text", text: `File: ${path.basename(inputPath)}\n\n${text}` };
    }
    const clean = stripExif(buffer, kind);
    const mime = kind === "jpg" ? "image/jpeg" : "image/png";
    return { type: "image_url", image_url: { url: `data:${mime};base64,${clean.toString("base64")}` } };
  });
  return { parts, tokenEstimate: estimateTokens(parts), totalBytes, warnAtBytes: totalBytes >= 80 * 1024 * 1024 };
}
