import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runCalibrator,
  targetConfidenceFromScore,
  DEFAULT_CALIBRATION_CONFIG,
  confidenceWeight,
} from "../../src/confidence/index.js";
import {
  cleanupRoot,
  makeEpisode,
  makeTempRoot,
  readKnowledgeConfidence,
  TODAY,
  writeKnowledge,
} from "./helpers.js";

describe("targetConfidenceFromScore", () => {
  it("maps score >= highThreshold to high", () => {
    expect(targetConfidenceFromScore(2, DEFAULT_CALIBRATION_CONFIG)).toBe("high");
    expect(targetConfidenceFromScore(5, DEFAULT_CALIBRATION_CONFIG)).toBe("high");
  });
  it("maps score in (low, high) to medium", () => {
    expect(targetConfidenceFromScore(0, DEFAULT_CALIBRATION_CONFIG)).toBe("medium");
    expect(targetConfidenceFromScore(1, DEFAULT_CALIBRATION_CONFIG)).toBe("medium");
  });
  it("maps score <= lowThreshold to low", () => {
    expect(targetConfidenceFromScore(-1, DEFAULT_CALIBRATION_CONFIG)).toBe("low");
    expect(targetConfidenceFromScore(-3, DEFAULT_CALIBRATION_CONFIG)).toBe("low");
  });
});

describe("confidenceWeight", () => {
  it("returns numeric weights for retrieval down-weighting", () => {
    expect(confidenceWeight("low")).toBe(0.5);
    expect(confidenceWeight("medium")).toBe(0.85);
    expect(confidenceWeight("high")).toBe(1.0);
  });
});

describe("runCalibrator — promotion", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("promotes medium → high after 2 thumbs_up + 1 successful test (PRD example)", async () => {
    await writeKnowledge(root, {
      id: "use-pnpm",
      type: "convention",
      title: "use pnpm not npm",
      affects: ["package.json"],
      confidence: "medium",
    });
    const episodeId = await makeEpisode(root, {
      corrections: [
        { turn: 1, kind: "thumbs_up", target_entry_id: "use-pnpm" },
        { turn: 2, kind: "thumbs_up", target_entry_id: "use-pnpm" },
      ],
      tools: [
        { turn: 3, tool_name: "Edit", file_path: "package.json", exit_code: 0 },
        { turn: 4, tool_name: "Bash", command: "pnpm test", exit_code: 0 },
      ],
    });

    const report = await runCalibrator({ root, episodeIds: [episodeId] });
    const t = report.transitions.find((x) => x.entry.id === "use-pnpm")!;
    expect(t).toBeDefined();
    expect(t.from).toBe("medium");
    expect(t.to).toBe("high");
    expect(t.changed).toBe(true);
    expect(t.signalCount).toBeGreaterThanOrEqual(3);

    const updated = await readKnowledgeConfidence(root, "convention", "use-pnpm");
    expect(updated.confidence).toBe("high");
    expect(updated.last_validated).toBe(TODAY);
  });

  it("promotes low → medium with one thumbs_up", async () => {
    await writeKnowledge(root, {
      id: "soft-rule",
      type: "convention",
      title: "soft rule",
      confidence: "low",
    });
    const episodeId = await makeEpisode(root, {
      corrections: [{ turn: 1, kind: "thumbs_up", target_entry_id: "soft-rule" }],
    });

    await runCalibrator({ root, episodeIds: [episodeId] });
    const updated = await readKnowledgeConfidence(root, "convention", "soft-rule");
    expect(updated.confidence).toBe("medium");
  });

  it("promotes low → high with three positive signals (≥highThreshold)", async () => {
    await writeKnowledge(root, {
      id: "strong-rule",
      type: "convention",
      title: "strong rule",
      affects: ["src/api.ts"],
      confidence: "low",
    });
    const episodeId = await makeEpisode(root, {
      corrections: [
        { turn: 1, kind: "thumbs_up", target_entry_id: "strong-rule" },
        { turn: 2, kind: "thumbs_up", target_entry_id: "strong-rule" },
      ],
      tools: [
        { turn: 3, tool_name: "Edit", file_path: "src/api.ts", exit_code: 0 },
        { turn: 4, tool_name: "Bash", command: "vitest run", exit_code: 0 },
      ],
    });

    await runCalibrator({ root, episodeIds: [episodeId] });
    const updated = await readKnowledgeConfidence(root, "convention", "strong-rule");
    expect(updated.confidence).toBe("high");
  });
});

