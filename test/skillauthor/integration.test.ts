import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { runSkillAuthor } from "../../src/skillauthor/index.js";
import { SKILL_PROPOSED_HEADER } from "../../src/skillauthor/writer.js";
import { writeSkillDrafts } from "../../src/skillauthor/writer.js";
import type { SkillDraft } from "../../src/skillauthor/proposer.js";

// ---- helpers ------------------------------------------------------------------

interface FakeToolLine {
  schema_version: 1;
  ts: string;
  turn: number;
  tool_call_id: string;
  tool_name: string;
  exit_code: number;
  error: null;
}

function makeTool(turn: number, toolName: string): FakeToolLine {
  return {
    schema_version: 1,
    ts: new Date().toISOString(),
    turn,
    tool_call_id: `tc_${turn}`,
    tool_name: toolName,
    exit_code: 0,
    error: null,
  };
}

function makeMeta(episodeId: string): object {
  return {
    schema_version: 1,
    episode_id: episodeId,
    session_id: "sess-skillauthor-test",
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
      post_tool_use_failure: 0,
      pre_compact: 0,
      session_end: 1,
    },
  };
}

async function writeEpisode(
  root: string,
  episodeId: string,
  tools: FakeToolLine[],
): Promise<void> {
  const dir = path.join(root, ".apex", "episodes", episodeId);
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, "meta.json"), makeMeta(episodeId), { spaces: 2 });
  if (tools.length > 0) {
    await fs.writeFile(
      path.join(dir, "tools.jsonl"),
      tools.map((t) => JSON.stringify(t)).join("\n") + "\n",
      "utf8",
    );
  }
}

// ---- fixtures -----------------------------------------------------------------

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-skillauthor-int-"));
  await fs.ensureDir(path.join(tempRoot, ".apex", "episodes"));
});

afterAll(async () => {
  if (tempRoot) await fs.remove(tempRoot);
});

// ---- tests --------------------------------------------------------------------

describe("runSkillAuthor (integration)", () => {
  it("detects repeated shape and writes .apex/proposed-skills/<slug>/SKILL.md", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-sa-basic-"));
    try {
      // 3 episodes each with the same "Bash,Edit,Bash" pattern
      await writeEpisode(root, "2026-04-26-1000-aa01", [
        makeTool(1, "Bash"),
        makeTool(2, "Edit"),
        makeTool(3, "Bash"),
      ]);
      await writeEpisode(root, "2026-04-26-1100-aa02", [
        makeTool(1, "Bash"),
        makeTool(2, "Edit"),
        makeTool(3, "Bash"),
      ]);
      await writeEpisode(root, "2026-04-26-1200-aa03", [
        makeTool(1, "Bash"),
        makeTool(2, "Edit"),
        makeTool(3, "Bash"),
      ]);

      const report = await runSkillAuthor(root, { threshold: 3 });
      expect(report.patternsDetected).toBeGreaterThan(0);
      expect(report.drafted).toBeGreaterThan(0);
      expect(report.written.length).toBeGreaterThan(0);

      // Verify the file was written
      const proposedSkillsDir = path.join(root, ".apex", "proposed-skills");
      expect(await fs.pathExists(proposedSkillsDir)).toBe(true);

      const slugDirs = await fs.readdir(proposedSkillsDir);
      expect(slugDirs.length).toBeGreaterThan(0);

      for (const slug of slugDirs) {
        const skillFile = path.join(proposedSkillsDir, slug, "SKILL.md");
        expect(await fs.pathExists(skillFile)).toBe(true);
      }
    } finally {
      await fs.remove(root);
    }
  });

  it("written SKILL.md starts with PROPOSED header and has valid frontmatter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-sa-fmt-"));
    try {
      await writeEpisode(root, "2026-04-26-1000-bb01", [
        makeTool(1, "Read"),
        makeTool(2, "Edit"),
        makeTool(3, "Bash"),
      ]);
      await writeEpisode(root, "2026-04-26-1100-bb02", [
        makeTool(1, "Read"),
        makeTool(2, "Edit"),
        makeTool(3, "Bash"),
      ]);
      await writeEpisode(root, "2026-04-26-1200-bb03", [
        makeTool(1, "Read"),
        makeTool(2, "Edit"),
        makeTool(3, "Bash"),
      ]);

      await runSkillAuthor(root, { threshold: 3 });

      const proposedSkillsDir = path.join(root, ".apex", "proposed-skills");
      const slugDirs = await fs.readdir(proposedSkillsDir);

      for (const slug of slugDirs) {
        const skillFile = path.join(proposedSkillsDir, slug, "SKILL.md");
        const content = await fs.readFile(skillFile, "utf8");

        // Must start with the PROPOSED header
        expect(content.startsWith(SKILL_PROPOSED_HEADER)).toBe(true);

        // Must contain YAML frontmatter block
        expect(content).toContain("---");
        expect(content).toContain("name: apex-auto-");
        expect(content).toContain("description:");
      }
    } finally {
      await fs.remove(root);
    }
  });

  it("dry-run does not write files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-sa-dry-"));
    try {
      await writeEpisode(root, "2026-04-26-1000-cc01", [
        makeTool(1, "Bash"),
        makeTool(2, "Write"),
      ]);
      await writeEpisode(root, "2026-04-26-1100-cc02", [
        makeTool(1, "Bash"),
        makeTool(2, "Write"),
      ]);
      await writeEpisode(root, "2026-04-26-1200-cc03", [
        makeTool(1, "Bash"),
        makeTool(2, "Write"),
      ]);

      const report = await runSkillAuthor(root, { threshold: 3, dryRun: true });
      expect(report.written.length).toBeGreaterThan(0); // Would-be written paths returned

      const proposedSkillsDir = path.join(root, ".apex", "proposed-skills");
      // Directory should not exist in dry-run mode
      if (await fs.pathExists(proposedSkillsDir)) {
        const dirs = await fs.readdir(proposedSkillsDir);
        expect(dirs).toHaveLength(0);
      } else {
        expect(await fs.pathExists(proposedSkillsDir)).toBe(false);
      }
    } finally {
      await fs.remove(root);
    }
  });

  it("returns empty report for root with no episodes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-sa-empty-"));
    try {
      const report = await runSkillAuthor(root, { threshold: 3 });
      expect(report.patternsDetected).toBe(0);
      expect(report.drafted).toBe(0);
      expect(report.written).toHaveLength(0);
    } finally {
      await fs.remove(root);
    }
  });

  it("does not overwrite existing SKILL.md files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-sa-nooverwrite-"));
    try {
      await writeEpisode(root, "2026-04-26-1000-dd01", [
        makeTool(1, "Bash"),
        makeTool(2, "Edit"),
        makeTool(3, "Bash"),
      ]);
      await writeEpisode(root, "2026-04-26-1100-dd02", [
        makeTool(1, "Bash"),
        makeTool(2, "Edit"),
        makeTool(3, "Bash"),
      ]);
      await writeEpisode(root, "2026-04-26-1200-dd03", [
        makeTool(1, "Bash"),
        makeTool(2, "Edit"),
        makeTool(3, "Bash"),
      ]);

      // First run
      const report1 = await runSkillAuthor(root, { threshold: 3 });
      expect(report1.written.length).toBeGreaterThan(0);

      // Overwrite one of the written files with sentinel content
      const firstFile = report1.written[0]!;
      await fs.writeFile(firstFile, "USER EDITED CONTENT", "utf8");

      // Second run: should skip the existing file
      const report2 = await runSkillAuthor(root, { threshold: 3 });
      expect(report2.skipped.length).toBeGreaterThan(0);
      expect(await fs.readFile(firstFile, "utf8")).toBe("USER EDITED CONTENT");
    } finally {
      await fs.remove(root);
    }
  });

  it("respects the limit option", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-sa-limit-"));
    try {
      // Create episodes with many distinct patterns
      for (let i = 0; i < 3; i++) {
        await writeEpisode(root, `2026-04-26-100${i}-ee0${i}`, [
          makeTool(1, "Bash"),
          makeTool(2, "Edit"),
          makeTool(3, "Read"),
          makeTool(4, "Bash"),
          makeTool(5, "Write"),
          makeTool(6, "Read"),
          makeTool(7, "Bash"),
          makeTool(8, "Edit"),
          makeTool(9, "Bash"),
        ]);
      }

      const report = await runSkillAuthor(root, { threshold: 3, limit: 2 });
      expect(report.drafted).toBeLessThanOrEqual(2);
      expect(report.written.length).toBeLessThanOrEqual(2);
    } finally {
      await fs.remove(root);
    }
  });
});

