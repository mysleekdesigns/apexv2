// `apex install pack:<id>` — apply a curated knowledge pack into the
// current project's `.apex/proposed/` directory.
//
// Also: `apex install --list` enumerates available packs.

import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPack } from "../../packs/apply.js";
import { listAvailablePacks, PackLoadError } from "../../packs/loader.js";

interface CliOpts {
  list?: boolean;
  dryRun?: boolean;
  cwd?: string;
  packsRoot?: string;
  json?: boolean;
}

function parseTarget(target: string | undefined): { kind: "pack"; id: string } | null {
  if (!target) return null;
  if (target.startsWith("pack:")) {
    const id = target.slice("pack:".length).trim();
    if (!id) return null;
    return { kind: "pack", id };
  }
  return null;
}

async function runList(opts: CliOpts): Promise<void> {
  const packs = await listAvailablePacks(opts.packsRoot);
  if (opts.json) {
    process.stdout.write(JSON.stringify(packs, null, 2) + "\n");
    return;
  }
  if (packs.length === 0) {
    process.stdout.write(kleur.gray("No packs available.\n"));
    return;
  }
  process.stdout.write(kleur.cyan(`Available packs (${packs.length}):\n`));
  for (const p of packs) {
    process.stdout.write(
      `  ${kleur.bold(`pack:${p.id}`)} ${kleur.gray(`v${p.version}`)} — ${p.title}\n`,
    );
    process.stdout.write(kleur.gray(`    stack: ${p.stack}\n`));
    process.stdout.write(kleur.gray(`    ${p.description}\n`));
  }
}

async function runInstall(target: string, opts: CliOpts): Promise<void> {
  const parsed = parseTarget(target);
  if (!parsed) {
    process.stderr.write(
      kleur.red(
        `error: install target must be of the form "pack:<id>" (got "${target}")\n`,
      ),
    );
    process.exit(2);
  }
  const root = opts.cwd ?? process.cwd();
  try {
    const result = await applyPack(root, parsed.id, {
      dryRun: opts.dryRun ?? false,
      ...(opts.packsRoot !== undefined ? { packsRoot: opts.packsRoot } : {}),
    });

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
    }

    const tag = result.dryRun ? "[dry-run] " : "";
    process.stdout.write(
      kleur.cyan(
        `${tag}install pack:${result.pack.id}@${result.pack.version} (${result.pack.stack}): ` +
          `${result.written.length} written, ${result.skipped.length} skipped\n`,
      ),
    );
    for (const w of result.written) {
      process.stdout.write(
        kleur.gray(
          `  ${tag}wrote ${path.relative(root, w.targetPath)} [${w.type}]\n`,
        ),
      );
    }
    for (const s of result.skipped) {
      process.stdout.write(
        kleur.yellow(
          `  skipped ${path.relative(root, s.targetPath)} — ${s.reason}\n`,
        ),
      );
    }
    if (!result.dryRun && result.written.length > 0) {
      process.stdout.write(
        kleur.gray(
          `  next: review files in ${path.relative(root, result.proposedDir) || ".apex/proposed"} and run \`apex promote\` to accept.\n`,
        ),
      );
    }
  } catch (err) {
    if (err instanceof PackLoadError) {
      process.stderr.write(kleur.red(`error: ${err.message}\n`));
    } else {
      process.stderr.write(kleur.red(`error: ${(err as Error).message}\n`));
    }
    process.exit(1);
  }
}

function configure(cmd: Command): Command {
  return cmd
    .argument("[target]", 'Pack target, e.g. "pack:nextjs"')
    .option("--list", "List available packs and exit")
    .option("--dry-run", "Do not write files; report what would be written")
    .option("--cwd <path>", "Project root (default: cwd)")
    .option(
      "--packs-root <path>",
      "Override the packs source directory (defaults to APEX's bundled templates/packs)",
    )
    .option("--json", "Emit JSON output");
}

export function installCommand(): Command {
  const cmd = new Command("install").description(
    "Install a curated APEX knowledge pack into .apex/proposed/ for review.",
  );
  configure(cmd).action(async (target: string | undefined, opts: CliOpts) => {
    if (opts.list) {
      await runList(opts);
      return;
    }
    if (!target) {
      process.stderr.write(
        kleur.red(
          'error: missing argument. Use `apex install pack:<id>` or `apex install --list`.\n',
        ),
      );
      process.exit(2);
    }
    await runInstall(target, opts);
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
  const standalone = new Command("apex-install").description(
    "Install a curated APEX knowledge pack into .apex/proposed/ for review.",
  );
  configure(standalone).action(async (target: string | undefined, opts: CliOpts) => {
    if (opts.list) {
      await runList(opts);
      return;
    }
    if (!target) {
      process.stderr.write(
        kleur.red(
          'error: missing argument. Use `apex install pack:<id>` or `apex install --list`.\n',
        ),
      );
      process.exit(2);
    }
    await runInstall(target, opts);
  });
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