describe("runCalibrator — demotion", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("demotes high → low on a single thumbs_down (score = -1)", async () => {
    await writeKnowledge(root, {
      id: "doomed",
      type: "convention",
      title: "doomed rule",
      confidence: "high",
    });
    const episodeId = await makeEpisode(root, {
      corrections: [
        { turn: 1, kind: "thumbs_down", target_entry_id: "doomed" },
      ],
    });

    await runCalibrator({ root, episodeIds: [episodeId] });
    const updated = await readKnowledgeConfidence(root, "convention", "doomed");
    expect(updated.confidence).toBe("low");
  });

  it("demotes on explicit ignore directive matching the entry id", async () => {
    await writeKnowledge(root, {
      id: "ignore-me",
      type: "convention",
      title: "ignore me rule",
      confidence: "medium",
    });
    const episodeId = await makeEpisode(root, {
      corrections: [
        {
          turn: 1,
          kind: "correction",
          user_text: "please ignore that ignore-me rule, it doesn't apply here",
        },
      ],
    });

    await runCalibrator({ root, episodeIds: [episodeId] });
    const updated = await readKnowledgeConfidence(root, "convention", "ignore-me");
    expect(updated.confidence).toBe("low");
  });

  it("demotes via failing-test-with-negation referencing the entry's affected file", async () => {
    await writeKnowledge(root, {
      id: "should-trim",
      type: "convention",
      title: "always trim user input",
      affects: ["src/users.ts"],
      confidence: "high",
    });
    const episodeId = await makeEpisode(root, {
      tools: [
        { turn: 1, tool_name: "Edit", file_path: "src/users.ts", exit_code: 0 },
      ],
      failures: [
        {
          turn: 2,
          tool_name: "Bash",
          error: "expected user input should not be trimmed in raw mode",
          error_signature: "should not be trimmed",
        },
      ],
    });

    await runCalibrator({ root, episodeIds: [episodeId] });
    const updated = await readKnowledgeConfidence(root, "convention", "should-trim");
    expect(updated.confidence).toBe("low");
  });
});

describe("runCalibrator — idempotence", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("re-running with no signals leaves every entry untouched", async () => {
    await writeKnowledge(root, {
      id: "quiet",
      type: "convention",
      title: "quiet rule",
      confidence: "medium",
    });
    const episodeId = await makeEpisode(root, {});
    const r1 = await runCalibrator({ root, episodeIds: [episodeId] });
    expect(r1.filesWritten).toEqual([]);
    expect(r1.noSignalEntryCount).toBe(1);
    const r2 = await runCalibrator({ root, episodeIds: [episodeId] });
    expect(r2.filesWritten).toEqual([]);
    expect(r2.transitions).toEqual([]);
  });

  it("re-running with the same signals does not rewrite (entry already at target)", async () => {
    await writeKnowledge(root, {
      id: "already-high",
      type: "convention",
      title: "already high rule",
      affects: ["src/x.ts"],
      confidence: "medium",
    });
    const episodeId = await makeEpisode(root, {
      corrections: [
        { turn: 1, kind: "thumbs_up", target_entry_id: "already-high" },
        { turn: 2, kind: "thumbs_up", target_entry_id: "already-high" },
      ],
    });

    const r1 = await runCalibrator({ root, episodeIds: [episodeId] });
    expect(r1.filesWritten.length).toBe(1);
    const t1 = r1.transitions.find((x) => x.entry.id === "already-high")!;
    expect(t1.changed).toBe(true);

    // Second pass: confidence is now high, target is still high → no write.
    const r2 = await runCalibrator({ root, episodeIds: [episodeId] });
    expect(r2.filesWritten.length).toBe(0);
    const t2 = r2.transitions.find((x) => x.entry.id === "already-high")!;
    expect(t2.from).toBe("high");
    expect(t2.to).toBe("high");
    expect(t2.changed).toBe(false);
  });

  it("dry-run never writes files", async () => {
    await writeKnowledge(root, {
      id: "dry-run-test",
      type: "convention",
      title: "dry run test",
      confidence: "medium",
    });
    const episodeId = await makeEpisode(root, {
      corrections: [
        { turn: 1, kind: "thumbs_up", target_entry_id: "dry-run-test" },
        { turn: 2, kind: "thumbs_up", target_entry_id: "dry-run-test" },
      ],
    });

    const r = await runCalibrator({ root, episodeIds: [episodeId], dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.filesWritten).toEqual([]);
    const t = r.transitions.find((x) => x.entry.id === "dry-run-test")!;
    expect(t.changed).toBe(true);
    expect(t.to).toBe("high");
    const stored = await readKnowledgeConfidence(root, "convention", "dry-run-test");
    expect(stored.confidence).toBe("medium");
  });
});

describe("runCalibrator — staleness decay", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("decays a high entry one step when not retrieved across N=10 episodes", async () => {
    await writeKnowledge(root, {
      id: "lonely",
      type: "convention",
      title: "lonely rule never retrieved",
      confidence: "high",
    });
    const episodeIds: string[] = [];
    // Generate episode IDs at distinct minutes so the IDs are unique and
    // sortable (newest first when reversed).
    for (let i = 0; i < 12; i++) {
      const ts = new Date(Date.UTC(2026, 3, 10, 12, i, 0));
      const ep = await makeEpisode(root, {
        episodeId: `2026-04-10-12${i.toString().padStart(2, "0")}-${(0xa000 + i).toString(16)}`,
        retrievals: [
          {
            turn: 1,
            entry_id: "some-other-entry",
            entry_type: "convention",
          },
        ],
        // Use ts to avoid lint
      });
      void ts;
      episodeIds.push(ep);
    }

    await runCalibrator({
      root,
      episodeIds: episodeIds.slice().reverse(),
    });
    const updated = await readKnowledgeConfidence(root, "convention", "lonely");
    expect(updated.confidence).toBe("low");
  });

  it("does NOT decay when fewer than N episodes are scanned", async () => {
    await writeKnowledge(root, {
      id: "young-entry",
      type: "convention",
      title: "young entry rule",
      confidence: "high",
    });
    const episodeId = await makeEpisode(root, {});

    await runCalibrator({ root, episodeIds: [episodeId] });
    const updated = await readKnowledgeConfidence(root, "convention", "young-entry");
    expect(updated.confidence).toBe("high");
  });
});
