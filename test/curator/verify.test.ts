// Tests for the verify writer (Phase 4.3).
//
// Covers:
//   * Marking flagged entries with `verified: false` and `drift_report:` rows.
//   * Idempotence on re-run with the same hits.
//   * `last_validated` MUST NOT be touched by drift detection.
//   * Resolving drift removes `drift_report` rows and flips `verified: true`.
//   * Empty `drift_report` means the field is removed entirely.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import yaml from "yaml";
import matter from "gray-matter";
import { applyDriftFlags } from "../../src/curator/verify.js";
import { findAllDrift } from "../../src/curator/drift.js";
import { loadKnowledgeWithWarnings } from "../../src/recall/loader.js";
import type { DriftHit } from "../../src/curator/drift.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-verify-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeGotcha(
  id: string,
  extra: Record<string, unknown> = {},
  body = "Body content for the gotcha.",
): string {
  const dir = path.join(tmpDir, ".apex", "knowledge", "gotchas");
  fs.mkdirSync(dir, { recursive: true });
  const fm: Record<string, unknown> = {
    id,
    type: "gotcha",
    title: extra.title ?? `Title ${id}`,
    applies_to: "all",
    confidence: "medium",
    sources: extra.sources ?? [{ kind: "correction", ref: "file/src/gone.ts:1" }],
    created: "2026-01-01",
    last_validated: extra.last_validated ?? "2026-04-20",
    symptom: "x",
    resolution: "y",
    ...extra,
  };
  const p = path.join(dir, `${id}.md`);
  fs.writeFileSync(p, `---\n${yaml.stringify(fm)}---\n\n${body}\n`, "utf8");
  return p;
}

function readFm(p: string): Record<string, unknown> {
  const raw = fs.readFileSync(p, "utf8");
  return matter(raw, {
    engines: {
      yaml: {
        parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
        stringify: (o: object): string => yaml.stringify(o),
      },
    },
  }).data as Record<string, unknown>;
}

describe("applyDriftFlags — basic flagging", () => {
  it("writes `verified: false` and `drift_report:` for entries with drift hits", async () => {
    const filePath = writeGotcha("g1");
    const { entries } = await loadKnowledgeWithWarnings(tmpDir);
    const { byEntry } = await findAllDrift(entries, tmpDir);

    const result = await applyDriftFlags(tmpDir, entries, byEntry, {
      today: "2026-04-26",
    });

    expect(result.flagged).toContain("g1");

    const fm = readFm(filePath);
    expect(fm["verified"]).toBe(false);
    const report = fm["drift_report"];
    expect(Array.isArray(report)).toBe(true);
    expect((report as unknown[]).length).toBeGreaterThanOrEqual(1);
    const row = (report as Array<Record<string, unknown>>)[0]!;
    expect(row["kind"]).toBe("file_missing");
    expect(row["ref"]).toBe("file/src/gone.ts:1");
    expect(row["detected"]).toBe("2026-04-26");
  });

  it("does not touch entries with no drift hits", async () => {
    // Create a file that exists so no drift is detected.
    const codeDir = path.join(tmpDir, "src");
    fs.mkdirSync(codeDir, { recursive: true });
    fs.writeFileSync(path.join(codeDir, "real.ts"), "// here", "utf8");

    const filePath = writeGotcha("g-clean", {
      sources: [{ kind: "correction", ref: "file/src/real.ts:1" }],
    });
    const { entries } = await loadKnowledgeWithWarnings(tmpDir);
    const { byEntry } = await findAllDrift(entries, tmpDir);

    const result = await applyDriftFlags(tmpDir, entries, byEntry, {
      today: "2026-04-26",
    });

    expect(result.unchanged).toContain("g-clean");
    expect(result.flagged).not.toContain("g-clean");

    const fm = readFm(filePath);
    expect(fm["verified"]).toBeUndefined();
    expect(fm["drift_report"]).toBeUndefined();
  });
});

describe("applyDriftFlags — idempotence", () => {
  it("re-running with identical hits does not duplicate drift_report rows", async () => {
    const filePath = writeGotcha("g1");
    const { entries: entries1 } = await loadKnowledgeWithWarnings(tmpDir);
    const { byEntry: by1 } = await findAllDrift(entries1, tmpDir);

    await applyDriftFlags(tmpDir, entries1, by1, { today: "2026-04-26" });

    // Reload and re-apply with the same hits.
    const { entries: entries2 } = await loadKnowledgeWithWarnings(tmpDir);
    const { byEntry: by2 } = await findAllDrift(entries2, tmpDir);
    const result = await applyDriftFlags(tmpDir, entries2, by2, {
      today: "2026-04-27",
    });

    expect(result.unchanged).toContain("g1");
    const fm = readFm(filePath);
    const report = fm["drift_report"] as Array<Record<string, unknown>>;
    // Still exactly one row, with the original detected date.
    expect(report).toHaveLength(1);
    expect(report[0]!["detected"]).toBe("2026-04-26");
  });
});

describe("applyDriftFlags — last_validated invariant", () => {
  it("does NOT bump last_validated when drift is detected", async () => {
    const filePath = writeGotcha("g1", { last_validated: "2026-01-15" });
    const { entries } = await loadKnowledgeWithWarnings(tmpDir);
    const { byEntry } = await findAllDrift(entries, tmpDir);

    await applyDriftFlags(tmpDir, entries, byEntry, { today: "2026-04-26" });

    const fm = readFm(filePath);
    expect(fm["last_validated"]).toBe("2026-01-15");
    expect(fm["verified"]).toBe(false);
  });
});

