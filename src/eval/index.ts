import path from "node:path";
import { detect } from "../detect/index.js";
import { loadSyntheticTasks } from "./tasks.js";
import {
  discoverEpisodes,
  episodeToTask,
  readEpisode,
  stripApexContext,
  type EpisodeArtifacts,
} from "./replay.js";
import {
  computeRunMetrics,
  runTask,
} from "./runner.js";
import {
  findPriorReport,
  parsePriorReport,
  renderReport,
  resolveReportPaths,
  writeReport,
} from "./reporter.js";
import type {
  EvalStack,
  EvalTask,
  RunOptions,
  RunSummary,
  TaskResult,
} from "./types.js";

export * from "./types.js";
export {
  loadSyntheticTasks,
} from "./tasks.js";
export {
  discoverEpisodes,
  episodeToTask,
  readEpisode,
  stripApexContext,
  hashErrorSignature,
} from "./replay.js";
export {
  computeRepeatMistakeRate,
  computeKnowledgeHitRate,
  computeTimeToFirstCorrectEdit,
  computeMedianTimeToFirstCorrectEdit,
  computeUserCorrectionFrequency,
  computeRunMetrics,
  evaluatePredicate,
  runTask,
} from "./runner.js";
export {
  renderReport,
  reportFileName,
  resolveReportPaths,
  findPriorReport,
  parsePriorReport,
  writeReport,
} from "./reporter.js";

function detectionToStack(language: string, frameworks: string[]): EvalStack | undefined {
  if (frameworks.includes("next")) return "nextjs";
  if (language === "node") return "node-typescript";
  if (language === "python") return "python";
  return undefined;
}

export interface PlanResult {
  syntheticTasks: EvalTask[];
  replayTasks: Array<{ task: EvalTask; artifacts: EpisodeArtifacts }>;
}

export async function planRun(opts: RunOptions): Promise<PlanResult> {
  let stack = opts.stack;
  if (!stack) {
    try {
      const det = await detect(opts.root);
      stack = detectionToStack(det.language, det.frameworks);
    } catch {
      /* ignore */
    }
  }
  const synthetic = await loadSyntheticTasks(
    stack
      ? (opts.tasksDir ? { stack, tasksDir: opts.tasksDir } : { stack })
      : (opts.tasksDir ? { tasksDir: opts.tasksDir } : {}),
  );

  const replayTasks: Array<{ task: EvalTask; artifacts: EpisodeArtifacts }> = [];
  const episodeDirs = await discoverEpisodes(opts.root, opts.episodeGlob);
  for (const dir of episodeDirs) {
    const arts = await readEpisode(dir);
    const finalArts = opts.withApex ? arts : stripApexContext(arts);
    replayTasks.push({ task: episodeToTask(finalArts), artifacts: finalArts });
  }
  return { syntheticTasks: synthetic, replayTasks };
}

export async function runEval(opts: RunOptions): Promise<RunSummary> {
  const plan = await planRun(opts);
  const allResults: TaskResult[] = [];
  const replayArtifacts: EpisodeArtifacts[] = [];
  for (const t of plan.syntheticTasks) {
    const r = await runTask(t, { root: opts.root, withApex: opts.withApex });
    allResults.push(r);
  }
  for (const { task, artifacts } of plan.replayTasks) {
    replayArtifacts.push(artifacts);
    const r = await runTask(task, {
      root: opts.root,
      withApex: opts.withApex,
      artifacts,
    });
    allResults.push(r);
  }
  const metrics = computeRunMetrics(replayArtifacts);
  const now = (opts.now ? opts.now() : new Date());
  const { metricsDir, reportPath } = resolveReportPaths(opts.root, now, opts.out);
  const priorPath = await findPriorReport(metricsDir, path.basename(reportPath));
  let priorMetrics = null;
  let priorPassRate: number | null = null;
  if (priorPath) {
    const parsed = await parsePriorReport(priorPath);
    if (Object.keys(parsed.metrics).length > 0) {
      const pm = parsed.metrics;
      priorMetrics = {
        repeat_mistake_rate: pm.repeat_mistake_rate ?? 0,
        knowledge_hit_rate: pm.knowledge_hit_rate ?? 0,
        time_to_first_correct_edit_ms: pm.time_to_first_correct_edit_ms ?? null,
        user_correction_frequency: pm.user_correction_frequency ?? 0,
        total_errors: 0,
        total_prompts: 0,
        total_sessions: 0,
      };
    }
    priorPassRate = parsed.passRate;
  }
  const summary: RunSummary = {
    generated_at: now.toISOString(),
    pass_count: allResults.filter((r) => r.passed).length,
    fail_count: allResults.filter((r) => !r.passed).length,
    synthetic_count: plan.syntheticTasks.length,
    replay_count: plan.replayTasks.length,
    with_apex: opts.withApex,
    metrics,
    results: allResults,
    prev_report_path: priorPath,
    prev_metrics: priorMetrics,
    prev_pass_rate: priorPassRate,
  };
  if (!opts.dryRun) {
    const body = renderReport(summary);
    await writeReport(reportPath, body);
  }
  return summary;
}
