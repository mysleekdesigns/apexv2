/**
 * swarm.ts — CLI command for multi-agent swarm operations.
 *
 * Subcommands:
 *   apex swarm list [--cwd <path>] [--json]
 *   apex swarm reflect [--parallel <n>] [--timeout <seconds>] [--cwd <path>] [--dry-run]
 */

import { Command } from "commander";
import kleur from "kleur";
import { discoverWorktrees } from "../../swarm/discover.js";
import { runSwarmReflect } from "../../swarm/index.js";

function listCommand(): Command {
  const cmd = new Command("list");
  cmd
    .description("List all git worktrees discovered from the given root.")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .option("--json", "emit JSON output")
    .action(async (opts: { cwd?: string; json?: boolean }) => {
      const root = opts.cwd ?? process.cwd();

      try {
        const worktrees = await discoverWorktrees(root);

        if (opts.json) {
          process.stdout.write(JSON.stringify(worktrees, null, 2) + "\n");
          return;
        }

        if (worktrees.length === 0) {
          console.log(kleur.yellow("No git worktrees found (not in a git repo or only one worktree)."));
          return;
        }

        console.log(kleur.cyan(`Found ${worktrees.length} worktree(s):`));
        for (const wt of worktrees) {
          const branchStr = wt.branch ? kleur.green(wt.branch) : kleur.gray("(detached)");
          console.log(`  ${wt.path}  ${branchStr}  ${kleur.gray(wt.head.slice(0, 8))}`);
        }
      } catch (err: unknown) {
        const e = err as Error;
        process.stderr.write(kleur.red(`swarm list: ${e.message}\n`));
        process.exit(1);
      }
    });
  return cmd;
}

function reflectCommand(): Command {
  const cmd = new Command("reflect");
  cmd
    .description(
      "Run `apex reflect --all` across all git worktrees in parallel and aggregate results.",
    )
    .option("--parallel <n>", "max concurrent apex invocations", (v) => parseInt(v, 10))
    .option("--timeout <seconds>", "per-worktree timeout in seconds (default: 60)", (v) =>
      parseInt(v, 10),
    )
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .option("--dry-run", "discover worktrees but do not run apex")
    .action(
      async (opts: {
        parallel?: number;
        timeout?: number;
        cwd?: string;
        dryRun?: boolean;
      }) => {
        // Recursion guard surfaced clearly
        if (process.env["APEX_IN_SWARM"] === "1") {
          process.stderr.write(
            kleur.red(
              "apex swarm: error: nested swarm invocation refused (APEX_IN_SWARM=1 detected).\n" +
                "  Do not invoke `apex swarm` from within a swarm worker.\n",
            ),
          );
          process.exit(1);
        }

        const root = opts.cwd ?? process.cwd();
        const timeoutMs = opts.timeout !== undefined ? opts.timeout * 1000 : 60_000;

        try {
          const result = await runSwarmReflect(root, {
            parallel: opts.parallel,
            timeoutMs,
            dryRun: opts.dryRun,
            verbose: true,
          });

          const tag = opts.dryRun ? "[dry-run] " : "";

          // Per-worktree progress
          for (const wt of result.worktrees) {
            const status = wt.success ? kleur.green("ok") : kleur.red("fail");
            const dur = `${wt.durationMs}ms`;
            console.log(
              `  ${status}  ${wt.path}  (${dur})`,
            );
            if (!wt.success && wt.stderr) {
              console.log(kleur.gray(`    stderr: ${wt.stderr.slice(0, 200)}`));
            }
            if (wt.stdout) {
              // Print the reflector summary line if present
              const summaryLine = wt.stdout
                .split("\n")
                .find((l) => l.includes("episode(s) processed") || l.includes("file(s) written"));
              if (summaryLine) {
                console.log(kleur.gray(`    ${summaryLine.trim()}`));
              }
            }
          }

          // Final summary
          console.log(
            kleur.cyan(
              `\n${tag}swarm reflect: ${result.totalWorktrees} worktree(s), ` +
                `${result.succeeded} succeeded, ${result.failed} failed, ` +
                `${result.totalProposals} total proposal(s) across all worktrees.`,
            ),
          );

          if (result.failed > 0) {
            process.exit(1);
          }
        } catch (err: unknown) {
          const e = err as Error;
          if (e.message === "nested swarm invocation refused") {
            process.stderr.write(
              kleur.red(
                "apex swarm: error: nested swarm invocation refused (APEX_IN_SWARM=1 detected).\n" +
                  "  Do not invoke `apex swarm` from within a swarm worker.\n",
              ),
            );
          } else {
            process.stderr.write(kleur.red(`apex swarm reflect: ${e.message}\n`));
          }
          process.exit(1);
        }
      },
    );
  return cmd;
}

export function swarmCommand(): Command {
  const cmd = new Command("swarm");
  cmd.description(
    "Multi-agent swarm: run apex operations across all git worktrees in parallel.",
  );
  cmd.addCommand(listCommand());
  cmd.addCommand(reflectCommand());
  return cmd;
}
