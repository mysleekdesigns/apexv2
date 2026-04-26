import fs from "node:fs/promises";
import path from "node:path";
import { parse as tomlParse, stringify as tomlStringify } from "smol-toml";
import { projectPaths } from "../util/paths.js";
import type { Confidence } from "../types/shared.js";

export interface AutoMergeConfig {
  /** When false, no auto-promotion occurs — user must run `apex promote` manually. */
  enabled: boolean;
  /** Number of sources required before a proposal is eligible for auto-promotion. */
  threshold: number;
  /** If a conflicting entry exists in knowledge/, skip auto-promotion for that proposal. */
  require_no_conflict: boolean;
  /**
   * Minimum confidence level for auto-promotion.
   * Proposals below this level are queued instead.
   */
  min_confidence: Confidence;
}

export interface GraphConfig {
  enabled: boolean;
}

export type CodeIndexLanguage = "ts" | "tsx" | "js" | "py";

export interface CodeIndexConfig {
  enabled: boolean;
  languages?: CodeIndexLanguage[];
  max_file_kb: number;
}

export interface VectorConfig {
  enabled: boolean;
  model: string;
  dim: number;
}

export interface ApexConfig {
  auto_merge: AutoMergeConfig;
  graph: GraphConfig;
  vector: VectorConfig;
  codeindex?: CodeIndexConfig;
}

const CODEINDEX_DEFAULTS: CodeIndexConfig = {
  enabled: false,
  max_file_kb: 2000,
};

const DEFAULTS: ApexConfig = {
  auto_merge: {
    enabled: true,
    threshold: 2,
    require_no_conflict: true,
    min_confidence: "low",
  },
  graph: {
    enabled: false,
  },
  vector: {
    enabled: false,
    model: "Xenova/all-MiniLM-L6-v2",
    dim: 384,
  },
};

export function getDefaults(): ApexConfig {
  return {
    auto_merge: { ...DEFAULTS.auto_merge },
    graph: { ...DEFAULTS.graph },
    vector: { ...DEFAULTS.vector },
  };
}

export function getCodeIndexConfig(config: ApexConfig): CodeIndexConfig {
  return config.codeindex ?? { ...CODEINDEX_DEFAULTS };
}

/**
 * Load .apex/config.toml from the given project root.
 * Returns safe defaults when the file is missing or fields are absent —
 * never throws on missing / partial config.
 */
export async function loadConfig(root: string): Promise<ApexConfig> {
  const p = projectPaths(root).configToml;
  let raw: Record<string, unknown> = {};

  try {
    const text = await fs.readFile(p, "utf8");
    raw = tomlParse(text) as Record<string, unknown>;
  } catch {
    // Missing or unparseable — fall through to defaults.
  }

  const defaults = getDefaults();

  const rawAm = (raw["auto_merge"] ?? {}) as Record<string, unknown>;

  const enabled =
    typeof rawAm["enabled"] === "boolean" ? rawAm["enabled"] : defaults.auto_merge.enabled;

  const threshold =
    typeof rawAm["threshold"] === "number" ? rawAm["threshold"] : defaults.auto_merge.threshold;

  const require_no_conflict =
    typeof rawAm["require_no_conflict"] === "boolean"
      ? rawAm["require_no_conflict"]
      : defaults.auto_merge.require_no_conflict;

  const validConfidences: Confidence[] = ["low", "medium", "high"];
  const min_confidence: Confidence = validConfidences.includes(
    rawAm["min_confidence"] as Confidence,
  )
    ? (rawAm["min_confidence"] as Confidence)
    : defaults.auto_merge.min_confidence;

  const rawGraph = (raw["graph"] ?? {}) as Record<string, unknown>;
  const graphEnabled =
    typeof rawGraph["enabled"] === "boolean"
      ? rawGraph["enabled"]
      : defaults.graph.enabled;

  let codeindex: CodeIndexConfig | undefined;
  if (raw["codeindex"] !== undefined) {
    const rawCi = (raw["codeindex"] ?? {}) as Record<string, unknown>;
    const ciEnabled =
      typeof rawCi["enabled"] === "boolean" ? rawCi["enabled"] : CODEINDEX_DEFAULTS.enabled;
    const ciMaxFileKb =
      typeof rawCi["max_file_kb"] === "number" && rawCi["max_file_kb"] > 0
        ? rawCi["max_file_kb"]
        : CODEINDEX_DEFAULTS.max_file_kb;
    const allowedLangs: CodeIndexLanguage[] = ["ts", "tsx", "js", "py"];
    let ciLanguages: CodeIndexLanguage[] | undefined;
    if (Array.isArray(rawCi["languages"])) {
      const filtered = (rawCi["languages"] as unknown[]).filter((v): v is CodeIndexLanguage =>
        typeof v === "string" && (allowedLangs as string[]).includes(v),
      );
      if (filtered.length > 0) ciLanguages = filtered;
    }
    codeindex = {
      enabled: ciEnabled,
      max_file_kb: ciMaxFileKb,
      ...(ciLanguages ? { languages: ciLanguages } : {}),
    };
  }

  const rawVec = (raw["vector"] ?? {}) as Record<string, unknown>;
  const vecEnabled =
    typeof rawVec["enabled"] === "boolean" ? rawVec["enabled"] : defaults.vector.enabled;
  const vecModel =
    typeof rawVec["model"] === "string" && rawVec["model"].length > 0
      ? rawVec["model"]
      : defaults.vector.model;
  const vecDim =
    typeof rawVec["dim"] === "number" && Number.isFinite(rawVec["dim"]) && rawVec["dim"] > 0
      ? Math.floor(rawVec["dim"])
      : defaults.vector.dim;

  return {
    auto_merge: {
      enabled,
      threshold,
      require_no_conflict,
      min_confidence,
    },
    graph: { enabled: graphEnabled },
    vector: {
      enabled: vecEnabled,
      model: vecModel,
      dim: vecDim,
    },
    ...(codeindex ? { codeindex } : {}),
  };
}

/** Persist config back to .apex/config.toml. */
export async function saveConfig(root: string, config: ApexConfig): Promise<void> {
  const p = projectPaths(root).configToml;
  await fs.mkdir(path.dirname(p), { recursive: true });
  const text = tomlStringify(config as Parameters<typeof tomlStringify>[0]);
  await fs.writeFile(p, text, "utf8");
}

/** Toggle the [vector] enabled flag in-place, preserving other config fields. */
export async function setVectorEnabled(root: string, enabled: boolean): Promise<ApexConfig> {
  const cfg = await loadConfig(root);
  cfg.vector.enabled = enabled;
  await saveConfig(root, cfg);
  return cfg;
}
