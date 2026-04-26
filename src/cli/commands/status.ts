import path from "node:path";
import fs from "fs-extra";
import kleur from "kleur";
import { Command } from "commander";
import { projectPaths } from "../../util/paths.js";
import { detect } from "../../detect/index.js";
import { readInstallJson } from "../../scaffold/installer.js";

async function countFiles(dir: string, ext = ".md"): Promise<number> {
  if (!(await fs.pathExists(dir))) return 0;
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  let n = 0;
  for (const e of entries) {
    const p = path.join(dir, e);
    const stat = await fs.stat(p).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) n += await countFiles(p, ext);
    else if (e.endsWith(ext)) n += 1;
  }
  return n;
}

async function countSettingsHooks(settingsPath: string): Promise<number> {
  if (!(await fs.pathExists(settingsPath))) return 0;
  const json = (await fs.readJson(settingsPath).catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!json || typeof json !== "object") return 0;
  const hooks = json["hooks"];
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return 0;
  return Object.keys(hooks as Record<string, unknown>).length;
}

export interface StatusFlags {
  cwd?: string;
}

export async function runStatus(flags: StatusFlags): Promise<number> {
  const root = path.resolve(flags.cwd ?? process.cwd());
  const paths = projectPaths(root);
  const install = await readInstallJson(root);
  if (!install) {
    process.stdout.write(
      kleur.yellow("APEX is not installed here. Run `apex init` to get started.\n"),
    );
    return 0;
  }

  const detection = await detect(root);
  const hookCount = await countSettingsHooks(paths.settingsJson);
  const counts = {
    decisions: await countFiles(path.join(paths.knowledgeDir, "decisions")),
    patterns: await countFiles(path.join(paths.knowledgeDir, "patterns")),
    gotchas: await countFiles(path.join(paths.knowledgeDir, "gotchas")),
    conventions: await countFiles(path.join(paths.knowledgeDir, "conventions")),
    proposed: await countFiles(paths.proposedDir),
  };

  process.stdout.write(`${kleur.bold("APEX status")}\n`);
  process.stdout.write(`  version:        ${install.apex_version}\n`);
  process.stdout.write(`  installed:      ${install.installed_at}\n`);
  process.stdout.write(`  last upgrade:   ${install.last_upgraded_at}\n`);
  process.stdout.write(`  source:         ${install.source_channel} (${install.source_command})\n`);
  process.stdout.write("\n");
  process.stdout.write(`  language:       ${detection.language}\n`);
  process.stdout.write(`  frameworks:     ${detection.frameworks.join(", ") || "(none)"}\n`);
  process.stdout.write(`  package mgr:    ${detection.packageManager ?? "(none)"}\n`);
  process.stdout.write(`  test runner:    ${detection.testRunner ?? "(none)"}\n`);
  process.stdout.write(`  lint:           ${detection.lint.join(", ") || "(none)"}\n`);
  process.stdout.write(`  format:         ${detection.format.join(", ") || "(none)"}\n`);
  process.stdout.write(`  ci:             ${detection.ci.join(", ") || "(none)"}\n`);
  process.stdout.write("\n");
  process.stdout.write(`  hooks:          ${hookCount} configured\n`);
  process.stdout.write(`  knowledge:      ${counts.decisions} decisions, ${counts.patterns} patterns, ${counts.gotchas} gotchas, ${counts.conventions} conventions\n`);
  process.stdout.write(`  proposed:       ${counts.proposed} awaiting review\n`);
  return 0;
}

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Print stack, hook count, knowledge counts")
    .option("--cwd <path>", "Run as if invoked from <path>")
    .action(async (opts) => {
      const code = await runStatus(opts);
      process.exit(code);
    });
}
