// Static external-call scanner. Implements PRD §5.5 `apex audit`.
//
// Walks a project's source tree looking for byte-level signatures of code that
// might phone home: `fetch(`, `axios`, `node-fetch`, `http(s).request`,
// `undici.request`, plus shelled `curl`/`wget`/`gh api`. The default expected
// finding count for APEX itself is zero — the project is local-only.
//
// This is a *static* scan: it reports textual evidence, not runtime behaviour.
// Transitive `node_modules` dependencies are NOT scanned unless the caller
// passes `includeDeps: true` (the spirit of the audit is "what does APEX
// itself do", not "what does the entire dep graph theoretically allow").
//
// Pure-comment lines (`//`, `*`, `/* ... */`) are excluded so the scanner's
// own self-documenting comments don't count as findings.
//
// Findings are categorised by `kind`:
//   - "fetch"      — global fetch() invocation
//   - "http"       — node:http / node:https request/get
//   - "library"    — axios / node-fetch / undici / got / ky imports or calls
//   - "shell"      — child_process spawning curl/wget/gh api
//
// Each finding is also tagged `productionPath: boolean`. Tests, fixtures, and
// `__tests__` directories are flagged as test-only and surfaced separately by
// the CLI command.

import fs from "node:fs/promises";
import path from "node:path";

export interface AuditFinding {
  /** Absolute path to the file containing the match. */
  file: string;
  /** 1-based line number of the matched line. */
  line: number;
  /** The matched line, trimmed. */
  text: string;
  /** Pattern category. */
  kind: "fetch" | "http" | "library" | "shell";
  /** Stable name of the rule that fired (for grouping/JSON output). */
  rule: string;
  /** True iff the file is on a production path (not under test/fixtures). */
  productionPath: boolean;
}

export interface ScanOptions {
  /** Walk `node_modules/` too (default false). */
  includeDeps?: boolean;
  /** File extensions to scan (default: .ts, .tsx, .js, .mjs, .cjs). */
  extensions?: string[];
}

interface Rule {
  name: string;
  kind: AuditFinding["kind"];
  regex: RegExp;
}

