// Patterns for the pre-commit secret check (scripts/check-secrets.mjs).
//
// Literal markers are split into pieces so this file does not trip its own
// check when it is staged.

const join = (...parts) => parts.join("");

/** Variables that must never be committed with a value. */
export const SECRET_VARIABLES = [
  "PAYPAL_CLIENT_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
];

/** @type {{ name: string, regex: RegExp }[]} */
export const SECRET_PATTERNS = [
  { name: "Supabase secret key", regex: new RegExp(join("sb_", "secret_")) },
  { name: "Anthropic API key", regex: new RegExp(join("sk-", "ant-")) },
  {
    name: "private key block",
    regex: new RegExp(join("-----", "BEGIN") + "[A-Z ]*" + join("PRIVATE", " KEY")),
  },
  { name: "JWT", regex: new RegExp(join("eyJhbG", "ciOi")) },
  {
    // NAME=value, NAME = "value", export NAME='value'. An empty value
    // (NAME= or NAME="") is allowed; comparisons (NAME == x) are not matched.
    name: "secret variable assignment",
    regex: new RegExp(
      `\\b(?:${SECRET_VARIABLES.join("|")})\\s*=(?!=)\\s*(?!["']{2})["']?[^\\s"'#]`,
    ),
  },
];

/**
 * Scans text and returns one finding per matching line.
 * @param {string} text
 * @returns {{ line: number, pattern: string }[]}
 */
export function findSecrets(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((content, index) => {
    for (const { name, regex } of SECRET_PATTERNS) {
      if (regex.test(content)) {
        findings.push({ line: index + 1, pattern: name });
      }
    }
  });
  return findings;
}

/**
 * True when the buffer looks binary (contains a NUL byte in the first 8 KB).
 * @param {Uint8Array} buffer
 */
export function isBinary(buffer) {
  const limit = Math.min(buffer.length, 8000);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** Files the check never scans. */
export const SKIPPED_FILES = new Set([".env.example"]);
