import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aggregateSignals,
  jaccard,
  tokenize,
  DEFAULT_CALIBRATION_CONFIG,
} from "../../src/confidence/index.js";
import { loadKnowledgeWithWarnings } from "../../src/recall/loader.js";
import {
  cleanupRoot,
  makeEpisode,
  makeTempRoot,
  writeKnowledge,
} from "./helpers.js";

describe("tokenize / jaccard helpers", () => {
  it("tokenize lower-cases, drops stop-words and short tokens", () => {
    const t = tokenize("Always use pnpm not npm");
    // "use", "not" are stop-words; tokens should include "always", "pnpm", "npm"
    expect(t).toContain("alway");
    expect(t).toContain("pnpm");
    expect(t).toContain("npm");
  });

  it("jaccard returns 0 for disjoint sets and 1 for identical sets", () => {
    expect(jaccard(["a", "b"], ["c", "d"])).toBe(0);
    expect(jaccard(["a", "b"], ["a", "b"])).toBe(1);
  });

  it("jaccard returns the right ratio for partial overlap", () => {
    // {a,b,c} ∩ {b,c,d} = {b,c} (2); union = {a,b,c,d} (4); 2/4 = 0.5
    expect(jaccard(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(0.5, 6);
  });
});

describe("aggregateSignals", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("emits +up for a thumbs_up against the entry id", async () => {
    await writeKnowledge(root, {
      id: "rule-x",
      type: "convention",
      title: "rule x",
    });
    const episodeId = await makeEpisode(root, {
      corrections: [
        { turn: 1, kind: "thumbs_up", target_entry_id: "rule-x" },
      ],
    });

    const { entries } = await loadKnowledgeWithWarnings(root);
    const agg = await aggregateSignals(entries, [episodeId], {
      root,
      config: DEFAULT_CALIBRATION_CONFIG,
    });
    const r = agg.find((a) => a.entry.id === "rule-x")!;
    expect(r.signals.length).toBe(1);
    expect(r.signals[0]?.direction).toBe("up");
    expect(r.signals[0]?.source).toBe("thumbs_up");
    expect(r.score).toBe(1);
  });

  it("emits +up for a successful test command + edited affected file", async () => {
    await writeKnowledge(root, {
      id: "tested-rule",
      type: "convention",
      title: "tested rule",
      affects: ["src/api.ts"],
    });
    const episodeId = await makeEpisode(root, {
      tools: [
        { turn: 1, tool_name: "Edit", file_path: "src/api.ts", exit_code: 0 },
        { turn: 2, tool_name: "Bash", command: "pnpm test", exit_code: 0 },
      ],
    });
    const { entries } = await loadKnowledgeWithWarnings(root);
    const agg = await aggregateSignals(entries, [episodeId], {
      root,
      config: DEFAULT_CALIBRATION_CONFIG,
    });
    const r = agg.find((a) => a.entry.id === "tested-rule")!;
    expect(r.signals.find((s) => s.source === "test_pass")).toBeDefined();
    expect(r.score).toBeGreaterThanOrEqual(1);
  });

  it("does NOT emit a test_pass signal when the entry's affects is empty", async () => {
    await writeKnowledge(root, {
      id: "no-affects",
      type: "convention",
      title: "no affects rule",
    });
    const episodeId = await makeEpisode(root, {
      tools: [
        { turn: 1, tool_name: "Edit", file_path: "src/x.ts", exit_code: 0 },
        { turn: 2, tool_name: "Bash", command: "pnpm test", exit_code: 0 },
      ],
    });
    const { entries } = await loadKnowledgeWithWarnings(root);
    const agg = await aggregateSignals(entries, [episodeId], {
      root,
      config: DEFAULT_CALIBRATION_CONFIG,
    });
    const r = agg.find((a) => a.entry.id === "no-affects")!;
    expect(r.signals.find((s) => s.source === "test_pass")).toBeUndefined();
  });

  it("does NOT emit test_pass when no test command was run", async () => {
    await writeKnowledge(root, {
      id: "rule-without-tests",
      type: "convention",
      title: "rule without tests",
      affects: ["src/x.ts"],
    });
    const episodeId = await makeEpisode(root, {
      tools: [
        { turn: 1, tool_name: "Edit", file_path: "src/x.ts", exit_code: 0 },
        { turn: 2, tool_name: "Bash", command: "ls -la", exit_code: 0 },
      ],
    });
    const { entries } = await loadKnowledgeWithWarnings(root);
    const agg = await aggregateSignals(entries, [episodeId], {
      root,
      config: DEFAULT_CALIBRATION_CONFIG,
    });
    const r = agg.find((a) => a.entry.id === "rule-without-tests")!;
    expect(r.signals).toHaveLength(0);
  });

  it("emits +up for a correction whose tokens overlap the entry (Jaccard ≥ 0.4)", async () => {
    await writeKnowledge(root, {
      id: "pnpm-rule",
      type: "convention",
      title: "use pnpm install pnpm add pnpm run",
      body: "Always use pnpm install. Lockfile is pnpm-lock.yaml.",
    });
    const episodeId = await makeEpisode(root, {
      corrections: [
        {
          turn: 1,
          kind: "correction",
          user_text: "use pnpm install pnpm add pnpm run instead of npm",
        },
      ],
    });
    const { entries } = await loadKnowledgeWithWarnings(root);
    const agg = await aggregateSignals(entries, [episodeId], {
      root,
      config: DEFAULT_CALIBRATION_CONFIG,
    });
    const r = agg.find((a) => a.entry.id === "pnpm-rule")!;
    expect(r.signals.find((s) => s.source === "repeat_correction")).toBeDefined();
  });

  it("ignores confirmation kind rows entirely", async () => {
    await writeKnowledge(root, {
      id: "neutral",
      type: "convention",
      title: "neutral rule",
    });
    const episodeId = await makeEpisode(root, {
      corrections: [
        { turn: 1, kind: "confirmation", user_text: "yes, that's right" },
      ],
    });
    const { entries } = await loadKnowledgeWithWarnings(root);
    const agg = await aggregateSignals(entries, [episodeId], {
      root,
      config: DEFAULT_CALIBRATION_CONFIG,
    });
    const r = agg.find((a) => a.entry.id === "neutral")!;
    expect(r.signals).toHaveLength(0);
  });

  it("aggregates score across multiple episodes", async () => {
    await writeKnowledge(root, {
      id: "multi-ep",
      type: "convention",
      title: "multi episode rule",
    });
    const ep1 = await makeEpisode(root, {
      episodeId: "2026-04-10-1200-aaa1",
      corrections: [
        { turn: 1, kind: "thumbs_up", target_entry_id: "multi-ep" },
      ],
    });
    const ep2 = await makeEpisode(root, {
      episodeId: "2026-04-10-1300-aaa2",
      corrections: [
        { turn: 1, kind: "thumbs_up", target_entry_id: "multi-ep" },
      ],
    });
    const { entries } = await loadKnowledgeWithWarnings(root);
    const agg = await aggregateSignals(entries, [ep1, ep2], {
      root,
      config: DEFAULT_CALIBRATION_CONFIG,
    });
    const r = agg.find((a) => a.entry.id === "multi-ep")!;
    expect(r.score).toBe(2);
    expect(r.signals).toHaveLength(2);
  });
});
