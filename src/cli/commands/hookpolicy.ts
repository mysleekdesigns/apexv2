// `apex hookpolicy` CLI command.
//
// Subcommands:
//   report   — analyse episodes and write .apex/proposed/_hook-policy-<date>.md
//   dry-run  — same analysis, print to stdout only (no file written)
//   apply    — alias for report (emphasises file-only; never edits settings.json)
//
// No settings.json is ever modified by this command. The output file is a
// human-readable recommendation for the user to review and act on manually.

import { Command } from "commander";
import kleur from "kleur";
import { runHookPolicy } from "../../hookpolicy/index.js";

interface CliOpts {
  windowDays?: string;
  cwd?: string;
  dryRun?: boolean;
}

function parseWindowDays(raw: string | undefined): number {
  if (raw === undefined) return 14;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

async function runReport(opts: CliOpts, dryRun: boolean): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const windowDays = parseWindowDays(opts.windowDays);

  const report = await runHookPolicy(root, { windowDays, dryRun });

  if (dryRun) {
    process.stdout.write(report.markdown + "\n");
    console.log(
      kleur.cyan(
        `[dry-run] hookpolicy: ${report.episodesScanned} episode(s) scanned, ` +
        `${report.recommendations.length} hook(s) evaluated (no file written).`,
      ),
    );
  } else {
    console.log(
      kleur.cyan(
        `hookpolicy: ${report.episodesScanned} episode(s) scanned, ` +
        `${report.recommendations.length} hook(s) evaluated.`,
      ),
    );
    console.log(kleur.gray(`  wrote ${report.outputPath}`));

    const disabled = report.recommendations.filter((r) => r.recommendation === "disable");
    const keep = report.recommendations.filter((r) => r.recommendation === "keep");
    const noData = report.recommendations.filter((r) => r.recommendation === "insufficient-data");

    if (keep.length > 0) {
      console.log(kleur.green(`  keep: ${keep.map((r) => r.hook).join(", ")}`));
    }
    if (disabled.length > 0) {
      console.log(kleur.yellow(`  disable: ${disabled.map((r) => r.hook).join(", ")}`));
    }
    if (noData.length > 0) {
      console.log(kleur.gray(`  insufficient-data: ${noData.map((r) => r.hook).join(", ")}`));
    }

    console.log(
      kleur.gray(
        `  review ${report.outputPath} — APEX never edits .claude/settings.json automatically.`,
      ),
    );
  }
}

export function hookpolicyCommand(): Command {
  const cmd = new Command("hookpolicy");
  cmd.description(
    "Analyse hook signal yield across recent episodes and recommend which hooks to keep or disable.",
  );

  // report subcommand
  cmd
    .command("report")
    .description(
      "Analyse episodes and write a recommendation to .apex/proposed/_hook-policy-<date>.md. " +
      "Never edits .claude/settings.json.",
    )
    .option("--window-days <n>", "episode window in days (default: 14)")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .option("--dry-run", "print report to stdout; do not write file")
    .action(async (opts: CliOpts) => {
      await runReport(opts, opts.dryRun ?? false);
    });

  // dry-run subcommand (alias)
  cmd
    .command("dry-run")
    .description("Alias for `report --dry-run`. Prints to stdout; no file written.")
    .option("--window-days <n>", "episode window in days (default: 14)")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: CliOpts) => {
      await runReport(opts, true);
    });

  // apply subcommand (alias for report — emphasises write-only, no settings edits)
  cmd
    .command("apply")
    .description(
      "Alias for `report`. Writes the recommendation file. " +
      "APEX never edits .claude/settings.json automatically — apply changes yourself.",
    )
    .option("--window-days <n>", "episode window in days (default: 14)")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .option("--dry-run", "print report to stdout; do not write file")
    .action(async (opts: CliOpts) => {
      await runReport(opts, opts.dryRun ?? false);
    });

  return cmd;
}
