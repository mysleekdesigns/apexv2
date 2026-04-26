// Unit tests for src/hookpolicy/recommender.ts
// Pure function: feed metrics objects, assert recommendation labels and content.

import { describe, it, expect } from "vitest";
import { recommend } from "../../src/hookpolicy/recommender.js";
import type { RecommendationInput } from "../../src/hookpolicy/recommender.js";
import { HOOK_NAMES } from "../../src/hookpolicy/metrics.js";
import type { HookName, HookMetrics } from "../../src/hookpolicy/metrics.js";

// ---------- helpers -----------------------------------------------------------

function makeMetrics(
  overrides: Partial<Record<HookName, { totalSignal: number; episodesWithSignal?: number; breakdown?: Record<string, number> }>>,
): HookMetrics[] {
  return HOOK_NAMES.map((hook) => {
    const o = overrides[hook] ?? { totalSignal: 0 };
    return {
      hook,
      signal: {
        totalSignal: o.totalSignal,
        episodesWithSignal: o.episodesWithSignal ?? (o.totalSignal > 0 ? 1 : 0),
        breakdown: o.breakdown ?? {},
      },
    };
  });
}

function makeInput(
  episodesScanned: number,
  overrides: Partial<Record<HookName, { totalSignal: number; episodesWithSignal?: number; breakdown?: Record<string, number> }>>,
): RecommendationInput {
  return {
    metrics: makeMetrics(overrides),
    episodesScanned,
    windowDays: 14,
    episodeIds: Array.from({ length: episodesScanned }, (_, i) => `2026-04-${String(20 + i).padStart(2, "0")}-1000-${String(i).padStart(4, "0")}`),
  };
}

// ---------- insufficient-data -------------------------------------------------

describe("recommend — insufficient-data", () => {
  it("returns insufficient-data for all hooks when fewer than 5 episodes", () => {
    const input = makeInput(3, {});
    const recs = recommend(input);
    for (const r of recs) {
      expect(r.recommendation).toBe("insufficient-data");
    }
  });

  it("returns insufficient-data for exactly 4 episodes", () => {
    const input = makeInput(4, {});
    const recs = recommend(input);
    for (const r of recs) {
      expect(r.recommendation).toBe("insufficient-data");
    }
  });

  it("does NOT return insufficient-data for exactly 5 episodes with signal", () => {
    const input = makeInput(5, {
      "SessionStart": { totalSignal: 5 },
    });
    const recs = recommend(input);
    const ss = recs.find((r) => r.hook === "SessionStart")!;
    expect(ss.recommendation).toBe("keep");
  });
});

// ---------- SessionStart always-keep ------------------------------------------

describe("recommend — SessionStart", () => {
  it("always recommends keep for SessionStart regardless of low signal", () => {
    // 0 signal but ≥5 episodes
    const input = makeInput(10, {
      "SessionStart": { totalSignal: 0 },
    });
    const recs = recommend(input);
    const ss = recs.find((r) => r.hook === "SessionStart")!;
    expect(ss.recommendation).toBe("keep");
    expect(ss.reason).toContain("every session");
  });

  it("reason mentions session count when signal > 0", () => {
    const input = makeInput(7, {
      "SessionStart": { totalSignal: 7, breakdown: { sessions_started: 7 } },
    });
    const recs = recommend(input);
    const ss = recs.find((r) => r.hook === "SessionStart")!;
    expect(ss.recommendation).toBe("keep");
    expect(ss.reason).toContain("7");
  });
});

// ---------- keep when signal > 0 ----------------------------------------------

describe("recommend — keep", () => {
  it("keeps UserPromptSubmit when corrections > 0", () => {
    const input = makeInput(6, {
      "UserPromptSubmit": {
        totalSignal: 3,
        episodesWithSignal: 2,
        breakdown: { corrections: 2, confirmations: 1, thumbs_up: 0, thumbs_down: 0, prompts_total: 10 },
      },
    });
    const recs = recommend(input);
    const ups = recs.find((r) => r.hook === "UserPromptSubmit")!;
    expect(ups.recommendation).toBe("keep");
    expect(ups.reason).toContain("3 signal row(s)");
    expect(ups.reason).toContain("2 correction(s)");
    expect(ups.reason).toContain("1 confirmation(s)");
  });

  it("keeps PostToolUse(Bash) when bash entries > 0", () => {
    const input = makeInput(5, {
      "PostToolUse(Bash)": {
        totalSignal: 10,
        episodesWithSignal: 3,
        breakdown: { bash_tool_entries: 10 },
      },
    });
    const recs = recommend(input);
    const ptub = recs.find((r) => r.hook === "PostToolUse(Bash)")!;
    expect(ptub.recommendation).toBe("keep");
    expect(ptub.reason).toContain("10 Bash tool row(s)");
  });

  it("keeps PostToolUseFailure when failures > 0", () => {
    const input = makeInput(5, {
      "PostToolUseFailure": {
        totalSignal: 4,
        episodesWithSignal: 2,
        breakdown: { failures_captured: 4 },
      },
    });
    const recs = recommend(input);
    const ptuf = recs.find((r) => r.hook === "PostToolUseFailure")!;
    expect(ptuf.recommendation).toBe("keep");
    expect(ptuf.reason).toContain("4 failure(s)");
  });

  it("keeps PreCompact when snapshots > 0", () => {
    const input = makeInput(5, {
      "PreCompact": {
        totalSignal: 2,
        episodesWithSignal: 1,
        breakdown: { snapshots_written: 2 },
      },
    });
    const recs = recommend(input);
    const pc = recs.find((r) => r.hook === "PreCompact")!;
    expect(pc.recommendation).toBe("keep");
    expect(pc.reason).toContain("2 snapshot(s)");
  });

  it("keeps SessionEnd when reflections > 0", () => {
    const input = makeInput(5, {
      "SessionEnd": {
        totalSignal: 5,
        episodesWithSignal: 5,
        breakdown: { reflections_queued: 5, reflections_complete: 3 },
      },
    });
    const recs = recommend(input);
    const se = recs.find((r) => r.hook === "SessionEnd")!;
    expect(se.recommendation).toBe("keep");
    expect(se.reason).toContain("5 reflection(s) queued");
    expect(se.reason).toContain("3 completed");
  });
});

