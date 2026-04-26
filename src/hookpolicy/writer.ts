// Writes the hook policy markdown report to .apex/proposed/_hook-policy-<YYYY-MM-DD>.md

import fs from "node:fs";
import path from "node:path";
import { projectPaths } from "../util/paths.js";
import type { HookRecommendation } from "./recommender.js";

export interface WriterInput {
  date: string; // YYYY-MM-DD
  windowDays: number;
  episodesScanned: number;
  recommendations: HookRecommendation[];
}

export function renderReport(input: WriterInput): string {
  const { date, windowDays, episodesScanned, recommendations } = input;
  const parts: string[] = [];

  parts.push("<!-- PROPOSED — review before adjusting .claude/settings.json -->");
  parts.push(`# Hook policy report — ${date}`);
  parts.push("");
  parts.push(`Window: last ${windowDays} days, ${episodesScanned} episode(s) scanned.`);
  parts.push("");

  // ---- Recommendations section -----------------------------------------------
  parts.push("## Recommendations");
  parts.push("");
  for (const r of recommendations) {
    const label = r.recommendation === "keep"
      ? "keep"
      : r.recommendation === "disable"
        ? "**disable**"
        : "insufficient-data";
    parts.push(`- **${r.hook}** — ${label} (${r.reason})`);
  }
  parts.push("");

  // ---- Evidence section ------------------------------------------------------
  parts.push("## Evidence");
  parts.push("");
  for (const r of recommendations) {
    parts.push(`### ${r.hook}`);
    if (r.evidence.length === 0) {
      parts.push("No signal data.");
    } else {
      for (const ev of r.evidence) {
        parts.push(`- ${ev}`);
      }
    }
    parts.push("");
  }

  // ---- How to apply section --------------------------------------------------
  parts.push("## How to apply");
  parts.push("");
  parts.push(
    "Edit `.claude/settings.json` and remove the `disable`-recommended hooks from the `hooks` array. " +
    "APEX never edits this file automatically — all changes are made by the user.",
  );
  parts.push("");

  const disabled = recommendations.filter((r) => r.recommendation === "disable");
  if (disabled.length > 0) {
    parts.push("Hooks recommended for removal:");
    for (const r of disabled) {
      parts.push(`- \`${r.hook}\``);
    }
    parts.push("");
  }

  return parts.join("\n");
}

export function writeReport(
  root: string,
  input: WriterInput,
): string {
  const paths = projectPaths(root);
  fs.mkdirSync(paths.proposedDir, { recursive: true });
  const filename = `_hook-policy-${input.date}.md`;
  const filePath = path.join(paths.proposedDir, filename);
  fs.writeFileSync(filePath, renderReport(input), "utf8");
  return filePath;
}
