import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runArchaeologist } from "../../archaeologist/index.js";

interface CliOpts {
  dryRun?: boolean;
  skipGit?: boolean;
  root?: string;
}

async function runCli(opts: CliOpts): Promise<void> {
  const root = opts.root ?? process.cwd();
  const report = await runArchaeologist(root, {
    dryRun: opts.dryRun,
    skipGit: opts.skipGit,
  });

  const tag = opts.dryRun ? "[dry-run] " : "";
  console.log(
    kleur.cyan(
      `${tag}archaeologist: ${report.signalCount} signal(s) gathered, ${report.draftCount} draft(s), ${report.proposalsWritten.length} file(s) written, ${report.proposalsSkipped.length} skipped.`,
    ),
  );
  for (const skip of report.signalsSkipped) {
    console.log(kleur.yellow(`  warn: signal ${skip.kind} skipped — ${skip.reason}`));
  }
  for (const w of report.proposalsWritten) {
    console.log(kleur.gray(`  ${tag}wrote ${w}`));
  }
  for (const s of report.proposalsSkipped) {
    console.log(kleur.gray(`  skipped ${s.path} (${s.reason})`));
  }
}

export function archaeologistCommand(): Command {
  const cmd = new Command("archaeologist");
  cmd
    .description(
      "Bootstrap APEX knowledge from existing repo signals (git, README, deps, CI). Writes proposals to .apex/proposed/.",
    )
    .option("--dry-run", "do not write any files; print what would be written")
    .option("--skip-git", "do not run git log (useful in non-git repos or for speed)")
    .option("--root <path>", "project root (default: cwd)", process.cwd())
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
  const standalone = new Command("apex-archaeologist");
  standalone
    .description(
      "Bootstrap APEX knowledge from existing repo signals (git, README, deps, CI). Writes proposals to .apex/proposed/.",
    )
    .option("--dry-run", "do not write any files; print what would be written")
    .option("--skip-git", "do not run git log (useful in non-git repos or for speed)")
    .option("--root <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: CliOpts) => runCli(opts));
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
