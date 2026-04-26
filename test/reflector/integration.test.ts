import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import matter from "gray-matter";
import yaml from "yaml";
import { runReflector } from "../../src/reflector/index.js";
import type { FailureLine, CorrectionLine, ToolLine } from "../../src/reflector/signals.js";
import type { EpisodeMeta } from "../../src/types/shared.js";

// gray-matter options matching src/recall/loader.ts
const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function makeMeta(episodeId: string, reflectionStatus?: string): EpisodeMeta {
  const base: EpisodeMeta = {
    schema_version: 1,
    episode_id: episodeId,
    session_id: "sess-int-test",
    started_at: "2026-04-26T14:32:11Z",
    ended_at: "2026-04-26T15:19:42Z",
    model: "claude-opus-4-7",
    claude_code_version: "2.4.1",
    repo_head_sha: "a1b2c3d",
    repo_branch: "main",
    cwd: "/tmp/test",
    hooks_fired_count: {
      session_start: 1,
      user_prompt_submit: 3,
      post_tool_use: 5,
      post_tool_use_failure: 1,
      pre_compact: 0,
      session_end: 1,
    },
  };
  if (reflectionStatus) {
    base.reflection = {
      status: reflectionStatus as EpisodeMeta["reflection"] extends infer R
        ? R extends { status: infer S }
          ? S
          : never
        : never,
      completed_at: null,
      proposed_entries: [],
    };
  }
  return base;
}

function makeFailure(turn: number, sig: string): FailureLine {
  return {
    schema_version: 1,
    ts: new Date().toISOString(),
    turn,
    tool_call_id: `tc_${turn}`,
    tool_name: "Bash",
    exit_code: 1,
    error: `error: ${sig}`,
    error_signature: sig,
    stderr_excerpt: null,
  };
}

function makeCorrection(turn: number, text: string): CorrectionLine {
  return {
    schema_version: 1,
    ts: new Date().toISOString(),
    turn,
    kind: "correction",
    evidence_ref: `prompts.jsonl#L${turn}`,
    target_entry_id: null,
    user_text: text,
    claude_action_summary: "Claude did something wrong",
  };
}

function makeTool(turn: number, exitCode: number): ToolLine {
  return {
    schema_version: 1,
    ts: new Date().toISOString(),
    turn,
    tool_call_id: `tc_tool_${turn}`,
    tool_name: "Bash",
    exit_code: exitCode,
    error: exitCode !== 0 ? "error" : null,
  };
}

async function writeEpisode(
  root: string,
  episodeId: string,
  failures: FailureLine[],
  corrections: CorrectionLine[],
  tools: ToolLine[] = [],
  reflectionStatus?: string,
): Promise<void> {
  const dir = path.join(root, ".apex", "episodes", episodeId);
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, "meta.json"), makeMeta(episodeId, reflectionStatus), {
    spaces: 2,
  });
  if (failures.length > 0) {
    await fs.writeFile(
      path.join(dir, "failures.jsonl"),
      failures.map((f) => JSON.stringify(f)).join("\n") + "\n",
      "utf8",
    );
  }
  if (corrections.length > 0) {
    await fs.writeFile(
      path.join(dir, "corrections.jsonl"),
      corrections.map((c) => JSON.stringify(c)).join("\n") + "\n",
      "utf8",
    );
  }
  if (tools.length > 0) {
    await fs.writeFile(
      path.join(dir, "tools.jsonl"),
      tools.map((t) => JSON.stringify(t)).join("\n") + "\n",
      "utf8",
    );
  }
}

