// Render and copy the `.claude/rules/*.md` files.
//
// `00-stack.md` is templated from a `.tmpl` file and filled with stack vars.
// `10-conventions.md` and `20-gotchas.md` are static stubs copied verbatim;
// they get populated later by the curator and reflector subagents.

import fs from "node:fs/promises";
import path from "node:path";
import type { StackDetection } from "../types/shared.js";
import { templatesDir } from "../util/paths.js";
import { renderCommonCommands } from "./commonCommands.js";

const STACK_TEMPLATE = "claude/rules/00-stack.md.tmpl";
const STATIC_RULES = ["claude/rules/10-conventions.md", "claude/rules/20-gotchas.md"];

export interface RenderedRule {
  /** Filename relative to `.claude/rules/` (e.g. "00-stack.md"). */
  filename: string;
  /** Final markdown content to write. */
  content: string;
}

/**
 * Render `.claude/rules/00-stack.md` from the template + StackDetection.
 * Returns the filled string. Caller is responsible for writing it.
 */
export async function renderStackRules(
  detection: StackDetection,
  version: string,
): Promise<string> {
  const tmpl = await readTemplate(STACK_TEMPLATE);
  return fillStackTemplate(tmpl, detection, version);
}

/**
 * Read the static rule stubs (`10-conventions.md`, `20-gotchas.md`) from
 * the templates directory and return them as `RenderedRule`s. The installer
 * writes these verbatim into `.claude/rules/` only if the target file does
 * not already exist (so user edits are not clobbered).
 */
export async function readStaticRuleStubs(): Promise<RenderedRule[]> {
  const out: RenderedRule[] = [];
  for (const rel of STATIC_RULES) {
    const content = await readTemplate(rel);
    out.push({ filename: path.basename(rel), content });
  }
  return out;
}

/**
 * Convenience: render every rule file (managed stack + stubs) in one pass.
 * Filenames are relative to `.claude/rules/`.
 */
export async function renderAllRules(
  detection: StackDetection,
  version: string,
): Promise<RenderedRule[]> {
  const stack: RenderedRule = {
    filename: "00-stack.md",
    content: await renderStackRules(detection, version),
  };
  const stubs = await readStaticRuleStubs();
  return [stack, ...stubs];
}

// --- internals ---------------------------------------------------------------

function fillStackTemplate(
  template: string,
  detection: StackDetection,
  version: string,
): string {
  const vars: Record<string, string> = {
    STACK_LANGUAGE: prettyLanguage(detection),
    STACK_FRAMEWORKS: listOrNone(detection.frameworks),
    STACK_PACKAGE_MANAGER: detection.packageManager ?? "_unknown_",
    STACK_TEST_RUNNER: detection.testRunner ?? "_unknown_",
    STACK_LINT: listOrNone(detection.lint),
    STACK_FORMAT: listOrNone(detection.format),
    STACK_CI: listOrNone(detection.ci),
    COMMON_COMMANDS: renderCommonCommands(detection),
    APEX_VERSION: version,
    INSTALL_DATE: new Date().toISOString().slice(0, 10),
  };
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{${k}\\}\\}`, "g");
    out = out.replace(re, v);
  }
  return out;
}

function prettyLanguage(detection: StackDetection): string {
  switch (detection.language) {
    case "node":
      return detection.hasTypeScript ? "Node / TypeScript" : "Node / JavaScript";
    case "python":
      return "Python";
    case "go":
      return "Go";
    case "rust":
      return "Rust";
    default:
      return "_unknown_";
  }
}

function listOrNone(items: string[]): string {
  return items.length === 0 ? "_none_" : items.join(", ");
}

async function readTemplate(rel: string): Promise<string> {
  return fs.readFile(path.join(templatesDir(), rel), "utf8");
}