// ---------- disable when signal = 0 and ≥5 episodes --------------------------

describe("recommend — disable", () => {
  it("disables UserPromptSubmit when no signal across ≥5 episodes", () => {
    const input = makeInput(8, {
      "UserPromptSubmit": { totalSignal: 0, breakdown: { corrections: 0, prompts_total: 20 } },
    });
    const recs = recommend(input);
    const ups = recs.find((r) => r.hook === "UserPromptSubmit")!;
    expect(ups.recommendation).toBe("disable");
    expect(ups.reason).toContain("0 corrections");
    expect(ups.reason).toContain("Low signal");
  });

  it("disables PostToolUseFailure when no failures across ≥5 episodes", () => {
    const input = makeInput(10, {
      "PostToolUseFailure": { totalSignal: 0, breakdown: { failures_captured: 0 } },
    });
    const recs = recommend(input);
    const ptuf = recs.find((r) => r.hook === "PostToolUseFailure")!;
    expect(ptuf.recommendation).toBe("disable");
    expect(ptuf.reason).toContain("0 failures");
  });

  it("disables PreCompact when no snapshots across ≥5 episodes", () => {
    const input = makeInput(6, {
      "PreCompact": { totalSignal: 0, breakdown: { snapshots_written: 0 } },
    });
    const recs = recommend(input);
    const pc = recs.find((r) => r.hook === "PreCompact")!;
    expect(pc.recommendation).toBe("disable");
    expect(pc.reason).toContain("0 snapshots");
  });

  it("includes caveat note in disable reason", () => {
    const input = makeInput(7, {
      "PostToolUse(Bash)": { totalSignal: 0 },
    });
    const recs = recommend(input);
    const ptub = recs.find((r) => r.hook === "PostToolUse(Bash)")!;
    expect(ptub.recommendation).toBe("disable");
    expect(ptub.reason).toContain("your usage may differ");
  });
});

// ---------- evidence list -----------------------------------------------------

describe("recommend — evidence list", () => {
  it("includes breakdown keys in evidence when signal > 0", () => {
    const input = makeInput(5, {
      "PostToolUseFailure": {
        totalSignal: 3,
        episodesWithSignal: 2,
        breakdown: { failures_captured: 3 },
      },
    });
    const recs = recommend(input);
    const ptuf = recs.find((r) => r.hook === "PostToolUseFailure")!;
    expect(ptuf.evidence).toContain("failures_captured: 3");
  });

  it("includes episode sample in evidence when episodes with signal > 0", () => {
    const input = makeInput(5, {
      "PostToolUseFailure": {
        totalSignal: 2,
        episodesWithSignal: 2,
        breakdown: { failures_captured: 2 },
      },
    });
    const recs = recommend(input);
    const ptuf = recs.find((r) => r.hook === "PostToolUseFailure")!;
    expect(ptuf.evidence.some((e) => e.startsWith("episode sample:"))).toBe(true);
  });

  it("omits zero-value breakdown keys from evidence", () => {
    const input = makeInput(5, {
      "UserPromptSubmit": {
        totalSignal: 1,
        episodesWithSignal: 1,
        breakdown: { corrections: 1, confirmations: 0, thumbs_up: 0, thumbs_down: 0 },
      },
    });
    const recs = recommend(input);
    const ups = recs.find((r) => r.hook === "UserPromptSubmit")!;
    expect(ups.evidence).toContain("corrections: 1");
    expect(ups.evidence.some((e) => e.includes("confirmations"))).toBe(false);
  });
});

// ---------- mixed scenario ----------------------------------------------------

describe("recommend — realistic mixed scenario", () => {
  it("returns correct mix of keep/disable/keep for project with minimal Bash usage", () => {
    const input = makeInput(6, {
      "SessionStart": { totalSignal: 6, breakdown: { sessions_started: 6 } },
      "UserPromptSubmit": {
        totalSignal: 2,
        breakdown: { corrections: 1, confirmations: 1, thumbs_up: 0, thumbs_down: 0, prompts_total: 12 },
      },
      "PostToolUse(Bash)": { totalSignal: 0 },
      "PostToolUseFailure": { totalSignal: 1, breakdown: { failures_captured: 1 } },
      "PreCompact": { totalSignal: 0 },
      "SessionEnd": { totalSignal: 6, breakdown: { reflections_queued: 6, reflections_complete: 4 } },
    });
    const recs = recommend(input);
    const byHook = Object.fromEntries(recs.map((r) => [r.hook, r.recommendation]));
    expect(byHook["SessionStart"]).toBe("keep");
    expect(byHook["UserPromptSubmit"]).toBe("keep");
    expect(byHook["PostToolUse(Bash)"]).toBe("disable");
    expect(byHook["PostToolUseFailure"]).toBe("keep");
    expect(byHook["PreCompact"]).toBe("disable");
    expect(byHook["SessionEnd"]).toBe("keep");
  });
});