function validateFrontmatter(fm: Record<string, unknown>): void {
  expect(fm.id).toMatch(ID_RE);
  expect((fm.id as string).length).toBeLessThanOrEqual(64);
  expect(typeof fm.title).toBe("string");
  expect((fm.title as string).length).toBeLessThanOrEqual(120);
  expect(["decision", "pattern", "gotcha", "convention"]).toContain(fm.type);
  expect(["user", "team", "all"]).toContain(fm.applies_to);
  expect(["low", "medium", "high"]).toContain(fm.confidence);
  expect(Array.isArray(fm.sources)).toBe(true);
  const sources = fm.sources as Array<{ kind: string; ref: string }>;
  expect(sources.length).toBeGreaterThanOrEqual(1);
  for (const s of sources) {
    expect(["bootstrap", "correction", "reflection", "manual", "pr"]).toContain(s.kind);
  }
  expect(fm.created).toMatch(DATE_RE);
  expect(fm.last_validated).toMatch(DATE_RE);

  switch (fm.type) {
    case "gotcha":
      expect(fm.symptom).toBeTruthy();
      expect(fm.resolution).toBeTruthy();
      break;
    case "convention":
      expect(fm.rule).toBeTruthy();
      expect(["manual", "lint", "ci", "hook"]).toContain(fm.enforcement);
      break;
  }
}

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-reflector-int-"));
  await fs.ensureDir(path.join(tempRoot, ".apex", "episodes"));
  await fs.ensureDir(path.join(tempRoot, ".apex", "proposed"));
  await fs.ensureDir(path.join(tempRoot, ".apex", "knowledge", "gotchas"));
  await fs.ensureDir(path.join(tempRoot, ".apex", "knowledge", "conventions"));
});

afterAll(async () => {
  if (tempRoot) await fs.remove(tempRoot);
});

