/**
 * sync.ts — CLI commands for encrypted bundle export and import.
 *
 * Usage:
 *   apex sync export --out <file.apex-bundle> [--passphrase-env <VAR>] [--include-proposed] [--cwd <path>]
 *   apex sync import --in <file.apex-bundle>  [--passphrase-env <VAR>] [--dry-run] [--cwd <path>]
 *
 * The passphrase is ALWAYS read from an env var, never from a CLI argument.
 * Default env var: APEX_BUNDLE_PASSPHRASE.
 */

import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportBundle, importBundle } from "../../sync/index.js";

// ---- Export subcommand ----

interface ExportOpts {
  out: string;
  passphraseEnv: string;
  includeProposed?: boolean;
  cwd: string;
}

async function runExport(opts: ExportOpts): Promise<void> {
  const root = path.resolve(opts.cwd);

  let report;
  try {
    report = await exportBundle(root, {
      out: opts.out,
      passphraseEnv: opts.passphraseEnv,
      includeProposed: opts.includeProposed ?? false,
      cwd: root,
    });
  } catch (err) {
    console.error(kleur.red(`export failed: ${(err as Error).message}`));
    process.exit(1);
  }

  console.log(
    kleur.green(
      `exported ${report.fileCount} file(s) to ${report.outPath} (bundle created ${report.created})`,
    ),
  );
}

// ---- Import subcommand ----

interface ImportOpts {
  in: string;
  passphraseEnv: string;
  dryRun?: boolean;
  cwd: string;
}

async function runImport(opts: ImportOpts): Promise<void> {
  const root = path.resolve(opts.cwd);
  const tag = opts.dryRun ? kleur.yellow("[dry-run] ") : "";

  let report;
  try {
    report = await importBundle(root, {
      in: opts.in,
      passphraseEnv: opts.passphraseEnv,
      dryRun: opts.dryRun ?? false,
      cwd: root,
    });
  } catch (err) {
    const msg = (err as Error).message;
    // Surface decryption errors clearly
    if (msg.includes("corrupt or passphrase is wrong")) {
      console.error(kleur.red("bundle is corrupt or passphrase is wrong"));
    } else {
      console.error(kleur.red(`import failed: ${msg}`));
    }
    process.exit(1);
  }

  console.log(
    kleur.cyan(
      `${tag}imported ${report.fileCount} file(s) from bundle (created ${report.created})`,
    ),
  );

  for (const f of report.files) {
    const rel = path.relative(root, f.writtenPath);
    if (f.action === "dry-run") {
      console.log(kleur.gray(`  [dry-run] would write ${f.bundlePath} → ${rel}`));
    } else if (f.action === "renamed") {
      console.log(kleur.yellow(`  renamed  ${f.bundlePath} → ${rel}`));
    } else {
      console.log(kleur.gray(`  written  ${f.bundlePath} → ${rel}`));
    }
  }
}

// ---- Command factory ----

export function syncCommand(): Command {
  const cmd = new Command("sync");
  cmd.description(
    "Export or import encrypted knowledge bundles for sharing across workstations. " +
      "Passphrase is read from an env var (default: APEX_BUNDLE_PASSPHRASE).",
  );

  // -- export --
  const exportCmd = new Command("export");
  exportCmd
    .description(
      "Pack and encrypt .apex/knowledge/ (and optionally .apex/proposed/) into a bundle file.",
    )
    .requiredOption("--out <file>", "output bundle file path (e.g. knowledge.apex-bundle)")
    .option(
      "--passphrase-env <VAR>",
      "name of env var holding the passphrase",
      "APEX_BUNDLE_PASSPHRASE",
    )
    .option("--include-proposed", "also bundle .apex/proposed/")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: ExportOpts) => runExport(opts));

  // -- import --
  const importCmd = new Command("import");
  importCmd
    .description(
      "Decrypt and unpack a bundle file into .apex/proposed/ for user review.",
    )
    .requiredOption("--in <file>", "input bundle file path")
    .option(
      "--passphrase-env <VAR>",
      "name of env var holding the passphrase",
      "APEX_BUNDLE_PASSPHRASE",
    )
    .option("--dry-run", "print what would be written without making changes")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: ImportOpts) => runImport(opts));

  cmd.addCommand(exportCmd);
  cmd.addCommand(importCmd);

  return cmd;
}

// ---- Standalone invocation ----

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
  const program = new Command("apex-sync");
  program.description("APEX encrypted bundle sync");
  program.addCommand(syncCommand());
  program.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
