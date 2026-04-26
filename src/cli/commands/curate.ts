import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCurator } from "../../curator/index.js";

interface CliOpts {
  dryRun?: boolean;
  staleDays?: string;
  cwd?: string;
}

async function runCli(opts: CliOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const staleDays = opts.staleDays !== undefined ? parseInt(opts.staleDays, 10) : 30;

  if (isNaN(staleDays) || staleDays < 1) {
    console.error(kleur.red("error: --stale-days must be a positive integer"));
    process.exit(1);
  }

  const report = await runCurator(root, { dryRun: opts.dryRun, staleDays });

  const tag = opts.dryRun ? "[dry-run] " : "";
  console.log(
    kleur.cyan(
      `${tag}curator: ${report.duplicateClusters.length} duplicate cluster(s), ` +
        `${report.staleEntries.length} stale entr${report.staleEntries.length === 1 ? "y" : "ies"}, ` +
        `${report.driftEntries.length} drift candidate(s), ` +
        `${report.mergeProposals.length} merge proposal(s) written.`,
    ),
  );

  if (report.duplicateClusters.length > 0) {
    console.log(kleur.yellow("  duplicate clusters:"));
    for (const c of report.duplicateClusters) {
      const action = c.proposeMerge ? "merge proposed" : "warning";
      console.log(
        kleur.gray(
          `    [${action}] ${c.pair.a.frontmatter.id} ↔ ${c.pair.b.frontmatter.id} ` +
            `(${c.pair.via}, ${(c.pair.score * 100).toFixed(1)}%)`,
        ),
      );
    }
  }

  for (const p of report.mergeProposals) {
    console.log(kleur.gray(`  ${tag}merge proposal: ${path.relative(root, p)}`));
  }

  if (report.staleEntries.length > 0) {
    console.log(kleur.yellow("  stale entries:"));
    for (const s of report.staleEntries) {
      console.log(
        kleur.gray(
          `    ${s.entry.frontmatter.id} — last validated ${s.lastValidated} (${s.daysSinceValidated}d ago)`,
        ),
      );
    }
  }

  if (report.driftEntries.length > 0) {
    console.log(kleur.yellow("  drift candidates:"));
    for (const d of report.driftEntries) {
      console.log(kleur.gray(`    ${d.entry.frontmatter.id} — missing file: ${d.missingPath}`));
    }
  }

  if (!opts.dryRun) {
    console.log(kleur.gray(`  summary written to ${path.relative(root, report.summaryPath)}`));
  }
}

export function curateCommand(): Command {
  const cmd = new Command("curate");
  cmd
    .description(
      "Curate the APEX knowledge base: detect duplicates, stale entries, and drift. Writes a summary to .apex/curation/<date>.md.",
    )
    .option("--dry-run", "do not write any files; report what would be written")
    .option("--stale-days <n>", "days without validation or retrieval before an entry is stale (default: 30)")
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
  const standalone = new Command("apex-curate");
  standalone
    .description(
      "Curate the APEX knowledge base: detect duplicates, stale entries, and drift.",
    )
    .option("--dry-run", "do not write any files; report what would be written")
    .option("--stale-days <n>", "days without validation or retrieval before an entry is stale (default: 30)")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: CliOpts) => runCli(opts));
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
