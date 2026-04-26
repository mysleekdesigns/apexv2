import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { computeDashboard } from "../../src/dashboard/index.js";

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-dashboard-"));
  fs.mkdirSync(path.join(root, ".apex", "episodes"), { recursive: true });
  return root;
}

interface SeedOptions {
  episodeId: string;
  startedAtMsAgo: number;
  retrievals?: Array<{ entry_id: string; referenced?: boolean | null }>;
  corrections?: Array<{
    kind: "thumbs_up" | "thumbs_down" | "correction" | "confirmation";
    target_entry_id?: string | null;
  }>;
}

function seedEpisode(root: string, opts: SeedOptions): string {
  const dir = path.join(root, ".apex", "episodes", opts.episodeId);
  fs.mkdirSync(dir, { recursive: true });
  const startedAt = new Date(Date.now() - opts.startedAtMsAgo).toISOString();
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({ started_at: startedAt }),
    "utf8",
  );
  if (opts.retrievals) {
    const lines = opts.retrievals
      .map((r) =>
        JSON.stringify({
          schema_version: 1,
          ts: startedAt,
          turn: 0,
          entry_id: r.entry_id,
          entry_type: "convention",
          rank: 1,
          score: 1,
          surfaced: true,
          referenced: r.referenced ?? null,
        }),
      )
      .join("\n");
    fs.writeFileSync(path.join(dir, "retrievals.jsonl"), lines + "\n", "utf8");
  }
  if (opts.corrections) {
    const lines = opts.corrections
      .map((c) =>
        JSON.stringify({
          schema_version: 1,
          ts: startedAt,
          turn: 0,
          kind: c.kind,
          evidence_ref: "prompts.jsonl#turn=0",
          target_entry_id: c.target_entry_id ?? null,
        }),
      )
      .join("\n");
    fs.writeFileSync(path.join(dir, "corrections.jsonl"), lines + "\n", "utf8");
  }
  return dir;
}