// Detection rules. Each is a single-line regex; multi-line constructs (e.g.
// `fetch(\n  "https://..."\n)`) only match on the first line — that's
// acceptable for an audit report whose role is "surface evidence". False
// positives are tolerable; missed evidence is not.
const RULES: Rule[] = [
  // Global fetch — only flag when followed by `(`. `fetch` as a token in a
  // comment alone won't match.
  { name: "global-fetch", kind: "fetch", regex: /\bfetch\s*\(/ },
  // node:http / node:https request/get. Matched as `http.request(`,
  // `https.request(`, `http.get(`, `https.get(`. Plain `http.` alone passes.
  { name: "node-http-request", kind: "http", regex: /\bhttps?\.(?:request|get)\s*\(/ },
  // Library imports/requires.
  {
    name: "axios-import",
    kind: "library",
    regex: /\b(?:require\s*\(\s*['"]axios['"]|from\s+['"]axios['"])/,
  },
  {
    name: "node-fetch-import",
    kind: "library",
    regex: /\b(?:require\s*\(\s*['"]node-fetch['"]|from\s+['"]node-fetch['"])/,
  },
  {
    name: "undici-request",
    kind: "library",
    // `undici.request(` or `import { request } from 'undici'`.
    regex:
      /\b(?:undici\.(?:request|fetch|stream|pipeline)\s*\(|from\s+['"]undici['"]|require\s*\(\s*['"]undici['"])/,
  },
  {
    name: "got-import",
    kind: "library",
    regex: /\b(?:require\s*\(\s*['"]got['"]|from\s+['"]got['"])/,
  },
  {
    name: "ky-import",
    kind: "library",
    regex: /\b(?:require\s*\(\s*['"]ky['"]|from\s+['"]ky['"])/,
  },
  // Shelled commands. Match common shapes: `"curl ..."`, `'wget ...'`,
  // `gh api`. We require a space after the command to avoid matching `curl`
  // inside identifiers / English prose. The CLI re-checks productionPath.
  {
    name: "shell-curl",
    kind: "shell",
    regex: /["'`]\s*curl\s/,
  },
  {
    name: "shell-wget",
    kind: "shell",
    regex: /["'`]\s*wget\s/,
  },
  {
    name: "shell-gh-api",
    kind: "shell",
    // `gh api` followed by an external-looking path. `gh api repos/...` against
    // GitHub IS an external call. We flag any `gh api ` use; the human reading
    // the report decides.
    regex: /["'`]\s*gh\s+api\s/,
  },
];

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

// Directories to always skip when walking. `node_modules` is conditionally
// re-included via `includeDeps`.
const SKIP_DIRS = new Set([
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".apex",
  ".cache",
  ".next",
  ".turbo",
  ".vite",
]);

// Path segments that mark a file as test-only. Production-path classification
// is `!isTestPath`.
const TEST_SEGMENTS = ["test", "tests", "__tests__", "__fixtures__", "fixtures"];

function isTestPath(absPath: string, root: string): boolean {
  const rel = path.relative(root, absPath).split(path.sep);
  for (const seg of rel) {
    if (TEST_SEGMENTS.includes(seg)) return true;
    if (seg.endsWith(".test.ts") || seg.endsWith(".test.js")) return true;
    if (seg.endsWith(".spec.ts") || seg.endsWith(".spec.js")) return true;
  }
  return false;
}

async function* walk(
  root: string,
  current: string,
  opts: { includeDeps: boolean; extensions: string[] },
): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" && !opts.includeDeps) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      // Skip hidden dot-dirs except a few we already handle.
      if (entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) continue;
      yield* walk(root, full, opts);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!opts.extensions.includes(ext)) continue;
    yield full;
  }
}

/**
 * Scan a project tree for static evidence of external calls.
 *
 * Pure-ish: only does filesystem reads from `rootDir`. Returns a list of
 * findings; no console output, no exit. The CLI layer decides how to render.
 */
export async function scanForExternalCalls(
  rootDir: string,
  options: ScanOptions = {},
): Promise<AuditFinding[]> {
  const opts = {
    includeDeps: options.includeDeps ?? false,
    extensions: options.extensions ?? DEFAULT_EXTENSIONS,
  };
  const findings: AuditFinding[] = [];
  const absRoot = path.resolve(rootDir);

  for await (const file of walk(absRoot, absRoot, opts)) {
    let body: string;
    try {
      body = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = body.split("\n");
    const productionPath = !isTestPath(file, absRoot);
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.length === 0) continue;
      // Skip pure-comment lines so the scanner's own self-documenting
      // comments (and JSDoc on detection rules) don't show up as findings.
      // Block-comment tracking is line-granularity and approximate: a `/* ... */`
      // that opens AND closes on the same line is treated as still-comment for
      // that line; any opener without a closer flips the flag.
      const trimmed = line.trim();
      const startsBlock = trimmed.startsWith("/*");
      const closesBlock = trimmed.endsWith("*/");
      if (inBlockComment) {
        if (closesBlock) inBlockComment = false;
        continue;
      }
      if (startsBlock && !closesBlock) {
        inBlockComment = true;
        continue;
      }
      if (startsBlock && closesBlock) continue;
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      for (const rule of RULES) {
        if (rule.regex.test(line)) {
          findings.push({
            file,
            line: i + 1,
            text: line.trim(),
            kind: rule.kind,
            rule: rule.name,
            productionPath,
          });
        }
      }
    }
  }

  // Stable order for deterministic output.
  findings.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.rule < b.rule ? -1 : 1;
  });
  return findings;
}

/** Group findings into production vs test-only. */
export function partitionFindings(findings: AuditFinding[]): {
  production: AuditFinding[];
  testOnly: AuditFinding[];
} {
  const production: AuditFinding[] = [];
  const testOnly: AuditFinding[] = [];
  for (const f of findings) {
    if (f.productionPath) production.push(f);
    else testOnly.push(f);
  }
  return { production, testOnly };
}
