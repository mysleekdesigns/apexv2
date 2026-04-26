import type {
  KnowledgeFrontmatter,
  KnowledgeSource,
  StackDetection,
} from "../types/shared.js";
import type {
  CiSignal,
  GitLogSignal,
  OpenPrsSignal,
  ReadmeSignal,
  Signal,
  TestRunnerSignal,
  TopImportsSignal,
} from "./signals.js";

export interface DraftEntry {
  frontmatter: KnowledgeFrontmatter & Record<string, unknown>;
  body: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function baseFrontmatter(
  id: string,
  type: KnowledgeFrontmatter["type"],
  title: string,
  sources: KnowledgeSource[],
  tags: string[],
): KnowledgeFrontmatter {
  return {
    id,
    type,
    title,
    applies_to: "all",
    confidence: "low",
    sources,
    created: today(),
    last_validated: today(),
    tags,
  };
}

function packageManagerEntry(detection: StackDetection): DraftEntry | null {
  if (!detection.packageManager) return null;
  const pm = detection.packageManager;
  const id = `pm-use-${slug(pm)}`;
  const sources: KnowledgeSource[] = [
    { kind: "bootstrap", ref: `file/${detectionLockfile(pm)}` },
  ];
  const fm = {
    ...baseFrontmatter(
      id,
      "convention",
      `This project uses ${pm}`,
      sources,
      ["tooling", "package-manager"],
    ),
    rule: `Always use ${pm} for installs, scripts, and lockfile operations.`,
    enforcement: "lint" as const,
    scope: ["**/*"],
  };
  const body = [
    `Detected from \`${detectionLockfile(pm)}\`.`,
    "",
    "**How to apply:** Replace any other package-manager command (npm/yarn/pip/etc.) with the equivalent",
    `\`${pm}\` invocation. Do not commit competing lockfiles.`,
  ].join("\n");
  return { frontmatter: fm, body };
}

function detectionLockfile(pm: string): string {
  switch (pm) {
    case "pnpm":
      return "pnpm-lock.yaml";
    case "yarn":
      return "yarn.lock";
    case "bun":
      return "bun.lockb";
    case "npm":
      return "package-lock.json";
    case "uv":
      return "uv.lock";
    case "poetry":
      return "poetry.lock";
    case "pipenv":
      return "Pipfile.lock";
    default:
      return pm;
  }
}

function testRunnerEntry(detection: StackDetection, ts: TestRunnerSignal): DraftEntry | null {
  if (!detection.testRunner) return null;
  const id = `test-runner-${slug(detection.testRunner)}`;
  const sources: KnowledgeSource[] = [
    { kind: "bootstrap", ref: `file/${packageFileFor(detection.language)}` },
  ];
  if (ts.testFiles.length > 0) {
    sources.push({ kind: "bootstrap", ref: `file/${ts.testFiles[0]!}` });
  }
  const fm = {
    ...baseFrontmatter(
      id,
      "convention",
      `Tests run with ${detection.testRunner}`,
      sources,
      ["tooling", "tests"],
    ),
    rule: `Run tests via \`${detection.testRunner}\`. Test files live in: ${
      ts.testDirs.slice(0, 3).join(", ") || "(no tests detected yet)"
    }.`,
    enforcement: "ci" as const,
  };
  const body = [
    `Detected ${ts.testFiles.length} test file(s) across ${ts.testDirs.length} dir(s).`,
    ts.testDirs.length > 0 ? `\nTop dirs:\n${ts.testDirs.slice(0, 5).map((d) => `- ${d}`).join("\n")}` : "",
  ]
    .join("\n")
    .trim();
  return { frontmatter: fm, body };
}

function packageFileFor(lang: string): string {
  switch (lang) {
    case "node":
      return "package.json";
    case "python":
      return "pyproject.toml";
    case "go":
      return "go.mod";
    case "rust":
      return "Cargo.toml";
    default:
      return "(unknown)";
  }
}

function frameworkEntry(detection: StackDetection): DraftEntry | null {
  if (detection.frameworks.length === 0) return null;
  const id = `stack-frameworks-${slug(detection.frameworks.join("-"))}`.slice(0, 64);
  const fm = {
    ...baseFrontmatter(
      id,
      "convention",
      `Project uses ${detection.frameworks.join(", ")}`,
      [{ kind: "bootstrap", ref: `file/${packageFileFor(detection.language)}` }],
      ["stack", "framework"],
    ),
    rule: `Stay within ${detection.frameworks.join(", ")} idioms unless a decision says otherwise.`,
    enforcement: "manual" as const,
  };
  const body = `Detected frameworks: ${detection.frameworks.join(", ")}.`;
  return { frontmatter: fm, body };
}

function ciStepConventionEntry(ci: CiSignal): DraftEntry | null {
  if (!ci.available || ci.workflows.length === 0) return null;
  const seen = new Set<string>();
  const steps: string[] = [];
  for (const wf of ci.workflows) {
    for (const s of wf.steps) {
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      if (/(\b(test|lint|typecheck|build|format|check|verify)\b)/i.test(s) && s.length < 120) {
        steps.push(s);
      }
    }
  }
  if (steps.length === 0) return null;
  const refFile = ci.workflows[0]!.file;
  const id = "ci-required-steps";
  const fm = {
    ...baseFrontmatter(
      id,
      "convention",
      "CI runs the following checks; keep them green",
      [{ kind: "bootstrap", ref: `file/${refFile}` }],
      ["ci", "tooling"],
    ),
    rule: `Before pushing, ensure these CI checks pass: ${steps.slice(0, 5).join("; ")}.`,
    enforcement: "ci" as const,
  };
  const body = [
    `Found ${ci.workflows.length} workflow file(s).`,
    "",
    "**Detected steps (first 10):**",
    ...steps.slice(0, 10).map((s) => `- ${s}`),
  ].join("\n");
  return { frontmatter: fm, body };
}

function topImportsPattern(ti: TopImportsSignal): DraftEntry | null {
  if (!ti.available || ti.ranked.length === 0) return null;
  const top3 = ti.ranked.slice(0, 3);
  if (top3.length === 0) return null;
  const id = `top-deps-${slug(top3.map((t) => t.pkg).join("-"))}`.slice(0, 64);
  const fm = {
    ...baseFrontmatter(
      id,
      "pattern",
      `Most-used dependencies: ${top3.map((t) => t.pkg).join(", ")}`,
      [{ kind: "bootstrap", ref: `file/${packageFileFor(ti.language)}` }],
      ["dependencies", "stack"],
    ),
    intent: "When a task involves any of these libraries, follow existing import sites for idioms.",
    applies_when: top3.map((t) => `Touching code that imports \`${t.pkg}\``),
  };
  const body = [
    "**Top dependencies by import frequency:**",
    "",
    ...ti.ranked.slice(0, 10).map((t) => `- \`${t.pkg}\` — ${t.count} file(s)`),
  ].join("\n");
  return { frontmatter: fm, body };
}

function readmeIntroDecision(rs: ReadmeSignal): DraftEntry | null {
  if (!rs.available || !rs.h1) return null;
  const id = `readme-intro-${slug(rs.h1)}`.slice(0, 64);
  const sources: KnowledgeSource[] = [
    { kind: "bootstrap", ref: `file/${rs.path}:1` },
  ];
  const fm = {
    ...baseFrontmatter(
      id,
      "decision",
      `Project identity per README: ${rs.h1}`.slice(0, 120),
      sources,
      ["readme", "identity"],
    ),
    decision: `Treat the project as: ${rs.h1}`,
    rationale: "First H1 of README is the canonical project identity.",
    outcome: "pending",
  };
  const body = [
    "## Context",
    `From \`${rs.path}\`.`,
    "",
    "## Decision",
    rs.h1,
    rs.gettingStarted ? `\n## Getting Started excerpt\n\n${rs.gettingStarted.body.slice(0, 800)}` : "",
  ]
    .join("\n")
    .trim();
  return { frontmatter: fm, body };
}

function gitConventionalCommitPattern(gl: GitLogSignal): DraftEntry | null {
  if (!gl.available) return null;
  if (gl.conventionalPrefixes.length === 0) return null;
  const total = gl.commitCount;
  const conv = gl.conventionalPrefixes.reduce((a, b) => a + b.count, 0);
  if (total === 0 || conv / total < 0.3) return null;
  const top = gl.conventionalPrefixes.slice(0, 5).map((p) => `${p.prefix} (${p.count})`).join(", ");
  const sources: KnowledgeSource[] = gl.recentCommits
    .slice(0, 2)
    .map((c) => ({ kind: "bootstrap" as const, ref: `git/${c.sha}` }));
  if (sources.length === 0) {
    sources.push({ kind: "bootstrap", ref: "git-log/last-200" });
  }
  const fm = {
    ...baseFrontmatter(
      "git-conventional-commits",
      "convention",
      "Commit messages follow Conventional Commits style",
      sources,
      ["git", "commits"],
    ),
    rule: "Use Conventional Commits prefixes (feat:, fix:, chore:, …) in commit subjects.",
    enforcement: "manual" as const,
  };
  const body = [
    `Observed ${conv}/${total} commits with conventional prefixes.`,
    "",
    `Top prefixes: ${top}.`,
  ].join("\n");
  return { frontmatter: fm, body };
}

function gitFixGotcha(gl: GitLogSignal): DraftEntry | null {
  if (!gl.available) return null;
  const fixCount = gl.conventionalPrefixes.find((p) => p.prefix === "fix")?.count ?? 0;
  if (fixCount < 5) return null;
  const fixCommits = gl.recentCommits.filter((c) => /^fix(\(.+\))?[!:]?:?\s/i.test(c.subject));
  if (fixCommits.length === 0) return null;
  const sources: KnowledgeSource[] = fixCommits.slice(0, 3).map((c) => ({
    kind: "bootstrap" as const,
    ref: `git/${c.sha}`,
    note: c.subject.slice(0, 120),
  }));
  const fm = {
    ...baseFrontmatter(
      "recurring-fix-area",
      "gotcha",
      "Recurring fix commits suggest an error-prone area",
      sources,
      ["bugs", "git"],
    ),
    symptom: `Multiple recent commits prefixed \`fix:\` (${fixCount} in last ${gl.commitCount}).`,
    resolution:
      "Review the cited fix commits as a cluster; if a common root cause emerges, propose a sharper gotcha or pattern entry replacing this stub.",
  };
  const body = [
    "**Recent fix commits:**",
    "",
    ...fixCommits.slice(0, 5).map((c) => `- \`${c.sha}\` ${c.subject}`),
  ].join("\n");
  return { frontmatter: fm, body };
}

function openPrsDecision(prs: OpenPrsSignal): DraftEntry | null {
  if (!prs.available || prs.prs.length === 0) return null;
  const sources: KnowledgeSource[] = prs.prs
    .slice(0, 3)
    .map((p) => ({ kind: "bootstrap" as const, ref: `pr/${p.number}`, note: p.title.slice(0, 120) }));
  const fm = {
    ...baseFrontmatter(
      "open-pr-themes",
      "decision",
      `${prs.prs.length} open PR(s) at bootstrap time`,
      sources,
      ["prs", "in-flight"],
    ),
    decision: "Treat the cited PRs as in-flight context; their changes may land soon.",
    rationale: "Open PRs at bootstrap time often hint at pending conventions or migrations.",
    outcome: "pending",
  };
  const body = [
    "**Open PRs (titles only):**",
    "",
    ...prs.prs.slice(0, 5).map((p) => `- #${p.number} — ${p.title}`),
  ].join("\n");
  return { frontmatter: fm, body };
}

export function proposeDrafts(
  signals: Signal[],
  detection: StackDetection,
): DraftEntry[] {
  const drafts: DraftEntry[] = [];
  const gl = signals.find((s): s is GitLogSignal => s.kind === "git-log");
  const rs = signals.find((s): s is ReadmeSignal => s.kind === "readme");
  const ti = signals.find((s): s is TopImportsSignal => s.kind === "top-imports");
  const ts = signals.find((s): s is TestRunnerSignal => s.kind === "test-runner");
  const prs = signals.find((s): s is OpenPrsSignal => s.kind === "open-prs");
  const ci = signals.find((s): s is CiSignal => s.kind === "ci");

  const push = (d: DraftEntry | null): void => {
    if (d) drafts.push(d);
  };

  push(packageManagerEntry(detection));
  push(frameworkEntry(detection));
  if (ts) push(testRunnerEntry(detection, ts));
  if (ci) push(ciStepConventionEntry(ci));
  if (ti) push(topImportsPattern(ti));
  if (rs) push(readmeIntroDecision(rs));
  if (gl) push(gitConventionalCommitPattern(gl));
  if (gl) push(gitFixGotcha(gl));
  if (prs) push(openPrsDecision(prs));

  const seen = new Set<string>();
  return drafts.filter((d) => {
    const id = d.frontmatter.id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function pendingStackBody(
  detection: StackDetection,
  signals: Signal[],
): string {
  const gl = signals.find((s): s is GitLogSignal => s.kind === "git-log");
  const rs = signals.find((s): s is ReadmeSignal => s.kind === "readme");
  const ti = signals.find((s): s is TopImportsSignal => s.kind === "top-imports");
  const ts = signals.find((s): s is TestRunnerSignal => s.kind === "test-runner");
  const ci = signals.find((s): s is CiSignal => s.kind === "ci");

  const lines: string[] = [];
  lines.push("# Pending stack summary (PROPOSED)");
  lines.push("");
  lines.push("Auto-detected stack profile. Move into `.apex/knowledge/conventions/` after review.");
  lines.push("");
  lines.push("## Detected");
  lines.push("");
  lines.push(`- Language: \`${detection.language}\``);
  if (detection.frameworks.length > 0)
    lines.push(`- Frameworks: ${detection.frameworks.map((f) => `\`${f}\``).join(", ")}`);
  if (detection.packageManager)
    lines.push(`- Package manager: \`${detection.packageManager}\``);
  if (detection.testRunner) lines.push(`- Test runner: \`${detection.testRunner}\``);
  if (detection.lint.length > 0)
    lines.push(`- Lint: ${detection.lint.map((l) => `\`${l}\``).join(", ")}`);
  if (detection.format.length > 0)
    lines.push(`- Formatter: ${detection.format.map((l) => `\`${l}\``).join(", ")}`);
  if (detection.ci.length > 0)
    lines.push(`- CI: ${detection.ci.map((l) => `\`${l}\``).join(", ")}`);
  lines.push(`- TypeScript: ${detection.hasTypeScript ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Signals");
  lines.push("");
  lines.push(`- git log: ${gl?.available ? `${gl.commitCount} commits scanned` : `skipped (${gl?.reason ?? "unavailable"})`}`);
  lines.push(`- README: ${rs?.available ? `\`${rs.path}\`${rs.h1 ? ` — "${rs.h1}"` : ""}` : `skipped (${rs?.reason ?? "unavailable"})`}`);
  lines.push(`- Top imports: ${ti?.available ? `${ti.ranked.length} ranked` : `skipped (${ti?.reason ?? "unavailable"})`}`);
  lines.push(`- Tests: ${ts?.available ? `${ts.testFiles.length} files` : `skipped (${ts?.reason ?? "unavailable"})`}`);
  lines.push(`- CI: ${ci?.available ? `${ci.workflows.length} workflow(s)` : `skipped (${ci?.reason ?? "unavailable"})`}`);
  lines.push("");
  lines.push("Confidence: **low** (auto-detected, unverified).");
  return lines.join("\n");
}