describe("writeSkillDrafts (writer unit)", () => {
  it("refuses to overwrite existing file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-sa-writer-"));
    try {
      const draft: SkillDraft = {
        slug: "bash-edit",
        frontmatter: {
          name: "apex-auto-bash-edit",
          description: "Test description",
        },
        body: "# apex-auto-bash-edit\n\nTest body.",
      };

      // Write once
      const r1 = await writeSkillDrafts(root, [draft]);
      expect(r1.written).toHaveLength(1);
      expect(r1.skipped).toHaveLength(0);

      // Overwrite with sentinel
      await fs.writeFile(r1.written[0]!, "SENTINEL", "utf8");

      // Write again — must be skipped
      const r2 = await writeSkillDrafts(root, [draft]);
      expect(r2.written).toHaveLength(0);
      expect(r2.skipped).toHaveLength(1);
      expect(r2.skipped[0]!.slug).toBe("bash-edit");
      expect(r2.skipped[0]!.reason).toBe("exists");

      // Sentinel must be preserved
      expect(await fs.readFile(r1.written[0]!, "utf8")).toBe("SENTINEL");
    } finally {
      await fs.remove(root);
    }
  });

  it("dry-run returns would-be paths without writing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-sa-dry-writer-"));
    try {
      const draft: SkillDraft = {
        slug: "read-write",
        frontmatter: {
          name: "apex-auto-read-write",
          description: "Test dry run",
        },
        body: "# apex-auto-read-write\n\nDry run body.",
      };

      const r = await writeSkillDrafts(root, [draft], { dryRun: true });
      expect(r.written).toHaveLength(1);
      expect(r.written[0]).toContain("read-write");

      // No file should be written
      const skillDir = path.join(root, ".apex", "proposed-skills", "read-write");
      expect(await fs.pathExists(skillDir)).toBe(false);
    } finally {
      await fs.remove(root);
    }
  });

  it("written file contains PROPOSED header", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-sa-header-"));
    try {
      const draft: SkillDraft = {
        slug: "test-slug",
        frontmatter: {
          name: "apex-auto-test-slug",
          description: "Test header check",
        },
        body: "# apex-auto-test-slug\n\nBody content.",
      };

      const r = await writeSkillDrafts(root, [draft]);
      expect(r.written).toHaveLength(1);

      const content = await fs.readFile(r.written[0]!, "utf8");
      expect(content.startsWith(SKILL_PROPOSED_HEADER)).toBe(true);
    } finally {
      await fs.remove(root);
    }
  });
});
