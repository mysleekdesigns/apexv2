// Curation schedule descriptor.
//
// v1 emits a single TOML descriptor at `.apex/schedule/curate.toml`. We do not
// integrate directly with Claude Code's scheduled-tasks primitive; instead the
// file format is documented so a future plugin install (Phase 5) can pick it up.

import path from "node:path";
import fs from "fs-extra";
import { projectPaths } from "../util/paths.js";

export type Cadence = "weekly" | "daily";

export interface ScheduleDescriptor {
  cadence: Cadence;
  command: string;
  path: string;
}

export interface InstallScheduleOpts {
  cadence: Cadence;
  /**
   * Override the command to run. Defaults to `apex curate` so the existing
   * `apex-curator.md` agent template can pick it up unchanged.
   */
  command?: string;
}

const SCHEMA_VERSION = 1;

/**
 * Write `.apex/schedule/curate.toml` describing the curation cadence.
 *
 * The file format (TOML, hand-rolled to avoid a new dependency):
 *
 *   schema_version = 1
 *   cadence = "weekly"      # weekly | daily
 *   command = "apex curate"
 *   description = "..."
 *
 * Returns the absolute path to the written descriptor.
 */
export async function installCurationSchedule(
  root: string,
  opts: InstallScheduleOpts,
): Promise<ScheduleDescriptor> {
  const paths = projectPaths(root);
  const dir = path.join(paths.apexDir, "schedule");
  const target = path.join(dir, "curate.toml");
  const command = opts.command ?? "apex curate";

  const content = renderToml({
    schema_version: SCHEMA_VERSION,
    cadence: opts.cadence,
    command,
    description:
      opts.cadence === "weekly"
        ? "Weekly curation pass: dedupe + stale + drift detection."
        : "Daily curation pass: dedupe + stale + drift detection.",
  });

  await fs.ensureDir(dir);
  await fs.writeFile(target, content, "utf8");

  return { cadence: opts.cadence, command, path: target };
}

interface TomlRecord {
  schema_version: number;
  cadence: Cadence;
  command: string;
  description: string;
}

function renderToml(rec: TomlRecord): string {
  const lines: string[] = [];
  lines.push(`# APEX curation schedule descriptor (Phase 4.3).`);
  lines.push(
    `# Future plugin installs read this file to wire the curator into Claude Code's scheduler.`,
  );
  lines.push("");
  lines.push(`schema_version = ${rec.schema_version}`);
  lines.push(`cadence = "${rec.cadence}"`);
  lines.push(`command = ${tomlString(rec.command)}`);
  lines.push(`description = ${tomlString(rec.description)}`);
  lines.push("");
  return lines.join("\n");
}

function tomlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