describe("applyDriftFlags — resolution clears drift_report", () => {
  it("removes a drift_report row that no longer matches a hit and flips verified=true", async () => {
    const filePath = writeGotcha("g1");
    const { entries: e1 } = await loadKnowledgeWithWarnings(tmpDir);
    const { byEntry: by1 } = await findAllDrift(e1, tmpDir);
    await applyDriftFlags(tmpDir, e1, by1, { today: "2026-04-26" });

    // Simulate fix: create the file that was referenced.
    const codeDir = path.join(tmpDir, "src");
    fs.mkdirSync(codeDir, { recursive: true });
    fs.writeFileSync(path.join(codeDir, "gone.ts"), "// reborn", "utf8");

    const { entries: e2 } = await loadKnowledgeWithWarnings(tmpDir);
    // Hits should now be empty because file exists.
    const noHits = new Map<string, DriftHit[]>();
    const result = await applyDriftFlags(tmpDir, e2, noHits, {
      today: "2026-04-27",
    });

    expect(result.cleared).toContain("g1");
    const fm = readFm(filePath);
    expect(fm["drift_report"]).toBeUndefined();
    expect(fm["verified"]).toBe(true);
  });
});

describe("applyDriftFlags — partial resolution", () => {
  it("removes only the resolved row, keeps the still-missing one", async () => {
    const filePath = writeGotcha("g1", {
      sources: [
        { kind: "correction", ref: "file/src/gone-1.ts:1" },
        { kind: "correction", ref: "file/src/gone-2.ts:2" },
      ],
    });
    const { entries: e1 } = await loadKnowledgeWithWarnings(tmpDir);
    const { byEntry: by1 } = await findAllDrift(e1, tmpDir);
    await applyDriftFlags(tmpDir, e1, by1, { today: "2026-04-26" });

    // Resolve one of the two by creating the file.
    const codeDir = path.join(tmpDir, "src");
    fs.mkdirSync(codeDir, { recursive: true });
    fs.writeFileSync(path.join(codeDir, "gone-1.ts"), "// fixed");

    const { entries: e2 } = await loadKnowledgeWithWarnings(tmpDir);
    const { byEntry: by2 } = await findAllDrift(e2, tmpDir);
    const result = await applyDriftFlags(tmpDir, e2, by2, {
      today: "2026-04-27",
    });

    expect(result.updated).toContain("g1");
    const fm = readFm(filePath);
    expect(fm["verified"]).toBe(false);
    const report = fm["drift_report"] as Array<Record<string, unknown>>;
    expect(report).toHaveLength(1);
    expect(report[0]!["ref"]).toBe("file/src/gone-2.ts:2");
  });
});

describe("applyDriftFlags — dryRun", () => {
  it("does not write files in dry-run mode", async () => {
    const filePath = writeGotcha("g1");
    const before = fs.readFileSync(filePath, "utf8");
    const { entries } = await loadKnowledgeWithWarnings(tmpDir);
    const { byEntry } = await findAllDrift(entries, tmpDir);

    await applyDriftFlags(tmpDir, entries, byEntry, {
      today: "2026-04-26",
      dryRun: true,
    });

    const after = fs.readFileSync(filePath, "utf8");
    expect(after).toBe(before);
  });
});

describe("runCurator — markVerified opt-in", () => {
  it("does not mutate entries by default (mark-verified off)", async () => {
    writeGotcha("g1");
    const { runCurator } = await import("../../src/curator/index.js");
    await runCurator(tmpDir, { now: new Date("2026-04-26T00:00:00Z") });

    const filePath = path.join(
      tmpDir,
      ".apex",
      "knowledge",
      "gotchas",
      "g1.md",
    );
    const fm = readFm(filePath);
    expect(fm["verified"]).toBeUndefined();
    expect(fm["drift_report"]).toBeUndefined();
  });

  it("writes drift_report when markVerified is true", async () => {
    writeGotcha("g1");
    const { runCurator } = await import("../../src/curator/index.js");
    const report = await runCurator(tmpDir, {
      now: new Date("2026-04-26T00:00:00Z"),
      markVerified: true,
    });
    expect(report.verifyResult?.flagged).toContain("g1");

    const filePath = path.join(
      tmpDir,
      ".apex",
      "knowledge",
      "gotchas",
      "g1.md",
    );
    const fm = readFm(filePath);
    expect(fm["verified"]).toBe(false);
    expect(Array.isArray(fm["drift_report"])).toBe(true);
  });
});

describe("schedule descriptor", () => {
  it("installCurationSchedule writes a TOML descriptor", async () => {
    const { installCurationSchedule } = await import("../../src/curator/schedule.js");
    const desc = await installCurationSchedule(tmpDir, { cadence: "weekly" });
    expect(desc.cadence).toBe("weekly");
    expect(fs.existsSync(desc.path)).toBe(true);
    const content = fs.readFileSync(desc.path, "utf8");
    expect(content).toContain('cadence = "weekly"');
    expect(content).toContain('command = "apex curate"');
    expect(content).toContain("schema_version = 1");
  });
});
