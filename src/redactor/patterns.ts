// Redactor pattern catalog. Implements specs/redactor-design.md §2.
//
// Each pattern declares a name, a detection regex, and a replacement spec.
// The replacement is either a static string (the whole match becomes the
// marker) or a function that returns the replacement (lets us preserve a
// captured prefix/suffix while masking only a sub-group).
//
// Patterns run in detection order (§2.1): the first matching pattern wins
// for a byte range. Subsequent patterns do not re-flag already-redacted
// output. Names match specs/redactor-design.md exactly so the audit log
// and `apex audit` surface stable identifiers.

export type ReplaceFn = (match: string, ...groups: string[]) => string;

export interface RedactorPattern {
  /** Stable identifier — appears in `[REDACTED:name]` and audit log. */
  name: string;
  /** Detection regex. Global flag so we can iterate matches. */
  regex: RegExp;
  /** Replacement: literal string or fn called per-match. */
  replacement: string | ReplaceFn;
  /** Severity per spec. Phase 1 maps block + mask -> redact. warn passes through. */
  severity: "block" | "mask" | "warn";
}

const RED = (name: string) => `[REDACTED:${name}]`;

// PEM private-key blocks span multiple lines. Capture from BEGIN through the
// matching END line and replace the whole block with one marker.
const PEM_PRIVATE_KEY_REGEX =
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/g;

/**
 * Default-on patterns. Order is load-bearing — see §2.1 of redactor-design.md.
 *
 * Notes:
 *  - `aws-secret-key` proximity guard ("within 4 lines of aws_secret_access_key")
 *    is implemented in `index.ts`, not as a regex.
 *  - `pii-email`, `pii-phone`, `high-entropy-token` (warn-tier) are out of
 *    Phase 1 scope per the owned-files brief — kept aside for Phase 5.5.
 *  - `pem-private-key` spans BEGIN..END.
 *
 * Default-on Phase 1 set per brief: AWS keys, GH tokens, JWTs, generic API
 * keys, .env-style assignments, private keys, basic auth URLs.
 */
export const PATTERNS: RedactorPattern[] = [
  {
    name: "aws-access-key",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: RED("aws-access-key"),
    severity: "block",
  },
  {
    name: "gh-pat",
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
    replacement: RED("gh-pat"),
    severity: "block",
  },
  {
    name: "gitlab-pat",
    regex: /\bglpat-[A-Za-z0-9_\-]{20,}\b/g,
    replacement: RED("gitlab-pat"),
    severity: "block",
  },
  {
    name: "slack-token",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: RED("slack-token"),
    severity: "block",
  },
  {
    name: "slack-webhook",
    regex:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
    replacement: RED("slack-webhook"),
    severity: "block",
  },
  {
    name: "discord-webhook",
    regex:
      /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_\-]+/g,
    replacement: RED("discord-webhook"),
    severity: "block",
  },
  {
    name: "jwt",
    regex: /\beyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g,
    replacement: RED("jwt"),
    severity: "block",
  },
  {
    name: "pem-private-key",
    regex: PEM_PRIVATE_KEY_REGEX,
    replacement: RED("pem-private-key"),
    severity: "block",
  },
  {
    name: "anthropic-key",
    regex: /\bsk-ant-[A-Za-z0-9_\-]{80,}\b/g,
    replacement: RED("anthropic-key"),
    severity: "block",
  },
  {
    name: "openai-key",
    regex: /\bsk-(?!ant-)[A-Za-z0-9]{20,}\b/g,
    replacement: RED("openai-key"),
    severity: "block",
  },
  {
    name: "stripe-key",
    regex: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
    replacement: RED("stripe-key"),
    severity: "block",
  },
  {
    name: "google-api-key",
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
    replacement: RED("google-api-key"),
    severity: "block",
  },
  {
    name: "db-url-with-creds",
    regex:
      /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp|amqps):\/\/[^:\s/@]+:[^@\s]+@/g,
    replacement: RED("db-url-with-creds"),
    severity: "block",
  },
  {
    name: "basic-auth-url",
    // https?://user:pass@host/...  — generic basic-auth URLs not covered by
    // db-url-with-creds. Phase 1 default-on per brief: "basic auth URLs".
    regex: /\bhttps?:\/\/[^:\s/@]+:[^@\s/]+@[^\s]+/g,
    replacement: RED("basic-auth-url"),
    severity: "block",
  },
  {
    name: "env-assignment",
    // Multiline, case-insensitive on the keyword fragment but anchored on a
    // SHOUTY env-style identifier. Mask only the value (group 2) so the
    // *which-key-leaked* signal is preserved.
    regex:
      /^([\t ]*(?:export[\t ]+)?[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|API_?KEY|AUTH|CREDS?|CREDENTIAL)[A-Z0-9_]*[\t ]*=[\t ]*['"]?)(\S{8,}?)(['"]?)\s*$/gm,
    replacement: (_m, prefix: string, _val: string, suffix: string) =>
      `${prefix}${RED("env-assignment")}${suffix}`,
    severity: "block",
  },
  {
    name: "generic-api-key",
    // Generic long token after a "key/token/bearer" cue. Conservative: only
    // flagged when ≥ 32 chars of [A-Za-z0-9_\-] follow a recognised cue. Mask
    // just the captured value, keep the cue word visible for debuggability.
    regex:
      /\b(api[_\-]?key|access[_\-]?token|auth[_\-]?token|bearer)(["'\s:=]+)([A-Za-z0-9_\-]{32,})\b/gi,
    replacement: (_m, cue: string, sep: string, _tok: string) =>
      `${cue}${sep}${RED("generic-api-key")}`,
    severity: "block",
  },
];

/** Just the names, in detection order. */
export function patternNames(): string[] {
  return PATTERNS.map((p) => p.name);
}
