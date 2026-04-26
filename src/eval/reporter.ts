import path from "node:path";
import fs from "node:fs/promises";
import { projectPaths } from "../util/paths.js";
import type { RunMetrics, RunSummary, TaskResult } from "./types.js";

const REPORT_PREFIX = "eval-";
const REPORT_SUFFIX = ".md";

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function reportFileName(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  return `${REPORT_PREFIX}${yyyy}-${mm}-${dd}-${hh}${mi}${REPORT_SUFFIX}`;
}

export async function findPriorReport(
  metricsDir: string,
  excludeBasename: string,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(metricsDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((f) => f.startsWith(REPORT_PREFIX) && f.endsWith(REPORT_SUFFIX))
    .filter((f) => f !== excludeBasename)
    .sort();
  const last = candidates[candidates.length - 1];
  return last ? path.join(metricsDir, last) : null;
}

interface ParsedReport {
  metrics: Partial<RunMetrics>;
  passRate: number | null;
}

export async function parsePriorReport(file: string): Promise<ParsedReport> {
  const text = await fs.readFile(file, "utf8").catch(() => null);
  if (text === null) return { metrics: {}, passRate: null };
  const metrics: Partial<RunMetrics> = {};
  let passRate: number | null = null;
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(/^\| ([A-Za-z][A-Za-z\- ]+?) \| ([0-9.]+|n\/a) \|/);
    if (!m) continue;
    const label = m[1]?.trim() ?? "";
    const valStr = m[2];
    if (!valStr || valStr === "n/a") continue;
    const value = Number(valStr);
    if (Number.isNaN(value)) continue;
    if (label === "Repeat-mistake rate") metrics.repeat_mistake_rate = value;
    else if (label === "Knowledge hit rate") metrics.knowledge_hit_rate = value;
    else if (label === "Time-to-first-correct-edit (ms)") metrics.time_to_first_correct_edit_ms = value;
    else if (label === "User correction frequency") metrics.user_correction_frequency = value;
    else if (label === "Pass rate") passRate = value;
  }
  return { metrics, passRate };
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return "n/a";
  if (!Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

function fmtDelta(now: number | null, prev: number | null, digits = 2): string {
  if (now === null || prev === null) return "n/a";
  const d = now - prev;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(digits)}`;
}

function fmtPercentDelta(now: number, prev: number): string {
  if (prev === 0) return now === 0 ? "0%" : "+inf%";
  const d = ((now - prev) / Math.abs(prev)) * 100;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(0)}%`;
}

function passRate(results: TaskResult[]): number {
  if (results.length === 0) return 0;
  return results.filter((r) => r.passed).length / results.length;
}

export function renderReport(summary: RunSummary): string {
  const total = summary.results.length;
  const total_pass = summary.pass_count;
  const pr = passRate(summary.results);
  const lines: string[] = [];
  // Trim "YYYY-MM-DDTHH:MM[:SS.sss]Z" to "YYYY-MM-DD HH:MM" for the header.
  const headerMatch = summary.generated_at.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  const headerDate = headerMatch ? `${headerMatch[1]} ${headerMatch[2]}` : summary.generated_at;
  lines.push(`# APEX Eval Report — ${headerDate}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(
    `- Tasks run: ${total} (${summary.synthetic_count} synthetic, ${summary.replay_count} replay)`,
  );
  lines.push(
    `- Pass rate: ${(pr * 100).toFixed(0)}% (${total_pass}/${total})`,
  );
  lines.push(`- Mode: ${summary.with_apex ? "with-apex" : "without-apex"}`);
  if (summary.prev_report_path !== null && summary.prev_pass_rate !== null) {
    const deltaPp = (pr - summary.prev_pass_rate) * 100;
    const sign = deltaPp >= 0 ? "+" : "";
    lines.push(
      `- vs. previous run (${path.basename(summary.prev_report_path)}): ${sign}${deltaPp.toFixed(0)}pp`,
    );
  } else {
    lines.push("- (first run, no comparison)");
  }
  lines.push("");

  lines.push("## Metrics");
  lines.push("| Metric | This run | Prev | Δ |");
  lines.push("|---|---|---|---|");
  const m = summary.metrics;
  const p = summary.prev_metrics;
  const passLine = `| Pass rate | ${pr.toFixed(2)} | ${p ? fmt(summary.prev_pass_rate, 2) : "n/a"} | ${
    summary.prev_pass_rate !== null
      ? fmtPercentDelta(pr, summary.prev_pass_rate)
      : "n/a"
  } |`;
  lines.push(passLine);
  lines.push(
    `| Repeat-mistake rate | ${fmt(m.repeat_mistake_rate)} | ${fmt(p?.repeat_mistake_rate ?? null)} | ${
      p ? fmtPercentDelta(m.repeat_mistake_rate, p.repeat_mistake_rate) : "n/a"
    } |`,
  );
  lines.push(
    `| Knowledge hit rate | ${fmt(m.knowledge_hit_rate)} | ${fmt(p?.knowledge_hit_rate ?? null)} | ${
      p ? fmtDelta(m.knowledge_hit_rate, p.knowledge_hit_rate) : "n/a"
    } |`,
  );
  lines.push(
    `| Time-to-first-correct-edit (ms) | ${m.time_to_first_correct_edit_ms ?? "n/a"} | ${p?.time_to_first_correct_edit_ms ?? "n/a"} | ${
      p && m.time_to_first_correct_edit_ms !== null && p.time_to_first_correct_edit_ms !== null
        ? fmtPercentDelta(m.time_to_first_correct_edit_ms, p.time_to_first_correct_edit_ms)
        : "n/a"
    } |`,
  );
  lines.push(
    `| User correction frequency | ${fmt(m.user_correction_frequency)} | ${fmt(p?.user_correction_frequency ?? null)} | ${
      p ? fmtDelta(m.user_correction_frequency, p.user_correction_frequency) : "n/a"
    } |`,
  );
  lines.push("");

  const failed = summary.results.filter((r) => !r.passed);
  if (failed.length > 0) {
    lines.push("## Failed tasks");
    for (const r of failed) {
      const firstFail = r.predicates.find((p) => !p.passed);
      lines.push(`- ${r.task_id}: ${firstFail?.reason ?? "predicate failed"}`);
    }
    lines.push("");
  }

  lines.push("## Task results");
  lines.push("| Task | Stack | Kind | Result | Duration (ms) |");
  lines.push("|---|---|---|---|---|");
  for (const r of summary.results) {
    lines.push(
      `| ${r.task_id} | ${r.stack} | ${r.kind} | ${r.passed ? "PASS" : "FAIL"} | ${r.duration_ms} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

export interface ReportPaths {
  metricsDir: string;
  reportPath: string;
}

export function resolveReportPaths(root: string, when: Date, override?: string): ReportPaths {
  const paths = projectPaths(root);
  if (override) {
    return {
      metricsDir: path.dirname(path.resolve(override)),
      reportPath: path.resolve(override),
    };
  }
  const file = reportFileName(when);
  return {
    metricsDir: paths.metricsDir,
    reportPath: path.join(paths.metricsDir, file),
  };
}

export async function writeReport(
  reportPath: string,
  body: string,
): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, body, "utf8");
}
