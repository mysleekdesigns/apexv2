#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";
import { registerInit } from "./commands/init.js";
import { registerUpgrade } from "./commands/upgrade.js";
import { registerStatus } from "./commands/status.js";
import { registerUninstall } from "./commands/uninstall.js";

const APEX_VERSION = process.env["APEX_VERSION"] ?? "0.1.0-phase1";

async function registerSearch(program: Command): Promise<void> {
  try {
    const { runSearch } = (await import("./commands/search.js")) as {
      runSearch: (opts: {
        query: string;
        root?: string;
        type?: string;
        k?: number;
        json?: boolean;
      }) => Promise<string>;
    };
    program
      .command("search <query>")
      .description("Search the APEX knowledge base")
      .option("--type <type>", "Filter by entry type (decision|pattern|gotcha|convention)")
      .option("--k <n>", "Number of results to return", (v) => parseInt(v, 10), 5)
      .option("--json", "Emit JSON")
      .option("--cwd <path>", "Run as if invoked from <path>")
      .action(async (query: string, opts: Record<string, unknown>) => {
        const out = await runSearch({
          query,
          root: opts["cwd"] as string | undefined,
          type: opts["type"] as string | undefined,
          k: opts["k"] as number | undefined,
          json: Boolean(opts["json"]),
        });
        process.stdout.write(out + (out.endsWith("\n") ? "" : "\n"));
      });
  } catch {
    // module missing; skip silently.
  }
}

async function registerHook(program: Command): Promise<void> {
  try {
    const { registerHookCommand } = (await import("./commands/hook.js")) as {
      registerHookCommand: (p: Command) => Command;
    };
    registerHookCommand(program);
  } catch {
    // module missing; skip silently.
  }
}

async function registerArchaeologist(program: Command): Promise<void> {
  try {
    const { archaeologistCommand } = (await import(
      "./commands/archaeologist.js"
    )) as { archaeologistCommand: () => Command };
    program.addCommand(archaeologistCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("apex")
    .description("APEX — self-learning project intelligence layer for Claude Code")
    .version(APEX_VERSION);

  registerInit(program);
  registerUpgrade(program);
  registerStatus(program);
  registerUninstall(program);

  await registerSearch(program);
  await registerHook(program);
  await registerArchaeologist(program);

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const e = err as Error;
  process.stderr.write(kleur.red(`apex: ${e.message}\n`));
  process.exit(1);
});
