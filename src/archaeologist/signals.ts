import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";
import type { StackDetection } from "../types/shared.js";

const exec = promisify(execFile);
const SPAWN_TIMEOUT_MS = 8_000;

export interface GitLogSignal {
  kind: "git-log";
  available: boolean;
  reason?: string;
  commitCount: number;
  topAuthors: Array<{ name: string; email: string; commits: number }>;
  topKeywords: Array<{ word: string; count: number }>;
  conventionalPrefixes: Array<{ prefix: string; count: number }>;
  recentCommits: Array<{ sha: string; author: string; subject: string }>;
}

export interface ReadmeSignal {
  kind: "readme";
  available: boolean;
  reason?: string;
  path?: string;
  h1?: string;
  gettingStarted?: { startLine: number; body: string };
  stackMentions: string[];
}

export interface TopImportsSignal {
  kind: "top-imports";
  available: boolean;
  reason?: string;
  language: string;
  ranked: Array<{ pkg: string; count: number }>;
}

export interface TestRunnerSignal {
  kind: "test-runner";
  available: boolean;
  reason?: string;
  runner: string | null;
  testFiles: string[];
  testDirs: string[];
}

export interface OpenPrsSignal {
  kind: "open-prs";
  available: boolean;
  reason?: string;
  prs: Array<{ number: number; title: string; body: string }>;
}

export interface CiSignal {
  kind: "ci";
  available: boolean;
  reason?: string;
  workflows: Array<{ file: string; steps: string[] }>;
}

export type Signal =
  | GitLogSignal
  | ReadmeSignal
  | TopImportsSignal
  | TestRunnerSignal
  | OpenPrsSignal
  | CiSignal;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "and",
  "or",
  "for",
  "in",
  "on",
  "with",
  "by",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "from",
  "as",
  "at",
  "this",
  "that",
  "it",
  "its",
  "into",
  "via",
  "use",
  "uses",
  "add",
  "adds",
  "added",
  "fix",
  "fixed",
  "fixes",
  "update",
  "updated",
  "updates",
  "remove",
  "removed",
  "removes",
  "wip",
  "init",
  "initial",
  "merge",
  "branch",
  "main",
  "master",
  "release",
  "version",
  "bump",
  "chore",
  "refactor",
  "test",
  "tests",
  "ci",
  "docs",
  "doc",
]);

const CONVENTIONAL_PREFIXES = [
  "feat",
  "fix",
  "chore",
  "docs",
  "refactor",
  "test",
  "perf",
  "style",
  "ci",
  "build",
  "revert",
];

export async function gitLogSignal(root: string): Promise<GitLogSignal> {
  const gitDir = path.join(root, ".git");
  if (!(await fs.pathExists(gitDir))) {
    return {
      kind: "git-log",
      available: false,
      reason: "not a git repo",
      commitCount: 0,
      topAuthors: [],
      topKeywords: [],
      conventionalPrefixes: [],
      recentCommits: [],
    };
  }
  let stdout = "";
  try {
    const r = await exec(
      "git",
      ["log", "--pretty=format:%h|%an|%ae|%s", "-n", "200"],
      { cwd: root, timeout: SPAWN_TIMEOUT_MS, shell: false, maxBuffer: 4 * 1024 * 1024 },
    );
    stdout = r.stdout;
  } catch (e) {
    return {
      kind: "git-log",
      available: false,
      reason: `git log failed: ${(e as Error).message.slice(0, 120)}`,
      commitCount: 0,
      topAuthors: [],
      topKeywords: [],
      conventionalPrefixes: [],
      recentCommits: [],
    };
  }

  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  const authors = new Map<string, { name: string; email: string; commits: number }>();
  const keywords = new Map<string, number>();
  const prefixes = new Map<string, number>();
  const recentCommits: GitLogSignal["recentCommits"] = [];

  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 4) continue;
    const sha = parts[0]!;
    const name = parts[1]!;
    const email = parts[2]!;
    const subject = parts.slice(3).join("|");
    recentCommits.push({ sha, author: name, subject });

    const key = email || name;
    const prev = authors.get(key) ?? { name, email, commits: 0 };
    prev.commits += 1;
    authors.set(key, prev);

    const m = /^([a-z]+)(?:\([^)]+\))?(!)?:\s/i.exec(subject);
    if (m) {
      const p = m[1]!.toLowerCase();
      if (CONVENTIONAL_PREFIXES.includes(p)) {
        prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
      }
    }

    for (const tok of subject.toLowerCase().split(/[^a-z0-9_-]+/)) {
      if (tok.length < 4) continue;
      if (STOPWORDS.has(tok)) continue;
      keywords.set(tok, (keywords.get(tok) ?? 0) + 1);
    }
  }

  const topAuthors = [...authors.values()]
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 5);
  const topKeywords = [...keywords.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));
  const conventionalPrefixes = [...prefixes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([prefix, count]) => ({ prefix, count }));

  return {
    kind: "git-log",
    available: true,
    commitCount: lines.length,
    topAuthors,
    topKeywords,
    conventionalPrefixes,
    recentCommits: recentCommits.slice(0, 50),
  };
}

