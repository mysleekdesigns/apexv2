// Types for the APEX eval harness (Phase 4.1).

export type EvalStack = "node-typescript" | "python" | "nextjs";
export type EvalKind = "synthetic" | "replay";

export type SuccessPredicate =
  | { kind: "file_exists"; ref: string }
  | { kind: "contains_string"; ref: string; value: string }
  | { kind: "regex_match"; ref: string; pattern: string; flags?: string }
  | { kind: "command_exits_zero"; cmd: string; cwd?: string; timeout_ms?: number }
  | { kind: "custom_predicate"; cmd: string; cwd?: string; timeout_ms?: number };

export interface EvalTaskFrontmatter {
  id: string;
  stack: EvalStack;
  kind: EvalKind;
  title: string;
  starting_commit?: string | null;
  prompts: string[];
  success_predicates: SuccessPredicate[];
  source_episode?: string;
  tags?: string[];
}

export interface EvalTask {
  frontmatter: EvalTaskFrontmatter;
  body: string;
  /** Repo-relative POSIX path of the .md file on disk, or "<replay:episode-id>" for synthetic-from-replay. */
  path: string;
}

export interface PredicateResult {
  kind: SuccessPredicate["kind"];
  passed: boolean;
  reason: string;
}

export interface TaskSignals {
  tools_used: number;
  files_touched: number;
  errors_recovered: number;
  retrieval_hits: number;
  retrieval_used: number;
}

export interface TaskResult {
  task_id: string;
  stack: EvalStack;
  kind: EvalKind;
  passed: boolean;
  duration_ms: number;
  predicates: PredicateResult[];
  signals: TaskSignals;
  notes?: string;
}

export interface RunMetrics {
  repeat_mistake_rate: number;
  knowledge_hit_rate: number;
  time_to_first_correct_edit_ms: number | null;
  user_correction_frequency: number;
  /** Total errors observed (denominator for repeat-mistake-rate). */
  total_errors: number;
  /** Total prompts observed (denominator for correction frequency, scaled per-100). */
  total_prompts: number;
  /** Sessions counted toward knowledge-hit-rate. */
  total_sessions: number;
}

export interface RunSummary {
  generated_at: string;
  pass_count: number;
  fail_count: number;
  synthetic_count: number;
  replay_count: number;
  with_apex: boolean;
  metrics: RunMetrics;
  results: TaskResult[];
  /** Path to the previous report, if any, used for delta. */
  prev_report_path: string | null;
  prev_metrics: RunMetrics | null;
  prev_pass_rate: number | null;
}

export interface RunOptions {
  root: string;
  stack?: EvalStack;
  episodeGlob?: string;
  withApex: boolean;
  out?: string;
  dryRun?: boolean;
  /** Override the templates dir used to find synthetic tasks (useful for tests). */
  tasksDir?: string;
  /** Optional clock for deterministic report names. */
  now?: () => Date;
}
