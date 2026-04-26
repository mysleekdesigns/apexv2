import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runReflector } from "../../reflector/index.js";

interface CliOpts {
  episode?: string;
  all?: boolean;
  dryRun?: boolean;
  cwd?: string;
}

async function runCli(opts: CliOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const report = await runReflector(root, {
    dryRun: opts.dryRun,
    episode: opts.episode,
    all: opts.all,
  });

  const tag = opts.dryRun ? "[dry-run] " : "";
  console.log(
    kleur.cyan(
      `${tag}reflector: ${report.episodesProcessed.length} episode(s) processed, ` +
        `${report.gotchaCandidates} gotcha candidate(s), ` +
        `${report.conventionCandidates} convention candidate(s), ` +
        `${report.proposalsWritten.length} file(s) written, ` +
        `${report.proposalsSkipped.length} skipped.`,
    ),
  );

  if (report.episodesSkipped.length > 0) {
    for (const skip of report.episodesSkipped) {
      console.log(kleur.yellow(`  warn: episode ${skip.id} skipped — ${skip.reason}`));
    }
  }
  for (const w of report.proposalsWritten) {
    console.log(kleur.gray(`  ${tag}wrote ${w}`));
  }
  for (const s of report.proposalsSkipped) {
    console.log(kleur.gray(`  skipped ${s.path} (${s.reason})`));
  }
}

export function reflectCommand(): Command {
  const cmd = new Command("reflect");
  cmd
    .description(
      "Scan recent episodes for repeated failures and corrections, propose durable lessons to .apex/proposed/.",
    )
    .option("--episode <id>", "process a single episode by id")
    .option("--all", "process all episodes without completed reflection")
    .option("--dry-run", "do not write any files; print what would be written")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: CliOpts) => runCli(opts));
  return cmd;
}

function isInvokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const here = fileURLToPath(import.meta.url);
    return path.resolve(here) === path.resolve(argv1);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  const standalone = new Command("apex-reflect");
  standalone
    .description(
      "Scan recent episodes for repeated failures and corrections, propose durable lessons to .apex/proposed/.",
    )
    .option("--episode <id>", "process a single episode by id")
    .option("--all", "process all episodes without completed reflection")
    .option("--dry-run", "do not write any files; print what would be written")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: CliOpts) => runCli(opts));
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