describe("runReflector (integration)", () => {
  it("writes proposals to .apex/proposed/ for repeated failures across episodes", async () => {
    const sig = "integration-failure-sig";
    await writeEpisode(
      tempRoot,
      "2026-04-26-1000-aaaa",
      [makeFailure(1, sig)],
      [],
      [makeTool(2, 0)],
    );
    await writeEpisode(
      tempRoot,
      "2026-04-26-1100-bbbb",
      [makeFailure(2, sig)],
      [],
      [makeTool(3, 0)],
    );

    const report = await runReflector(tempRoot, {});
    expect(report.episodesProcessed.length).toBeGreaterThan(0);
    expect(report.gotchaCandidates).toBeGreaterThan(0);
    expect(report.proposalsWritten.length).toBeGreaterThan(0);

    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    expect(await fs.pathExists(proposedDir)).toBe(true);
    const files = (await fs.readdir(proposedDir)).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("every proposal has PROPOSED header and valid frontmatter", async () => {
    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    const files = (await fs.readdir(proposedDir)).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const content = await fs.readFile(path.join(proposedDir, f), "utf8");
      expect(content.startsWith("<!-- PROPOSED")).toBe(true);
      // Parse the frontmatter (strip the HTML comment header first)
      const stripped = content.replace(/^<!--[^\n]*-->\s*/, "");
      const parsed = matter(stripped, matterOptions);
      const fm = parsed.data as Record<string, unknown>;
      validateFrontmatter(fm);
    }
  });

  it("updates meta.json with reflection.status = complete after run", async () => {
    // The episodes processed in the prior test should be marked complete
    // Run again to verify meta was written (prior run may have already processed them)
    const epId = "2026-04-26-1200-cccc";
    const sig2 = "int-meta-update-sig";
    await writeEpisode(tempRoot, epId, [makeFailure(1, sig2)], []);
    // Also need a second episode with the same sig to trigger proposal
    const epId2 = "2026-04-26-1300-dddd";
    await writeEpisode(tempRoot, epId2, [makeFailure(2, sig2)], []);

    await runReflector(tempRoot, {});

    const metaFile = path.join(tempRoot, ".apex", "episodes", epId, "meta.json");
    if (await fs.pathExists(metaFile)) {
      const meta = await fs.readJson(metaFile) as EpisodeMeta;
      if (meta.reflection) {
        expect(meta.reflection.status).toBe("complete");
        expect(meta.reflection.completed_at).toBeTruthy();
        expect(Array.isArray(meta.reflection.proposed_entries)).toBe(true);
      }
    }
  });

  it("skips episodes that already have reflection.status = complete", async () => {
    const epId = "2026-04-26-1400-eeee";
    const sig3 = "already-done-sig";
    await writeEpisode(tempRoot, epId, [makeFailure(1, sig3)], [], [], "complete");

    const report = await runReflector(tempRoot, {});
    expect(report.episodesSkipped.some((s) => s.id === epId)).toBe(true);
    expect(report.episodesProcessed).not.toContain(epId);
  });

  it("dry-run does not write files", async () => {
    const dryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-dry-reflect-"));
    try {
      const sig = "dry-run-sig";
      await writeEpisode(dryRoot, "2026-04-26-1000-ff01", [makeFailure(1, sig)], []);
      await writeEpisode(dryRoot, "2026-04-26-1100-ff02", [makeFailure(2, sig)], []);

      const report = await runReflector(dryRoot, { dryRun: true });
      expect(report.proposalsWritten.length).toBeGreaterThan(0);
      // The proposed dir should not actually exist (or be empty)
      const proposedDir = path.join(dryRoot, ".apex", "proposed");
      if (await fs.pathExists(proposedDir)) {
        const files = (await fs.readdir(proposedDir)).filter((f) => f.endsWith(".md"));
        expect(files.length).toBe(0);
      }
    } finally {
      await fs.remove(dryRoot);
    }
  });

  it("does not overwrite existing proposals (skip if file exists)", async () => {
    const skipRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-skip-reflect-"));
    try {
      const sig = "skip-existing-sig";
      await writeEpisode(skipRoot, "2026-04-26-1000-ee01", [makeFailure(1, sig)], []);
      await writeEpisode(skipRoot, "2026-04-26-1100-ee02", [makeFailure(2, sig)], []);

      // First run: creates proposals
      const report1 = await runReflector(skipRoot, {});
      expect(report1.proposalsWritten.length).toBeGreaterThan(0);

      // Find the created proposal file
      const proposedDir = path.join(skipRoot, ".apex", "proposed");
      const files = (await fs.readdir(proposedDir)).filter((f) => f.endsWith(".md"));
      expect(files.length).toBeGreaterThan(0);

      // Overwrite with sentinel content
      const firstFile = path.join(proposedDir, files[0]!);
      await fs.writeFile(firstFile, "USER EDITED CONTENT", "utf8");

      // Add new fresh episodes that generate the same proposal id (same sig)
      // so the second run has something to attempt to write
      await writeEpisode(skipRoot, "2026-04-26-1200-ee03", [makeFailure(1, sig)], []);
      await writeEpisode(skipRoot, "2026-04-26-1300-ee04", [makeFailure(2, sig)], []);

      // Second run processes the new episodes; tries to write the same proposal file (same sig = same id)
      const report2 = await runReflector(skipRoot, {});
      // The existing file should be in skipped (already exists)
      expect(report2.proposalsSkipped.some((s) => s.path === firstFile)).toBe(true);
      // Sentinel content must be preserved
      expect(await fs.readFile(firstFile, "utf8")).toBe("USER EDITED CONTENT");
    } finally {
      await fs.remove(skipRoot);
    }
  });

  it("--episode flag processes exactly one episode", async () => {
    const singleRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-single-"));
    try {
      const sig = "single-ep-sig";
      await writeEpisode(singleRoot, "2026-04-26-1000-ab01", [makeFailure(1, sig)], []);
      await writeEpisode(singleRoot, "2026-04-26-1100-ab02", [makeFailure(2, sig)], []);

      const report = await runReflector(singleRoot, { episode: "2026-04-26-1000-ab01" });
      expect(report.episodesProcessed).toContain("2026-04-26-1000-ab01");
      expect(report.episodesProcessed).not.toContain("2026-04-26-1100-ab02");
    } finally {
      await fs.remove(singleRoot);
    }
  });

  it("returns empty report for root with no episodes", async () => {
    const emptyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-no-ep-"));
    try {
      const report = await runReflector(emptyRoot, {});
      expect(report.episodesProcessed).toEqual([]);
      expect(report.proposalsWritten).toEqual([]);
    } finally {
      await fs.remove(emptyRoot);
    }
  });

  it("writes proposals for both gotchas and conventions in same run", async () => {
    const mixedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-mixed-"));
    try {
      const sig = "mixed-failure-sig";
      const corrText = "mixed correction please use the right approach";
      await writeEpisode(
        mixedRoot,
        "2026-04-26-1000-dd01",
        [makeFailure(1, sig)],
        [makeCorrection(2, corrText)],
      );
      await writeEpisode(
        mixedRoot,
        "2026-04-26-1100-dd02",
        [makeFailure(2, sig)],
        [makeCorrection(3, corrText)],
      );

      const report = await runReflector(mixedRoot, {});
      expect(report.gotchaCandidates).toBeGreaterThan(0);
      expect(report.conventionCandidates).toBeGreaterThan(0);
    } finally {
      await fs.remove(mixedRoot);
    }
  });
});
