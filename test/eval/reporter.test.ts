import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  findPriorReport,
  parsePriorReport,
  renderReport,
  reportFileName,
  resolveReportPaths,
  writeReport,
} from "../../src/eval/reporter.js";
import type { RunSummary } from "../../src/eval/types.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apex-eval-reporter-"));
}

function makeSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    generated_at: "2026-04-26T18:30:00Z",
    pass_count: 3,
    fail_count: 1,
    synthetic_count: 3,
    replay_count: 1,
    with_apex: true,
    metrics: {
      repeat_mistake_rate: 0.18,
      knowledge_hit_rate: 0.62,
      time_to_first_correct_edit_ms: 132000,
      user_correction_frequency: 4.1,
      total_errors: 8,
      total_prompts: 50,
      total_sessions: 4,
    },
    results: [
      {
        task_id: "ts-add-route",
        stack: "node-typescript",
        kind: "synthetic",
        passed: true,
        duration_ms: 50,
        predicates: [{ kind: "file_exists", passed: true, reason: "ok" }],
        signals: { tools_used: 0, files_touched: 0, errors_recovered: 0, retrieval_hits: 0, retrieval_used: 0 },
      },
      {
        task_id: "ts-rename-prop",
        stack: "node-typescript",
        kind: "synthetic",
        passed: false,
        duration_ms: 30,
        predicates: [
          {
            kind: "file_exists",
            passed: false,
            reason: "file_exists predicate failed for src/components/Button.tsx",
          },
        ],
        signals: { tools_used: 0, files_touched: 0, errors_recovered: 0, retrieval_hits: 0, retrieval_used: 0 },
      },
      {
        task_id: "py-add-route",
        stack: "python",
        kind: "synthetic",
        passed: true,
        duration_ms: 20,
        predicates: [{ kind: "file_exists", passed: true, reason: "ok" }],
        signals: { tools_used: 0, files_touched: 0, errors_recovered: 0, retrieval_hits: 0, retrieval_used: 0 },
      },
      {
        task_id: "replay-2026-04-21-1f3e-9bc4",
        stack: "node-typescript",
        kind: "replay",
        passed: true,
        duration_ms: 10,
        predicates: [{ kind: "file_exists", passed: true, reason: "ok" }],
        signals: { tools_used: 12, files_touched: 3, errors_recovered: 1, retrieval_hits: 4, retrieval_used: 2 },
      },
    ],
    prev_report_path: null,
    prev_metrics: null,
    prev_pass_rate: null,
    ...overrides,
  };
}

describe("reportFileName", () => {
  it("formats UTC timestamps", () => {
    expect(reportFileName(new Date("2026-04-26T18:30:00Z"))).toBe(
      "eval-2026-04-26-1830.md",
    );
  });
});

describe("renderReport", () => {
  it("includes a header with date and counts", () => {
    const md = renderReport(makeSummary());
    expect(md).toMatch(/^# APEX Eval Report —/);
    expect(md).toContain("Tasks run: 4");
    expect(md).toContain("synthetic, 1 replay");
    expect(md).toContain("(first run, no comparison)");
  });

  it("lists failed tasks with a reason", () => {
    const md = renderReport(makeSummary());
    expect(md).toContain("## Failed tasks");
    expect(md).toContain("ts-rename-prop");
    expect(md).toContain("Button.tsx");
  });

  it("emits a metrics table", () => {
    const md = renderReport(makeSummary());
    expect(md).toContain("| Repeat-mistake rate | 0.18");
    expect(md).toContain("| Knowledge hit rate | 0.62");
    expect(md).toContain("| User correction frequency | 4.10");
  });

  it("renders a delta when a prior run is provided", () => {
    const prior = {
      repeat_mistake_rate: 0.31,
      knowledge_hit_rate: 0.5,
      time_to_first_correct_edit_ms: 200000,
      user_correction_frequency: 6.0,
      total_errors: 0,
      total_prompts: 0,
      total_sessions: 0,
    };
    const md = renderReport(
      makeSummary({
        prev_report_path: "/tmp/.apex/metrics/eval-2026-04-19-1500.md",
        prev_metrics: prior,
        prev_pass_rate: 0.5,
      }),
    );
    expect(md).toContain("vs. previous run");
    expect(md).toContain("eval-2026-04-19-1500.md");
    // 4 passed of 4 = 1.0 (pr=0.75 actually, 3/4) so delta vs 0.5 = +25pp
    // 3/4=0.75 - 0.5 = 0.25 -> +25pp
    expect(md).toMatch(/\+25pp/);
  });
});

describe("findPriorReport / parsePriorReport / writeReport", () => {
  it("finds the most-recent prior report by lexical sort", async () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "eval-2026-04-19-1500.md"), "x");
    fs.writeFileSync(path.join(root, "eval-2026-04-26-1830.md"), "x");
    fs.writeFileSync(path.join(root, "other.md"), "x");
    const found = await findPriorReport(root, "eval-2026-04-26-1830.md");
    expect(found).toBe(path.join(root, "eval-2026-04-19-1500.md"));
  });

  it("returns null when no prior reports exist", async () => {
    expect(await findPriorReport(tempRoot(), "eval-foo.md")).toBeNull();
  });

  it("parses metrics from a written report", async () => {
    const root = tempRoot();
    const report = path.join(root, "eval-2026-04-19-1500.md");
    const md = renderReport(makeSummary({ prev_pass_rate: null, prev_metrics: null, prev_report_path: null }));
    await writeReport(report, md);
    const parsed = await parsePriorReport(report);
    expect(parsed.metrics.repeat_mistake_rate).toBeCloseTo(0.18, 5);
    expect(parsed.metrics.knowledge_hit_rate).toBeCloseTo(0.62, 5);
    expect(parsed.passRate).toBeCloseTo(0.75, 5);
  });
});

describe("resolveReportPaths", () => {
  it("uses the metrics dir by default", () => {
    const r = resolveReportPaths("/tmp/p", new Date("2026-04-26T18:30:00Z"));
    expect(r.reportPath.endsWith(path.join(".apex", "metrics", "eval-2026-04-26-1830.md"))).toBe(true);
  });

  it("respects an override path", () => {
    const r = resolveReportPaths("/tmp/p", new Date("2026-04-26T18:30:00Z"), "/tmp/out.md");
    expect(r.reportPath).toBe("/tmp/out.md");
  });
});