const README_CANDIDATES = ["README.md", "README.MD", "Readme.md", "README.rst", "README"];

export async function readmeSignal(root: string): Promise<ReadmeSignal> {
  let found: string | null = null;
  for (const c of README_CANDIDATES) {
    if (await fs.pathExists(path.join(root, c))) {
      found = c;
      break;
    }
  }
  if (!found) {
    return { kind: "readme", available: false, reason: "no README found", stackMentions: [] };
  }
  const text = await fs.readFile(path.join(root, found), "utf8");
  const lines = text.split("\n");
  let h1: string | undefined;
  for (const line of lines) {
    const m = /^#\s+(.+)$/.exec(line);
    if (m) {
      h1 = m[1]!.trim();
      break;
    }
  }

  let gettingStarted: ReadmeSignal["gettingStarted"];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,3}\s+(getting started|quickstart|installation|setup|install)\b/i.test(line)) {
      const body: string[] = [];
      for (let j = i + 1; j < lines.length && body.length < 30; j++) {
        if (/^#{1,3}\s+/.test(lines[j]!)) break;
        body.push(lines[j]!);
      }
      gettingStarted = { startLine: i + 1, body: body.join("\n").trim() };
      break;
    }
  }

  const stackKeywords = [
    "TypeScript",
    "JavaScript",
    "Python",
    "Go",
    "Rust",
    "Next.js",
    "React",
    "Vue",
    "Svelte",
    "Express",
    "Fastify",
    "Hono",
    "Django",
    "FastAPI",
    "Flask",
    "pnpm",
    "npm",
    "yarn",
    "bun",
    "pip",
    "poetry",
    "uv",
    "vitest",
    "jest",
    "pytest",
    "eslint",
    "prettier",
    "biome",
    "ruff",
    "black",
    "GitHub Actions",
    "GitLab CI",
    "CircleCI",
  ];
  const stackMentions: string[] = [];
  for (const k of stackKeywords) {
    const re = new RegExp(`\\b${k.replace(/[.+]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) stackMentions.push(k);
  }

  return { kind: "readme", available: true, path: found, h1, gettingStarted, stackMentions };
}

async function readJsonSafe(p: string): Promise<Record<string, unknown> | null> {
  try {
    return (await fs.readJson(p)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readTextSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

async function walkSourceFiles(
  root: string,
  exts: string[],
  cap = 1000,
): Promise<string[]> {
  const out: string[] = [];
  const skipDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".cache",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    "target",
    ".apex",
    ".claude",
  ]);
  async function walk(dir: string): Promise<void> {
    if (out.length >= cap) return;
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= cap) return;
      if (skipDirs.has(e)) continue;
      if (e.startsWith(".") && e !== "." && e !== "..") continue;
      const full = path.join(dir, e);
      let stat: import("node:fs").Stats;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        await walk(full);
      } else if (exts.some((x) => e.endsWith(x))) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

export async function topImportsSignal(
  root: string,
  detection: StackDetection,
): Promise<TopImportsSignal> {
  if (detection.language === "node") {
    const pkg = await readJsonSafe(path.join(root, "package.json"));
    if (!pkg) {
      return {
        kind: "top-imports",
        available: false,
        reason: "no package.json",
        language: "node",
        ranked: [],
      };
    }
    const deps: string[] = [];
    for (const k of ["dependencies", "devDependencies", "peerDependencies"]) {
      const v = pkg[k];
      if (v && typeof v === "object") deps.push(...Object.keys(v));
    }
    if (deps.length === 0) {
      return { kind: "top-imports", available: true, language: "node", ranked: [] };
    }
    const files = await walkSourceFiles(root, [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"], 500);
    const counts = new Map<string, number>();
    for (const dep of deps) counts.set(dep, 0);
    for (const file of files) {
      const txt = await readTextSafe(file);
      if (!txt) continue;
      for (const dep of deps) {
        const escaped = dep.replace(/[/.+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(
          `(?:from\\s+['"\`]${escaped}(?:/[^'"\`]*)?['"\`])|(?:require\\(['"\`]${escaped}(?:/[^'"\`]*)?['"\`]\\))|(?:import\\s+['"\`]${escaped}(?:/[^'"\`]*)?['"\`])`,
        );
        if (re.test(txt)) counts.set(dep, (counts.get(dep) ?? 0) + 1);
      }
    }
    const ranked = [...counts.entries()]
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([pkg, count]) => ({ pkg, count }));
    return { kind: "top-imports", available: true, language: "node", ranked };
  }

  if (detection.language === "python") {
    const pyproject = await readTextSafe(path.join(root, "pyproject.toml"));
    const requirements = await readTextSafe(path.join(root, "requirements.txt"));
    const deps = new Set<string>();
    const haystack = `${pyproject ?? ""}\n${requirements ?? ""}`;
    for (const m of haystack.matchAll(/^([a-zA-Z][a-zA-Z0-9_-]+)\s*[=<>~!]/gm)) {
      deps.add(m[1]!.toLowerCase());
    }
    if (deps.size === 0) {
      return { kind: "top-imports", available: true, language: "python", ranked: [] };
    }
    const files = await walkSourceFiles(root, [".py"], 500);
    const counts = new Map<string, number>();
    for (const dep of deps) counts.set(dep, 0);
    for (const file of files) {
      const txt = await readTextSafe(file);
      if (!txt) continue;
      for (const dep of deps) {
        const escaped = dep.replace(/[/.+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?:^|\\n)\\s*(?:from\\s+${escaped}|import\\s+${escaped})`);
        if (re.test(txt)) counts.set(dep, (counts.get(dep) ?? 0) + 1);
      }
    }
    const ranked = [...counts.entries()]
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([pkg, count]) => ({ pkg, count }));
    return { kind: "top-imports", available: true, language: "python", ranked };
  }

  return {
    kind: "top-imports",
    available: false,
    reason: `language ${detection.language} not supported by topImports`,
    language: detection.language,
    ranked: [],
  };
}

export async function testRunnerSignal(
  root: string,
  detection: StackDetection,
): Promise<TestRunnerSignal> {
  const exts =
    detection.language === "python"
      ? [".py"]
      : detection.language === "go"
        ? [".go"]
        : [".test.ts", ".test.tsx", ".test.js", ".test.jsx", ".spec.ts", ".spec.js"];

  const files = await walkSourceFiles(root, exts, 1000);
  let testFiles: string[];
  if (detection.language === "python") {
    testFiles = files.filter((f) => /(^|\/)test_[^/]+\.py$|_test\.py$/.test(f));
  } else if (detection.language === "go") {
    testFiles = files.filter((f) => /_test\.go$/.test(f));
  } else {
    testFiles = files;
  }
  const dirs = new Set<string>();
  for (const f of testFiles) dirs.add(path.dirname(path.relative(root, f)));

  return {
    kind: "test-runner",
    available: true,
    runner: detection.testRunner,
    testFiles: testFiles.map((f) => path.relative(root, f)).slice(0, 100),
    testDirs: [...dirs].slice(0, 30),
  };
}

export async function openPrsSignal(root: string): Promise<OpenPrsSignal> {
  try {
    await exec("gh", ["--version"], { timeout: SPAWN_TIMEOUT_MS, shell: false });
  } catch {
    return { kind: "open-prs", available: false, reason: "gh CLI not available", prs: [] };
  }
  try {
    const r = await exec(
      "gh",
      ["pr", "list", "--state", "open", "--json", "number,title,body", "--limit", "20"],
      { cwd: root, timeout: SPAWN_TIMEOUT_MS, shell: false, maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = JSON.parse(r.stdout) as Array<{ number: number; title: string; body: string }>;
    const prs = parsed.map((p) => ({
      number: p.number,
      title: p.title,
      body: (p.body ?? "").slice(0, 1000),
    }));
    return { kind: "open-prs", available: true, prs };
  } catch (e) {
    return {
      kind: "open-prs",
      available: false,
      reason: `gh pr list failed: ${(e as Error).message.slice(0, 120)}`,
      prs: [],
    };
  }
}

export async function ciSignal(root: string): Promise<CiSignal> {
  const wfDir = path.join(root, ".github", "workflows");
  if (!(await fs.pathExists(wfDir))) {
    return { kind: "ci", available: false, reason: "no .github/workflows", workflows: [] };
  }
  let entries: string[] = [];
  try {
    entries = await fs.readdir(wfDir);
  } catch {
    return { kind: "ci", available: false, reason: "could not read workflows dir", workflows: [] };
  }
  const workflows: CiSignal["workflows"] = [];
  for (const e of entries) {
    if (!/\.ya?ml$/.test(e)) continue;
    const txt = await readTextSafe(path.join(wfDir, e));
    if (!txt) continue;
    const steps: string[] = [];
    for (const line of txt.split("\n")) {
      const m = /^\s*(?:run|name):\s*(.+?)\s*$/.exec(line);
      if (m) {
        const v = m[1]!.replace(/^['"]|['"]$/g, "").trim();
        if (v.length > 0 && v.length < 200) steps.push(v);
      }
    }
    workflows.push({ file: path.join(".github", "workflows", e), steps: steps.slice(0, 50) });
  }
  return { kind: "ci", available: true, workflows };
}
