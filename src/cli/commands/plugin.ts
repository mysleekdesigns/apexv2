import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, renderManifest } from "../../plugin/manifest.js";
import { packPlugin } from "../../plugin/packer.js";
import { planUpgrade, renderPlan } from "../../plugin/upgrade.js";

interface PackOpts {
  out?: string;
  cwd?: string;
}

interface ManifestOpts {
  cwd?: string;
}

interface UpgradeOpts {
  cwd?: string;
  pluginDir: string;
  json?: boolean;
}

async function runPack(opts: PackOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const outDir = path.resolve(root, opts.out ?? "apex-plugin");
  const result = await packPlugin({ outDir });
  console.log(
    kleur.cyan(
      `apex plugin pack: wrote ${result.written.length} file(s) to ${path.relative(root, result.outDir) || "."}`,
    ),
  );
  console.log(
    kleur.gray(
      `  manifest: ${result.manifest.name}@${result.manifest.version}`,
    ),
  );
  console.log(
    kleur.gray(`  layout:   .claude-plugin/, hooks/, skills/, agents/, commands/, .mcp.json`),
  );
}

async function runManifest(_opts: ManifestOpts): Promise<void> {
  const m = await buildManifest();
  process.stdout.write(renderManifest(m));
}

async function runUpgrade(opts: UpgradeOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const pluginDir = path.resolve(opts.pluginDir);
  const plan = await planUpgrade(root, pluginDir);
  if (opts.json) {
    process.stdout.write(JSON.stringify(plan) + "\n");
    return;
  }
  process.stdout.write(renderPlan(plan));
}

export function pluginCommand(): Command {
  const cmd = new Command("plugin");
  cmd.description(
    "Package APEX as a Claude Code plugin (manifest, hooks, skills, agents, commands, MCP).",
  );

  cmd
    .command("pack")
    .description(
      "Write a self-contained plugin layout (.claude-plugin/plugin.json + hooks/skills/agents/commands + .mcp.json) to <dir>",
    )
    .option("--out <dir>", "output directory (default: ./apex-plugin)")
    .option("--cwd <path>", "project root (default: cwd)")
    .action(async (opts: PackOpts) => runPack(opts));

  cmd
    .command("manifest")
    .description("Print the plugin manifest JSON to stdout")
    .option("--cwd <path>", "project root (default: cwd)")
    .action(async (opts: ManifestOpts) => runManifest(opts));

  cmd
    .command("upgrade <plugin-dir>")
    .description(
      "Plan a plugin upgrade for the current project. Reports which files would be replaced, added, removed, or preserved. Never mutates anything.",
    )
    .option("--cwd <path>", "project root (default: cwd)")
    .option("--json", "Emit JSON")
    .action(async (pluginDir: string, opts: Omit<UpgradeOpts, "pluginDir">) =>
      runUpgrade({ ...opts, pluginDir }),
    );

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
  const standalone = pluginCommand();
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
