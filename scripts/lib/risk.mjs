// R10a: the stop-review gate reviews a diff only when it is large or touches a risky category.
// The categories are those of the Gemini routing policy's review line. Not configurable.
export const LARGE_DIFF_LINES = 400;

const CATEGORIES = [
  ["auth", ["auth", "login", "signin", "oauth", "sso", "session", "jwt", "password", "passwd", "permission", "rbac", "acl"], [],
    /password|passwd|authenticat|authoriz|\bjwt\b|oauth|bcrypt|argon2|set-cookie/i],
  ["secrets", ["secret", "credential", "token", "apikey", "keystore", "vault"], [/^\.env/i, /\.pem$/i, /\.key$/i, /\.pfx$/i, /api[_-]?key/i, /private[_-]?key/i],
    /secret|api[\s_-]?key|private[\s_-]?key|access[\s_-]?token|credential/i],
  ["data", ["database", "db", "storage", "backup", "delete", "purge"], [],
    /\bdrop\s+(table|database|column|schema)\b|\btruncate\b|\bdelete\s+from\b|rm\s+-rf|rmSync|unlink|Remove-Item|deleteMany|destroy_all/i],
  ["money", ["payment", "billing", "invoice", "checkout", "stripe", "paypal", "pricing", "refund", "subscription", "ledger", "payout"], [],
    /payment|invoice|refund|stripe|paypal|billing|payout/i],
  ["migration", ["migration", "migrate", "schema", "prisma", "alembic"], [/\.sql$/i],
    /\b(create|alter)\s+table\b|\badd\s+column\b|migration/i],
  ["security", ["security", "crypto", "encrypt", "decrypt", "cors", "csrf", "firewall", "rls", "sanitize"], [],
    /encrypt|decrypt|csrf|\bcors\b|sanitiz|\beval\(|child_process|rejectUnauthorized|verify\s*=\s*false|--no-verify|row level security|icacls|chmod/i]
];

const pathWords = (file) => file.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((word) => word.toLowerCase());

const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
// Git C-quotes a path with special or non-ASCII characters: "a/caf\303\251.js" holds UTF-8 bytes as octal escapes.
function unquote(text) {
  if (!/^".*"$/.test(text)) return text;
  const bytes = [];
  for (let index = 1; index < text.length - 1; index += 1) {
    if (text[index] !== "\\") { bytes.push(...Buffer.from(text[index])); continue; }
    const octal = /^[0-7]{3}/.exec(text.slice(index + 1));
    if (octal) { bytes.push(parseInt(octal[0], 8)); index += 3; } else { index += 1; bytes.push(ESCAPES[text[index]] ?? text.charCodeAt(index)); }
  }
  return Buffer.from(bytes).toString("utf8");
}
const stripPrefix = (file) => unquote(file).replace(/^[ab]\//, "");

// Reads only the text of `git diff`: each file's `---`/`+++` header paths (or, without them, the
// `diff --git` line's two paths), and the +/- lines inside hunks.
export function riskyDiff(diffText) {
  const paths = [];
  const changed = [];
  let inHunk = false;
  let gitPaths = [];
  for (const line of String(diffText ?? "").split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      paths.push(...gitPaths);
      const rest = line.slice(11);
      gitPaths = (rest.includes('"') ? rest.match(/"(?:[^"\\]|\\.)*"|\S+/g) : (/^(a\/.*) (b\/.*)$/.exec(rest)?.slice(1) ?? [rest])).map(stripPrefix);
      inHunk = false;
    } else if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && /^[+-]/.test(line)) changed.push(line.slice(1));
    else if (/^(---|\+\+\+) /.test(line)) {
      gitPaths = [];
      if (line.slice(4) !== "/dev/null") paths.push(stripPrefix(line.slice(4)));
    }
  }
  paths.push(...gitPaths);
  const reasons = CATEGORIES.filter(([, stems, files, pattern]) =>
    paths.some((file) => pathWords(file).some((word) => stems.some((stem) => word.startsWith(stem))) || files.some((glob) => glob.test(file.split("/").at(-1))))
    || changed.some((line) => pattern.test(line))).map(([name]) => name);
  if (changed.length >= LARGE_DIFF_LINES) reasons.push("large");
  return { risky: reasons.length > 0, reasons };
}
