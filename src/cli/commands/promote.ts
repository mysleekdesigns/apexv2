import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  autoPromoteAll,
  findProposalById,
  loadConfig,
  findEligible,
  promoteProposal,
  validateProposal,
} from "../../promote/index.js";

interface CliOpts {
  dryRun?: boolean;
  auto?: boolean;
  force?: boolean;
  root?: string;
}

async function runAutoPromote(opts: CliOpts): Promise<void> {
  const root = opts.root ?? process.cwd();

  if (opts.dryRun) {
    await runDryRun(root, opts);
    return;
  }

  const report = await autoPromoteAll(root);

  for (const result of report.promoted) {
    if (result.status === "promoted") {
      console.log(
        kleur.green(`  promoted  ${path.basename(result.proposalPath)} → ${result.destPath}`),
      );
    } else if (result.status === "skipped") {
      console.log(
        kleur.yellow(`  skipped   ${path.basename(result.proposalPath)}: ${result.reason}`),
      );
    } else {
      console.log(
        kleur.red(`  error     ${path.basename(result.proposalPath)}: ${result.reason}`),
      );
    }
  }

  for (const queued of report.queued) {
    console.log(
      kleur.gray(`  queued    ${path.basename(queued.proposalPath)}: ${queued.reason}`),
    );
  }

  const promotedCount = report.promoted.filter((r) => r.status === "promoted").length;
  console.log(
    kleur.cyan(
      `promote: ${promotedCount} promoted, ${report.queued.length} queued.`,
    ),
  );
}

async function runDryRun(root: string, opts: CliOpts): Promise<void> {
  const config = await loadConfig(root);
  const candidates = await findEligible(root, config);

  const wouldPromote = candidates.filter((c) => c.eligible);
  const wouldQueue = candidates.filter((c) => !c.eligible);

  console.log(kleur.cyan("[dry-run] promote report:"));
  for (const c of wouldPromote) {
    console.log(kleur.green(`  would-promote  ${path.basename(c.proposalPath)}`));
  }
  for (const c of wouldQueue) {
    console.log(kleur.gray(`  would-queue    ${path.basename(c.proposalPath)}: ${c.reason}`));
  }

  console.log(
    kleur.cyan(
      `[dry-run] would promote: ${wouldPromote.length}, would queue: ${wouldQueue.length}`,
    ),
  );
}

async function runSinglePromote(id: string, opts: CliOpts): Promise<void> {
  const root = opts.root ?? process.cwd();
  const proposalPath = await findProposalById(root, id);

  if (!proposalPath) {
    console.error(kleur.red(`promote: proposal '${id}' not found in .apex/proposed/`));
    process.exit(1);
  }

  if (opts.dryRun) {
    const validation = await validateProposal(proposalPath);
    if (!validation.valid) {
      console.error(
        kleur.red(
          `[dry-run] would fail validation: ${(validation.errors ?? []).join("; ")}`,
        ),
      );
    } else {
      console.log(kleur.green(`[dry-run] would promote: ${path.basename(proposalPath)}`));
    }
    return;
  }

  const result = await promoteProposal(root, proposalPath, { force: opts.force });

  if (result.status === "promoted") {
    console.log(
      kleur.green(`  promoted  ${path.basename(result.proposalPath)} → ${result.destPath}`),
    );
  } else if (result.status === "skipped") {
    if (opts.force) {
      // Should not happen — force overrides skip — but guard anyway.
      console.log(kleur.yellow(`  skipped   ${result.reason}`));
    } else {
      console.log(
        kleur.yellow(
          `  skipped   ${path.basename(result.proposalPath)}: ${result.reason} (use --force to overwrite)`,
        ),
      );
    }
    process.exit(1);
  } else {
    console.error(kleur.red(`  error     ${result.reason}`));
    process.exit(1);
  }
}

export function promoteCommand(): Command {
  const cmd = new Command("promote");
  cmd
    .description(
      "Promote proposals from .apex/proposed/ into .apex/knowledge/. " +
        "Without an <id> argument, runs auto-promotion using the rules in .apex/config.toml.",
    )
    .argument("[id]", "proposal id to promote (bypasses threshold, still validates)")
    .option("--dry-run", "print what would be promoted without writing any files")
    .option("--auto", "explicitly run auto-promotion (same as no-arg, kept for clarity)")
    .option("--force", "overwrite existing knowledge file if it already exists")
    .option("--root <path>", "project root (default: cwd)", process.cwd())
    .action(async (id: string | undefined, opts: CliOpts) => {
      if (opts.force && id === undefined) {
        // --force on auto-promote: pass force through to each promoteProposal call.
        // We re-run custom logic below rather than using autoPromoteAll.
        const root = opts.root ?? process.cwd();
        if (opts.dryRun) {
          await runDryRun(root, opts);
          return;
        }
        const config = await loadConfig(root);
        const candidates = await findEligible(root, config);
        let promotedCount = 0;
        for (const c of candidates) {
          if (!c.eligible && c.reason !== "destination exists") {
            console.log(
              kleur.gray(`  queued    ${path.basename(c.proposalPath)}: ${c.reason}`),
            );
            continue;
          }
          const result = await promoteProposal(root, c.proposalPath, { force: true });
          if (result.status === "promoted") {
            if (c.reason === "destination exists") {
              console.log(
                kleur.yellow(`  warning   overwriting existing file: ${result.destPath}`),
              );
            }
            console.log(
              kleur.green(
                `  promoted  ${path.basename(result.proposalPath)} → ${result.destPath}`,
              ),
            );
            promotedCount++;
          } else {
            console.log(
              kleur.red(`  error     ${path.basename(c.proposalPath)}: ${result.reason}`),
            );
          }
        }
        console.log(kleur.cyan(`promote: ${promotedCount} promoted.`));
        return;
      }

      if (id !== undefined) {
        if (opts.force) {
          console.log(kleur.yellow(`  warning   --force: will overwrite existing file if present`));
        }
        await runSinglePromote(id, opts);
      } else {
        await runAutoPromote(opts);
      }
    });
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
  const standalone = new Command("apex-promote");
  standalone
    .description(
      "Promote proposals from .apex/proposed/ into .apex/knowledge/.",
    )
    .argument("[id]", "proposal id to promote")
    .option("--dry-run", "print what would be promoted")
    .option("--auto", "run auto-promotion")
    .option("--force", "overwrite existing knowledge file")
    .option("--root <path>", "project root (default: cwd)", process.cwd())
    .action(async (id: string | undefined, opts: CliOpts) => {
      if (id !== undefined) {
        await runSinglePromote(id, opts);
      } else {
        await runAutoPromote(opts);
      }
    });
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
