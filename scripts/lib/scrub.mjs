const KEY_PATTERNS = [
  // Real xAI keys are xai- + long pure-alphanumeric; hyphenated xai-* slugs
  // (artifact filenames like xai-video-<uuid>) are not secrets and must not match.
  new RegExp("\\bx" + "ai-[A-Za-z0-9]{20,}", "g"),
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgho_[A-Za-z0-9]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g
];
// Credential file names, shared with the risk rule (which tests the file name only; spec 007 R6, R7).
// `.env` and `.envrc` count only as a whole dot-separated part: `.env.local` and `x.env` match, `.env-prod` does not (D1).
export const CREDENTIAL_FILE_NAMES = Object.freeze([
  /\.env(rc)?(\.[^\\/]*)?$/i,
  /id_(rsa|dsa|ecdsa|ed25519)/i,
  /\.(pem|key|pfx|p12|ppk|jks|keystore)$/i,
  /(^|[\\/])(\.npmrc|\.netrc|_netrc|\.pypirc)$/i
]);
// On a whole path, `id_*` and `credentials` also match a folder name.
const CREDENTIAL_PATH = new RegExp([...CREDENTIAL_FILE_NAMES.map((pattern) => pattern.source), "credentials"].join("|"), "i");

export function scrubText(value) {
  if (typeof value !== "string") return { text: value, maskedMatches: 0 };
  let text = value;
  let maskedMatches = 0;
  for (const pattern of KEY_PATTERNS) {
    text = text.replace(pattern, () => {
      maskedMatches += 1;
      return "[REDACTED]";
    });
  }
  const envKey = process.env.XAI_API_KEY;
  if (envKey && envKey.length >= 8 && text.includes(envKey)) {
    text = text.split(envKey).join("[REDACTED]");
    maskedMatches += 1;
  }
  return { text, maskedMatches };
}

export function scrubDeep(value) {
  if (typeof value === "string") return scrubText(value).text;
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubDeep(entry)]));
  }
  return value;
}

export function preflight(text, { sourcePath } = {}) {
  if (sourcePath && CREDENTIAL_PATH.test(sourcePath)) {
    return { ok: false, reason: "credential file paths are not allowed" };
  }
  if (scrubText(text).maskedMatches > 0) return { ok: false, reason: "secret-shaped content detected" };
  return { ok: true };
}
