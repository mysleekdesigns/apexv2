import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCurator } from "../../curator/index.js";
import { installCurationSchedule, type Cadence } from "../../curator/schedule.js";

interface CliOpts {
  dryRun?: boolean;
  staleDays?: string;
  cwd?: string;
  driftOnly?: boolean;
  markVerified?: boolean;
  schedule?: string;
}

function parseCadence(s: string): Cadence | null {
  if (s === "weekly" || s === "daily") return s;
  return null;
}

async function runCli(opts: CliOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const staleDays = opts.staleDays !== undefined ? parseInt(opts.staleDays, 10) : 30;

  if (isNaN(staleDays) || staleDays < 1) {
    console.error(kleur.red("error: --stale-days must be a positive integer"));
    process.exit(1);
  }

  // Schedule writing is independent of the curation pass — write first if requested.
  if (opts.schedule !== undefined) {
    const cadence = parseCadence(opts.schedule);
    if (!cadence) {
      console.error(kleur.red(`error: --schedule must be "weekly" or "daily"`));
      process.exit(1);
    }
    const desc = await installCurationSchedule(root, { cadence });
    console.log(
      kleur.cyan(
        `schedule: wrote ${path.relative(root, desc.path)} (cadence=${desc.cadence}, command="${desc.command}")`,
      ),
    );
  }

  const report = await runCurator(root, {
    dryRun: opts.dryRun,
    staleDays,
    driftOnly: opts.driftOnly,
    markVerified: opts.markVerified,
  });

  const tag = opts.dryRun ? "[dry-run] " : "";
  console.log(
    kleur.cyan(
      `${tag}curator: ${report.duplicateClusters.length} duplicate cluster(s), ` +
        `${report.staleEntries.length} stale entr${report.staleEntries.length === 1 ? "y" : "ies"}, ` +
        `${report.driftEntries.length} drift candidate(s), ` +
        `${report.mergeProposals.length} merge proposal(s) written.`,
    ),
  );

  if (report.driftHits.length > 0) {
    console.log(
      kleur.cyan(
        `  drift severity: high=${report.driftSeverity.high} medium=${report.driftSeverity.medium} low=${report.driftSeverity.low} (${report.driftHits.length} total hit(s))`,
      ),
    );
  }

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

  if (report.driftHits.length > 0) {
    console.log(kleur.yellow("  extended drift hits:"));
    for (const h of report.driftHits) {
      console.log(
        kleur.gray(`    ${h.entry_id} [${h.severity}] ${h.kind}: ${h.ref}`),
      );
    }
  }

  if (report.verifyResult) {
    const v = report.verifyResult;
    console.log(
      kleur.cyan(
        `  ${tag}verify: ${v.flagged.length} flagged, ${v.updated.length} updated, ${v.cleared.length} cleared`,
      ),
    );
  }

  if (!opts.dryRun) {
    console.log(kleur.gray(`  summary written to ${path.relative(root, report.summaryPath)}`));
  }
}

function configure(cmd: Command): Command {
  return cmd
    .option("--dry-run", "do not write any files; report what would be written")
    .option("--stale-days <n>", "days without validation or retrieval before an entry is stale (default: 30)")
    .option("--drift-only", "skip dedupe and stale checks; run only drift detection")
    .option(
      "--mark-verified",
      "write `verified: false` and `drift_report:` to flagged knowledge entries (default: off)",
    )
    .option("--schedule <cadence>", "write a curation schedule descriptor (cadence: weekly | daily)")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd());
}

export function curateCommand(): Command {
  const cmd = new Command("curate").description(
    "Curate the APEX knowledge base: detect duplicates, stale entries, and drift. Writes a summary to .apex/curation/<date>.md.",
  );
  configure(cmd).action(async (opts: CliOpts) => runCli(opts));
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
  const standalone = new Command("apex-curate").description(
    "Curate the APEX knowledge base: detect duplicates, stale entries, and drift.",
  );
  configure(standalone).action(async (opts: CliOpts) => runCli(opts));
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
