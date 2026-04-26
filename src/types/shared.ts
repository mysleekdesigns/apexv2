// Shared types used by every APEX component (CLI, hooks, recall, archaeologist).
// Schemas mirror specs/knowledge-schema.md and specs/episode-schema.md.

export type KnowledgeType = "decision" | "pattern" | "gotcha" | "convention";
export type Confidence = "low" | "medium" | "high";
export type AppliesTo = "user" | "team" | "all";
export type SourceKind =
  | "bootstrap"
  | "correction"
  | "reflection"
  | "manual"
  | "pr";

export interface KnowledgeSource {
  kind: SourceKind;
  ref: string;
}

export interface KnowledgeFrontmatter {
  id: string;
  type: KnowledgeType;
  title: string;
  applies_to: AppliesTo;
  confidence: Confidence;
  sources: KnowledgeSource[];
  created: string;
  last_validated: string;
  supersedes?: string[];
  tags?: string[];
  schema_version?: number;
}

export interface KnowledgeEntry {
  frontmatter: KnowledgeFrontmatter;
  body: string;
  /** Repo-relative path of the .md file on disk. */
  path: string;
}

// --- Stack detection (1.1) ----------------------------------------------------

export interface StackDetection {
  language: "node" | "python" | "go" | "rust" | "unknown";
  frameworks: string[];
  packageManager: string | null;
  testRunner: string | null;
  lint: string[];
  format: string[];
  ci: string[];
  hasTypeScript: boolean;
  rawSignals: Record<string, string>;
}

// --- Install metadata (1.1, see specs/install.md §5) -------------------------

export interface InstallJson {
  apex_version: string;
  installed_at: string;
  last_upgraded_at: string;
  source_channel: "npm" | "pypi" | "curl" | "local";
  source_command: string;
  schema_versions: {
    knowledge: number;
    episode: number;
    config: number;
  };
  claude_code_min_version: string;
}

// --- Episode (1.3, see specs/episode-schema.md) ------------------------------

export interface EpisodeMeta {
  schema_version: 1;
  episode_id: string;
  session_id: string;
  started_at: string;
  ended_at: string | null;
  model: string;
  claude_code_version: string;
  repo_head_sha: string;
  repo_branch: string | null;
  cwd: string;
  hooks_fired_count: {
    session_start: number;
    user_prompt_submit: number;
    post_tool_use: number;
    post_tool_use_failure: number;
    pre_compact: number;
    session_end: number;
  };
  reflection?: {
    status: "pending" | "in_progress" | "complete" | "failed";
    completed_at: string | null;
    proposed_entries: string[];
  };
}

// --- Recall (1.4) ------------------------------------------------------------

export interface RecallHit {
  entry_id: string;
  entry_type: KnowledgeType;
  title: string;
  path: string;
  excerpt: string;
  score: number;
  rank: number;
  tier: "fts" | "vector" | "hybrid" | "graph";
  last_validated: string;
  confidence: Confidence;
}

// --- Constants ---------------------------------------------------------------

export const SCHEMA_VERSIONS = {
  knowledge: 1,
  episode: 1,
  config: 1,
} as const;

export const CLAUDE_CODE_MIN_VERSION = "2.1.0";

export const APEX_MANAGED_BEGIN = "<!-- apex:begin -->";
export const APEX_MANAGED_END = "<!-- apex:end -->";
