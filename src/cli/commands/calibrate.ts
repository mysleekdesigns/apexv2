import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultEpisodeIds, runCalibrator } from "../../confidence/index.js";

interface CliOpts {
  episode?: string;
  all?: boolean;
  dryRun?: boolean;
  cwd?: string;
}

async function runCli(opts: CliOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();

  const episodeIds = await defaultEpisodeIds(root, {
    ...(opts.all !== undefined ? { all: opts.all } : {}),
    ...(opts.episode !== undefined ? { episode: opts.episode } : {}),
  });

  const report = await runCalibrator({
    root,
    episodeIds,
    ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
  });

  const tag = opts.dryRun ? "[dry-run] " : "";
  const changed = report.transitions.filter((t) => t.changed);
  const unchanged = report.transitions.length - changed.length;

  console.log(
    kleur.cyan(
      `${tag}calibrate: scanned ${report.episodesScanned.length} episode(s), ` +
        `${report.transitions.length} entry transition(s) computed, ` +
        `${changed.length} changed, ` +
        `${unchanged} idempotent, ` +
        `${report.filesWritten.length} file(s) written.`,
    ),
  );

  for (const t of changed) {
    const arrow = t.from === t.to ? "=" : "→";
    const tally = Object.entries(t.signalsBySource)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    console.log(
      kleur.gray(
        `  ${tag}${t.entry.type}/${t.entry.id}: ${t.from} ${arrow} ${t.to} (score=${t.score}, signals=${t.signalCount}; ${tally})`,
      ),
    );
  }
  if (report.noSignalEntryCount > 0) {
    console.log(
      kleur.gray(
        `  ${report.noSignalEntryCount} entry(ies) had no signals — left untouched.`,
      ),
    );
  }
}

export function calibrateCommand(): Command {
  const cmd = new Command("calibrate");
  cmd
    .description(
      "Phase 4.2 — recompute confidence on knowledge entries from current signals " +
        "(thumbs, corrections, test runs, staleness).",
    )
    .option("--episode <id>", "calibrate using only this episode's signals")
    .option(
      "--all",
      "calibrate using the union of every episode's signals",
    )
    .option("--dry-run", "do not write any files; print proposed transitions")
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
  const standalone = new Command("apex-calibrate");
  standalone
    .description(
      "Recompute confidence on knowledge entries from current signals.",
    )
    .option("--episode <id>", "calibrate using only this episode's signals")
    .option("--all", "calibrate using every episode's signals")
    .option("--dry-run", "print proposed transitions without writing")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: CliOpts) => runCli(opts));
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
