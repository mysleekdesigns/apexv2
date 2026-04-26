// Render the CLAUDE.md scaffold from the template, and merge into an
// existing user-authored CLAUDE.md without clobbering their content.
//
// Pure rendering: I/O is limited to reading the template file. The merge
// helper is fully pure (string -> string).

import fs from "node:fs/promises";
import path from "node:path";
import {
  APEX_MANAGED_BEGIN,
  APEX_MANAGED_END,
  type StackDetection,
} from "../types/shared.js";
import { templatesDir } from "../util/paths.js";
import { renderCommonCommands } from "./commonCommands.js";

const TEMPLATE_FILENAME = "CLAUDE.md.tmpl";

/**
 * Render the CLAUDE.md scaffold for a project. Reads the template from
 * `templates/CLAUDE.md.tmpl`, fills `{{VARS}}`, and returns the resulting
 * markdown. Output is guaranteed under 200 lines for typical stacks.
 */
export async function renderClaudeMd(
  detection: StackDetection,
  version: string,
): Promise<string> {
  const tmpl = await readTemplate(TEMPLATE_FILENAME);
  return fillTemplate(tmpl, buildVars(detection, version));
}

/**
 * Synchronous variant for callers that have already loaded the template.
 * Useful for tests and for code paths that bundle templates as strings.
 */
export function renderClaudeMdFromTemplate(
  template: string,
  detection: StackDetection,
  version: string,
): string {
  return fillTemplate(template, buildVars(detection, version));
}

/**
 * Splice the APEX-managed block into a user's existing CLAUDE.md.
 *
 * Rules:
 *  - If `existing` already contains `<!-- apex:begin -->` ... `<!-- apex:end -->`,
 *    replace the content between them (inclusive) with the managed block from
 *    `generated`. Everything outside the markers is preserved verbatim.
 *  - If `existing` has no markers, append the full generated block at the bottom,
 *    separated by a blank line. The user's content stays at the top.
 *  - If `existing` is empty/whitespace, return `generated` unchanged.
 *  - The merge is idempotent: applying it twice with the same `generated`
 *    yields the same result as applying it once.
 */
export function mergeIntoExistingClaudeMd(
  existing: string,
  generated: string,
): string {
  const trimmedExisting = existing.trim();
  if (trimmedExisting.length === 0) return ensureTrailingNewline(generated);

  const managedBlock = extractManagedBlock(generated);
  if (managedBlock === null) {
    // The generated content has no markers — fall back to appending it whole.
    // This shouldn't happen for our template, but it keeps the function total.
    return appendBlock(existing, generated);
  }

  const existingBegin = existing.indexOf(APEX_MANAGED_BEGIN);
  const existingEnd = existing.indexOf(APEX_MANAGED_END);

  if (existingBegin !== -1 && existingEnd !== -1 && existingEnd > existingBegin) {
    const before = existing.slice(0, existingBegin);
    const after = existing.slice(existingEnd + APEX_MANAGED_END.length);
    const head = stripTrailingNewlines(before);
    const tail = stripLeadingNewlines(after);
    const headSep = head.length === 0 ? "" : "\n\n";
    const tailSep = tail.length === 0 ? "" : "\n\n";
    return ensureTrailingNewline(`${head}${headSep}${managedBlock}${tailSep}${tail}`);
  }

  return appendBlock(existing, managedBlock);
}

// --- internals ---------------------------------------------------------------

interface TemplateVars {
  STACK_LANGUAGE: string;
  STACK_FRAMEWORKS: string;
  STACK_PACKAGE_MANAGER: string;
  STACK_TEST_RUNNER: string;
  STACK_LINT: string;
  STACK_FORMAT: string;
  STACK_CI: string;
  COMMON_COMMANDS: string;
  APEX_VERSION: string;
  INSTALL_DATE: string;
}

function buildVars(detection: StackDetection, version: string): TemplateVars {
  return {
    STACK_LANGUAGE: prettyLanguage(detection),
    STACK_FRAMEWORKS: list(detection.frameworks),
    STACK_PACKAGE_MANAGER: detection.packageManager ?? "_unknown_",
    STACK_TEST_RUNNER: detection.testRunner ?? "_unknown_",
    STACK_LINT: list(detection.lint),
    STACK_FORMAT: list(detection.format),
    STACK_CI: list(detection.ci),
    COMMON_COMMANDS: renderCommonCommands(detection),
    APEX_VERSION: version,
    INSTALL_DATE: today(),
  };
}

function prettyLanguage(detection: StackDetection): string {
  const map: Record<StackDetection["language"], string> = {
    node: detection.hasTypeScript ? "Node / TypeScript" : "Node / JavaScript",
    python: "Python",
    go: "Go",
    rust: "Rust",
    unknown: "_unknown_",
  };
  return map[detection.language];
}

function list(items: string[]): string {
  if (items.length === 0) return "_none_";
  return items.join(", ");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fillTemplate(template: string, vars: TemplateVars): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    const token = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    out = out.replace(token, value);
  }
  return out;
}

async function readTemplate(filename: string): Promise<string> {
  const full = path.join(templatesDir(), filename);
  return fs.readFile(full, "utf8");
}

/**
 * Extract the full managed region (markers included) from a generated CLAUDE.md.
 * Returns null if either marker is missing.
 */
function extractManagedBlock(generated: string): string | null {
  const beginIdx = generated.indexOf(APEX_MANAGED_BEGIN);
  const endIdx = generated.indexOf(APEX_MANAGED_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return null;
  return generated.slice(beginIdx, endIdx + APEX_MANAGED_END.length);
}

function appendBlock(existing: string, block: string): string {
  const trimmed = stripTrailingNewlines(existing);
  return ensureTrailingNewline(`${trimmed}\n\n${block}`);
}

function stripTrailingNewlines(s: string): string {
  return s.replace(/\n+$/, "");
}

function stripLeadingNewlines(s: string): string {
  return s.replace(/^\n+/, "");
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
