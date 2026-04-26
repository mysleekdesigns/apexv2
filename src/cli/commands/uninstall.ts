import path from "node:path";
import fs from "fs-extra";
import kleur from "kleur";
import prompts from "prompts";
import { Command } from "commander";
import { projectPaths } from "../../util/paths.js";
import {
  removeGitignoreManaged,
  removeMarkdownManaged,
  removeMcpServer,
  removeSettingsHooks,
} from "../../scaffold/managedSection.js";

export interface UninstallFlags {
  cwd?: string;
  yes?: boolean;
  purge?: boolean;
}

async function rmIfExists(p: string): Promise<boolean> {
  if (!(await fs.pathExists(p))) return false;
  await fs.remove(p);
  return true;
}

export async function runUninstall(flags: UninstallFlags): Promise<number> {
  const root = path.resolve(flags.cwd ?? process.cwd());
  const paths = projectPaths(root);

  if (!(await fs.pathExists(paths.installJson))) {
    process.stdout.write(kleur.yellow("APEX is not installed in this directory.\n"));
    return 0;
  }

  if (!flags.yes && process.env["CI"] !== "true") {
    const r = await prompts({
      type: "confirm",
      name: "ok",
      message: flags.purge
        ? "Uninstall APEX and DELETE knowledge/proposed (purge)?"
        : "Uninstall APEX (knowledge files will be kept)?",
      initial: false,
    });
    if (!r.ok) {
      process.stdout.write("Aborted.\n");
      return 0;
    }
  }

  // Skills.
  for (const dir of await fs.readdir(paths.skillsDir).catch(() => [] as string[])) {
    if (dir.startsWith("apex-")) {
      await rmIfExists(path.join(paths.skillsDir, dir));
    }
  }
  // Agents.
  for (const f of await fs.readdir(paths.agentsDir).catch(() => [] as string[])) {
    if (f.startsWith("apex-") && f.endsWith(".md")) {
      await rmIfExists(path.join(paths.agentsDir, f));
    }
  }
  // Slash commands.
  for (const f of await fs.readdir(paths.commandsDir).catch(() => [] as string[])) {
    if (f.startsWith("apex-") && f.endsWith(".md")) {
      await rmIfExists(path.join(paths.commandsDir, f));
    }
  }
  // Hooks: detect by header token.
  for (const f of await fs.readdir(paths.hooksDir).catch(() => [] as string[])) {
    if (!f.startsWith("on-") || !f.endsWith(".sh")) continue;
    const fp = path.join(paths.hooksDir, f);
    const content = await fs.readFile(fp, "utf8").catch(() => "");
    if (content.includes("apex-hook-v1") || content.includes("apex-managed")) {
      await rmIfExists(fp);
    }
  }
  // Rules: 00-stack and apex stubs.
  for (const f of ["00-stack.md", "10-conventions.md", "20-gotchas.md"]) {
    await rmIfExists(path.join(paths.rulesDir, f));
  }

  // settings.json: remove apex-tagged hook entries.
  if (await fs.pathExists(paths.settingsJson)) {
    const json = (await fs.readJson(paths.settingsJson).catch(() => null)) as
      | Record<string, unknown>
      | null;
    const cleaned = removeSettingsHooks(json);
    if (Object.keys(cleaned).length === 0) {
      await rmIfExists(paths.settingsJson);
    } else {
      await fs.writeFile(
        paths.settingsJson,
        `${JSON.stringify(cleaned, null, 2)}\n`,
        "utf8",
      );
    }
  }

  // .mcp.json: remove apex entry.
  if (await fs.pathExists(paths.mcpJson)) {
    const json = (await fs.readJson(paths.mcpJson).catch(() => null)) as
      | Record<string, unknown>
      | null;
    const cleaned = removeMcpServer(json, "apex");
    if (
      cleaned["mcpServers"] === undefined &&
      Object.keys(cleaned).length === 0
    ) {
      await rmIfExists(paths.mcpJson);
    } else {
      await fs.writeFile(
        paths.mcpJson,
        `${JSON.stringify(cleaned, null, 2)}\n`,
        "utf8",
      );
    }
  }

  // CLAUDE.md: strip managed block (or remove if it's apex-only).
  if (await fs.pathExists(paths.claudeMd)) {
    const content = await fs.readFile(paths.claudeMd, "utf8");
    const cleaned = removeMarkdownManaged(content);
    if (cleaned.trim().length === 0) {
      await rmIfExists(paths.claudeMd);
    } else {
      await fs.writeFile(paths.claudeMd, cleaned, "utf8");
    }
  }

  // .gitignore: strip managed block.
  if (await fs.pathExists(paths.rootGitignore)) {
    const content = await fs.readFile(paths.rootGitignore, "utf8");
    const cleaned = removeGitignoreManaged(content);
    await fs.writeFile(paths.rootGitignore, cleaned, "utf8");
  }

  // .apex/{install.json, config.toml, episodes, index, metrics, .gitignore}
  await rmIfExists(paths.installJson);
  await rmIfExists(paths.configToml);
  await rmIfExists(paths.episodesDir);
  await rmIfExists(paths.indexDir);
  await rmIfExists(paths.metricsDir);
  await rmIfExists(paths.apexGitignore);

  if (flags.purge) {
    await rmIfExists(paths.knowledgeDir);
    await rmIfExists(paths.proposedDir);
  } else {
    process.stdout.write(
      kleur.cyan(
        "Your knowledge files are kept in `.apex/knowledge/`. Delete the directory yourself if you don't want them.\n",
      ),
    );
  }

  // If .apex/ is now empty, remove it too.
  const apexEntries = await fs.readdir(paths.apexDir).catch(() => [] as string[]);
  if (apexEntries.length === 0) await rmIfExists(paths.apexDir);

  process.stdout.write(kleur.green("APEX uninstalled.\n"));
  return 0;
}

export function registerUninstall(program: Command): void {
  program
    .command("uninstall")
    .description("Remove APEX-owned files and managed sections")
    .option("--cwd <path>", "Run as if invoked from <path>")
    .option("--yes", "Skip confirmation prompt")
    .option("--purge", "Also remove knowledge/ and proposed/ (asks for confirmation)")
    .action(async (opts) => {
      const code = await runUninstall(opts);
      process.exit(code);
    });
}