describe("computeDashboard", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns zeros when no episodes exist", () => {
    const r = computeDashboard(root);
    expect(r.used).toBe(0);
    expect(r.helpful).toBe(0);
    expect(r.corrected).toBe(0);
    expect(r.unused).toBe(0);
    expect(r.episodesScanned).toBe(0);
    expect(r.line).toBe("APEX: 0 entries used last week");
  });

  it("renders the PRD example wording", () => {
    seedEpisode(root, {
      episodeId: "2026-04-26-1200-aaaa",
      startedAtMsAgo: 60_000,
      retrievals: [
        { entry_id: "use-pnpm", referenced: true },
        { entry_id: "auth-soft-delete", referenced: true },
        { entry_id: "lint-rule-x", referenced: false },
      ],
      corrections: [
        { kind: "thumbs_down", target_entry_id: "lint-rule-x" },
      ],
    });
    const r = computeDashboard(root);
    expect(r.used).toBe(3);
    expect(r.helpful).toBe(2);
    expect(r.corrected).toBe(1);
    expect(r.unused).toBe(0);
    expect(r.line).toBe(
      "APEX: 3 entries used last week (2 helpful, 1 corrected, 0 unused)",
    );
  });

  it("counts retrievals with referenced=true as helpful", () => {
    seedEpisode(root, {
      episodeId: "2026-04-26-1201-bbbb",
      startedAtMsAgo: 1000,
      retrievals: [{ entry_id: "x", referenced: true }],
    });
    const r = computeDashboard(root);
    expect(r.helpful).toBe(1);
    expect(r.unused).toBe(0);
  });

  it("counts retrievals with referenced=null as unused", () => {
    seedEpisode(root, {
      episodeId: "2026-04-26-1202-cccc",
      startedAtMsAgo: 1000,
      retrievals: [{ entry_id: "x" }],
    });
    const r = computeDashboard(root);
    expect(r.helpful).toBe(0);
    expect(r.corrected).toBe(0);
    expect(r.unused).toBe(1);
  });

  it("thumbs_up promotes an entry to helpful even without referenced=true", () => {
    seedEpisode(root, {
      episodeId: "2026-04-26-1203-dddd",
      startedAtMsAgo: 1000,
      retrievals: [{ entry_id: "x" }],
      corrections: [{ kind: "thumbs_up", target_entry_id: "x" }],
    });
    const r = computeDashboard(root);
    expect(r.helpful).toBe(1);
    expect(r.unused).toBe(0);
  });

  it("thumbs_up overrides thumbs_down when both target same entry", () => {
    seedEpisode(root, {
      episodeId: "2026-04-26-1204-eeee",
      startedAtMsAgo: 1000,
      retrievals: [{ entry_id: "x" }],
      corrections: [
        { kind: "thumbs_down", target_entry_id: "x" },
        { kind: "thumbs_up", target_entry_id: "x" },
      ],
    });
    const r = computeDashboard(root);
    expect(r.helpful).toBe(1);
    expect(r.corrected).toBe(0);
  });

  it("ignores episodes outside the window", () => {
    seedEpisode(root, {
      episodeId: "2026-04-26-1205-ffff",
      startedAtMsAgo: 30 * 86_400_000,
      retrievals: [{ entry_id: "old", referenced: true }],
    });
    seedEpisode(root, {
      episodeId: "2026-04-26-1206-1111",
      startedAtMsAgo: 60_000,
      retrievals: [{ entry_id: "new", referenced: true }],
    });
    const r = computeDashboard(root, { windowDays: 7 });
    expect(r.used).toBe(1);
    expect(r.helpful).toBe(1);
    expect(r.episodesScanned).toBe(1);
  });

  it("respects custom windowDays", () => {
    seedEpisode(root, {
      episodeId: "2026-04-26-1207-2222",
      startedAtMsAgo: 10 * 86_400_000,
      retrievals: [{ entry_id: "x", referenced: true }],
    });
    const widerLine = computeDashboard(root, { windowDays: 14 }).line;
    expect(widerLine).toContain("last 14 days");
    expect(widerLine).toContain("1 entries used");
    const narrowerLine = computeDashboard(root, { windowDays: 1 }).line;
    expect(narrowerLine).toBe("APEX: 0 entries used last 1 days");
  });

  it("dedupes the same entry retrieved across multiple episodes", () => {
    seedEpisode(root, {
      episodeId: "2026-04-26-1208-3333",
      startedAtMsAgo: 60_000,
      retrievals: [{ entry_id: "shared", referenced: true }],
    });
    seedEpisode(root, {
      episodeId: "2026-04-26-1209-4444",
      startedAtMsAgo: 30_000,
      retrievals: [{ entry_id: "shared", referenced: false }],
    });
    const r = computeDashboard(root);
    expect(r.used).toBe(1);
    expect(r.helpful).toBe(1);
  });

  it("tolerates malformed jsonl rows without throwing", () => {
    const dir = seedEpisode(root, {
      episodeId: "2026-04-26-1210-5555",
      startedAtMsAgo: 60_000,
      retrievals: [{ entry_id: "ok", referenced: true }],
    });
    fs.appendFileSync(
      path.join(dir, "retrievals.jsonl"),
      "{not json\n",
      "utf8",
    );
    const r = computeDashboard(root);
    expect(r.used).toBe(1);
  });

  it("falls back to mtime when meta.json is missing", () => {
    const dir = path.join(root, ".apex", "episodes", "2026-04-26-1211-6666");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "retrievals.jsonl"),
      JSON.stringify({
        schema_version: 1,
        ts: new Date().toISOString(),
        turn: 0,
        entry_id: "x",
        entry_type: "convention",
        rank: 1,
        score: 1,
        surfaced: true,
        referenced: true,
      }) + "\n",
      "utf8",
    );
    const r = computeDashboard(root);
    expect(r.used).toBe(1);
  });

  it("counts thumbs_down without retrievals as zero (not in 'used')", () => {
    seedEpisode(root, {
      episodeId: "2026-04-26-1212-7777",
      startedAtMsAgo: 60_000,
      corrections: [{ kind: "thumbs_down", target_entry_id: "ghost" }],
    });
    const r = computeDashboard(root);
    expect(r.used).toBe(0);
    expect(r.corrected).toBe(0);
    expect(r.line).toBe("APEX: 0 entries used last week");
  });

  it("ignores corrections without target_entry_id", () => {
    seedEpisode(root, {
      episodeId: "2026-04-26-1213-8888",
      startedAtMsAgo: 60_000,
      retrievals: [{ entry_id: "a" }],
      corrections: [{ kind: "correction", target_entry_id: null }],
    });
    const r = computeDashboard(root);
    expect(r.used).toBe(1);
    expect(r.corrected).toBe(0);
    expect(r.unused).toBe(1);
  });

  it("ignores non-episode directories", () => {
    fs.mkdirSync(path.join(root, ".apex", "episodes", "snapshots"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, ".apex", "episodes", ".current"),
      "anything",
      "utf8",
    );
    seedEpisode(root, {
      episodeId: "2026-04-26-1214-9999",
      startedAtMsAgo: 60_000,
      retrievals: [{ entry_id: "x", referenced: true }],
    });
    const r = computeDashboard(root);
    expect(r.episodesScanned).toBe(1);
    expect(r.used).toBe(1);
  });
});
