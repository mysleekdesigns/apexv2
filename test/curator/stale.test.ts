import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { findStaleEntries } from "../../src/curator/stale.js";
import type { KnowledgeEntry } from "../../src/types/shared.js";
import type { RetrievalLine } from "../../src/episode/writer.js";

function makeEntry(id: string, lastValidated: string): KnowledgeEntry {
  return {
    frontmatter: {
      id,
      type: "decision",
      title: `Entry ${id}`,
      applies_to: "all",
      confidence: "medium",
      sources: [{ kind: "manual", ref: "manual/test" }],
      created: "2025-01-01",
      last_validated: lastValidated,
    },
    body: "Some body content.",
    path: `.apex/knowledge/decisions/${id}.md`,
  };
}

function makeRetrievalLine(entryId: string, ts: string): RetrievalLine {
  return {
    schema_version: 1,
    ts,
    turn: 1,
    entry_id: entryId,
    entry_type: "decision",
    rank: 1,
    score: 0.9,
    surfaced: true,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-stale-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("findStaleEntries", () => {
  const NOW = new Date("2026-04-26T12:00:00Z");
  const STALE_DAYS = 30;

  it("returns empty array for empty entries", () => {
    expect(findStaleEntries([], tmpDir, NOW, STALE_DAYS)).toEqual([]);
  });

  it("does not flag entries validated within staleDays", () => {
    // last_validated = 10 days ago — not stale
    const entry = makeEntry("fresh-entry", "2026-04-16");
    const result = findStaleEntries([entry], tmpDir, NOW, STALE_DAYS);
    expect(result).toHaveLength(0);
  });

  it("flags entries where last_validated is older than staleDays and not retrieved", () => {
    // last_validated = 60 days ago — stale
    const entry = makeEntry("old-entry", "2026-02-25");
    const result = findStaleEntries([entry], tmpDir, NOW, STALE_DAYS);
    expect(result).toHaveLength(1);
    expect(result[0]!.entry.frontmatter.id).toBe("old-entry");
    expect(result[0]!.daysSinceValidated).toBeGreaterThan(30);
  });

  it("does not flag stale entries that were recently retrieved", () => {
    // last_validated = 60 days ago — but retrieved 5 days ago
    const entry = makeEntry("retrieved-entry", "2026-02-25");

    // Write a retrievals.jsonl for an episode
    const episodeDir = path.join(tmpDir, "ep-001");
    fs.mkdirSync(episodeDir, { recursive: true });
    const retrieval = makeRetrievalLine("retrieved-entry", "2026-04-21T10:00:00Z"); // 5 days ago
    fs.writeFileSync(
      path.join(episodeDir, "retrievals.jsonl"),
      JSON.stringify(retrieval) + "\n",
      "utf8",
    );

    const result = findStaleEntries([entry], tmpDir, NOW, STALE_DAYS);
    expect(result).toHaveLength(0);
  });

  it("flags stale entries whose retrieval is older than staleDays", () => {
    // last_validated = 60 days ago, retrieved = 45 days ago (also stale)
    const entry = makeEntry("old-retrieved-entry", "2026-02-25");

    const episodeDir = path.join(tmpDir, "ep-002");
    fs.mkdirSync(episodeDir, { recursive: true });
    const retrieval = makeRetrievalLine("old-retrieved-entry", "2026-03-12T10:00:00Z"); // ~45 days ago
    fs.writeFileSync(
      path.join(episodeDir, "retrievals.jsonl"),
      JSON.stringify(retrieval) + "\n",
      "utf8",
    );

    const result = findStaleEntries([entry], tmpDir, NOW, STALE_DAYS);
    expect(result).toHaveLength(1);
    expect(result[0]!.entry.frontmatter.id).toBe("old-retrieved-entry");
  });

  it("handles missing episodes directory gracefully", () => {
    const nonexistent = path.join(tmpDir, "does-not-exist");
    const entry = makeEntry("lonely-entry", "2026-01-01");
    const result = findStaleEntries([entry], nonexistent, NOW, STALE_DAYS);
    // No episodes dir = no recent retrievals, so stale if old
    expect(result).toHaveLength(1);
  });

  it("handles empty episodes directory gracefully", () => {
    // tmpDir exists but has no episode subdirs
    const entry = makeEntry("another-old", "2026-01-01");
    const result = findStaleEntries([entry], tmpDir, NOW, STALE_DAYS);
    expect(result).toHaveLength(1);
  });

  it("handles malformed retrievals.jsonl lines without crashing", () => {
    const entry = makeEntry("malformed-ep-entry", "2026-01-01");
    const episodeDir = path.join(tmpDir, "ep-bad");
    fs.mkdirSync(episodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(episodeDir, "retrievals.jsonl"),
      "not-valid-json\n{\"partial: true\n",
      "utf8",
    );
    // Should not throw
    expect(() =>
      findStaleEntries([entry], tmpDir, NOW, STALE_DAYS),
    ).not.toThrow();
  });

  it("reads across multiple episode directories", () => {
    // entry is old but retrieved in each of two episodes
    const entry = makeEntry("multi-ep-entry", "2026-02-01");

    for (const epId of ["ep-003", "ep-004"]) {
      const episodeDir = path.join(tmpDir, epId);
      fs.mkdirSync(episodeDir, { recursive: true });
      const retrieval = makeRetrievalLine("multi-ep-entry", "2026-04-20T09:00:00Z");
      fs.writeFileSync(
        path.join(episodeDir, "retrievals.jsonl"),
        JSON.stringify(retrieval) + "\n",
        "utf8",
      );
    }

    const result = findStaleEntries([entry], tmpDir, NOW, STALE_DAYS);
    expect(result).toHaveLength(0);
  });

  it("includes daysSinceValidated in the result", () => {
    const entry = makeEntry("check-age", "2026-01-26"); // exactly 90 days before NOW
    const result = findStaleEntries([entry], tmpDir, NOW, STALE_DAYS);
    expect(result).toHaveLength(1);
    expect(result[0]!.daysSinceValidated).toBe(90);
  });
});
