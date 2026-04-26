import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import kleur from "kleur";
import prompts from "prompts";
import { Command } from "commander";
import {
  formatStatsBanner,
  isInstalled,
  readInstallJson,
  runInstall,
} from "../../scaffold/installer.js";
import { registerApexMcp } from "../../scaffold/mcpRegistration.js";
import { permissionsBanner } from "../../scaffold/permissions.js";
import { CLAUDE_CODE_MIN_VERSION } from "../../types/shared.js";

const APEX_VERSION = process.env["APEX_VERSION"] ?? "0.1.0-phase1";

export interface InitFlags {
  dryRun?: boolean;
  yes?: boolean;
  force?: boolean;
  cwd?: string;
}

function isWindowsNative(): boolean {
  if (os.platform() !== "win32") return false;
  // WSL exposes itself via env vars / kernel release; cheap heuristic:
  if (process.env["WSL_DISTRO_NAME"] || process.env["WSLENV"]) return false;
  return true;
}

async function confirmContinue(yes: boolean): Promise<boolean> {
  if (yes || process.env["CI"] === "true") return true;
  const r = await prompts({
    type: "confirm",
    name: "ok",
    message: "Continue?",
    initial: false,
  });
  return Boolean(r.ok);
}

export async function runInit(flags: InitFlags): Promise<number> {
  const root = path.resolve(flags.cwd ?? process.cwd());

  if (isWindowsNative()) {
    process.stderr.write(
      kleur.red(
        "APEX hooks require a POSIX shell. Install WSL2 and re-run inside your WSL distribution.\n",
      ),
    );
    return 2;
  }

  const isGitRepo = await fs.pathExists(path.join(root, ".git"));
  if (!isGitRepo) {
    process.stdout.write(
      kleur.yellow(
        "Note: APEX works best in a git repo so knowledge can be reviewed and shared.\n",
      ),
    );
  }

  const already = await isInstalled(root);
  if (already && !flags.force) {
    const prior = await readInstallJson(root);
    process.stdout.write(
      kleur.yellow(
        `APEX is already installed (v${prior?.apex_version ?? "?"}, installed ${
          prior?.installed_at ?? "?"
        }).\n`,
      ),
    );
    process.stdout.write("  Did you mean: apex upgrade?\n");
    process.stdout.write(
      "  Or re-run init with --force to reinstall (your knowledge will be preserved).\n",
    );
    return 0;
  }

  process.stdout.write(`${permissionsBanner()}\n`);
  if (!flags.dryRun) {
    const ok = await confirmContinue(Boolean(flags.yes));
    if (!ok) {
      process.stdout.write("Aborted.\n");
      return 0;
    }
  } else {
    process.stdout.write(kleur.cyan("--dry-run: no files will be written.\n\n"));
  }

  try {
    const result = await runInstall({
      root,
      dryRun: Boolean(flags.dryRun),
      force: Boolean(flags.force),
      yes: Boolean(flags.yes),
      apexVersion: APEX_VERSION,
      sourceCommand: "apex init",
      sourceChannel: "local",
    });

    if (flags.dryRun) {
      process.stdout.write(`${kleur.bold("Plan (dry-run):")}\n`);
      for (const r of result.records) {
        process.stdout.write(`  ${kleur.dim(r.action.padEnd(28))} ${r.path}\n`);
      }
      process.stdout.write(
        `\n${result.records.length} files planned. Re-run without --dry-run to apply.\n`,
      );
      return 0;
    }

    let proposedCount = 0;
    try {
      const { runArchaeologist } = await import("../../archaeologist/index.js");
      const report = await runArchaeologist(root, { dryRun: false });
      proposedCount = report.proposalsWritten.length;
    } catch (err) {
      process.stderr.write(
        kleur.yellow(
          `archaeologist skipped: ${(err as Error).message}\n`,
        ),
      );
    }

    await registerApexMcp(root);

    process.stdout.write(`\n${formatStatsBanner(result, proposedCount)}\n`);
    process.stdout.write(
      kleur.dim(
        `Claude Code minimum version: ${CLAUDE_CODE_MIN_VERSION}. apex v${APEX_VERSION}.\n`,
      ),
    );
    return 0;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    process.stderr.write(kleur.red(`apex init failed: ${e.message}\n`));
    return 1;
  }
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Install APEX into the current project")
    .option("--dry-run", "Show what would be written without modifying the filesystem")
    .option("--yes", "Skip the permissions confirmation prompt")
    .option("--force", "Reinstall over an existing APEX install (knowledge preserved)")
    .option("--cwd <path>", "Run as if invoked from <path>")
    .action(async (opts) => {
      const code = await runInit(opts);
      process.exit(code);
    });
}
