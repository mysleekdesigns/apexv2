import path from "node:path";
import kleur from "kleur";
import { Command } from "commander";
import {
  formatStatsBanner,
  isInstalled,
  runInstall,
} from "../../scaffold/installer.js";

const APEX_VERSION = process.env["APEX_VERSION"] ?? "0.1.0-phase1";

export interface UpgradeFlags {
  dryRun?: boolean;
  cwd?: string;
}

export async function runUpgrade(flags: UpgradeFlags): Promise<number> {
  const root = path.resolve(flags.cwd ?? process.cwd());
  if (!(await isInstalled(root))) {
    process.stderr.write(
      kleur.yellow(
        "APEX is not installed in this directory. Run `apex init` first.\n",
      ),
    );
    return 1;
  }
  try {
    const result = await runInstall({
      root,
      dryRun: Boolean(flags.dryRun),
      force: true,
      yes: true,
      apexVersion: APEX_VERSION,
      sourceCommand: "apex upgrade",
      sourceChannel: "local",
    });

    if (flags.dryRun) {
      process.stdout.write(`${kleur.bold("Upgrade plan (dry-run):")}\n`);
      for (const r of result.records) {
        process.stdout.write(`  ${kleur.dim(r.action.padEnd(28))} ${r.path}\n`);
      }
      return 0;
    }
    process.stdout.write(`\n${formatStatsBanner(result)}\n`);
    return 0;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    process.stderr.write(kleur.red(`apex upgrade failed: ${e.message}\n`));
    return 1;
  }
}

export function registerUpgrade(program: Command): void {
  program
    .command("upgrade")
    .description("Re-write APEX-owned files; preserve user files and knowledge")
    .option("--dry-run", "Show what would be written without modifying the filesystem")
    .option("--cwd <path>", "Run as if invoked from <path>")
    .action(async (opts) => {
      const code = await runUpgrade(opts);
      process.exit(code);
    });
}
