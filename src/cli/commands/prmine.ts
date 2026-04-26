// CLI command: apex prmine
//
// Ingests merged PR diffs and commit messages to extract candidate
// decisions/gotchas as proposals in .apex/proposed/.
//
// Usage:
//   apex prmine [--since <git-ref>] [--limit <n>] [--include-reviews] [--dry-run] [--cwd <path>]

import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPrMining } from "../../prmining/index.js";

interface CliOpts {
  since?: string;
  limit?: string;
  includeReviews?: boolean;
  dryRun?: boolean;
  cwd?: string;
}

async function runCli(opts: CliOpts): Promise<void> {
  const root = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  const limit = opts.limit ? parseInt(opts.limit, 10) : 50;

  const report = await runPrMining(root, {
    since: opts.since,
    limit: isNaN(limit) ? 50 : limit,
    includeReviews: opts.includeReviews,
    dryRun: opts.dryRun,
  });

  const tag = opts.dryRun ? "[dry-run] " : "";
  console.log(
    kleur.cyan(
      `${tag}prmine: ${report.commitsScanned} commit(s) scanned, ` +
        `${report.prsScanned} PR(s) scanned, ` +
        `${report.candidatesFound} candidate(s) found, ` +
        `${report.proposalsWritten.length} proposal(s) written, ` +
        `${report.proposalsSkipped.length} skipped.`,
    ),
  );

  for (const w of report.proposalsWritten) {
    console.log(kleur.gray(`  ${tag}wrote ${w}`));
  }
  for (const s of report.proposalsSkipped) {
    console.log(kleur.gray(`  skipped ${s.path} (${s.reason})`));
  }

  if (
    report.commitsScanned === 0 &&
    report.prsScanned === 0
  ) {
    console.log(
      kleur.yellow(
        "  warn: no commits found — is this a git repo? Try --since HEAD~20 or check your cwd.",
      ),
    );
  }
}

export function prmineCommand(): Command {
  const cmd = new Command("prmine");
  cmd
    .description(
      "Mine merged PR diffs and commit messages to propose durable knowledge entries to .apex/proposed/.",
    )
    .option(
      "--since <git-ref>",
      "start mining from this git ref (e.g. HEAD~50 or a commit SHA)",
    )
    .option(
      "--limit <n>",
      "maximum number of commits to examine (default: 50)",
      "50",
    )
    .option(
      "--include-reviews",
      "also fetch merged PR review comments via gh CLI (requires authentication)",
    )
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
  const standalone = new Command("apex-prmine");
  standalone
    .description(
      "Mine merged PR diffs and commit messages to propose durable knowledge entries to .apex/proposed/.",
    )
    .option(
      "--since <git-ref>",
      "start mining from this git ref (e.g. HEAD~50 or a commit SHA)",
    )
    .option("--limit <n>", "maximum number of commits to examine (default: 50)", "50")
    .option(
      "--include-reviews",
      "also fetch merged PR review comments via gh CLI (requires authentication)",
    )
    .option("--dry-run", "do not write any files; print what would be written")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: CliOpts) => runCli(opts));
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
