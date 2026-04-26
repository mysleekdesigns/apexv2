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
        tier?: "fts" | "vector" | "hybrid";
        json?: boolean;
      }) => Promise<string>;
    };
    program
      .command("search <query>")
      .description("Search the APEX knowledge base")
      .option("--type <type>", "Filter by entry type (decision|pattern|gotcha|convention)")
      .option("--k <n>", "Number of results to return", (v) => parseInt(v, 10), 5)
      .option("--tier <tier>", "Retrieval tier: fts | vector | hybrid")
      .option("--json", "Emit JSON")
      .option("--cwd <path>", "Run as if invoked from <path>")
      .action(async (query: string, opts: Record<string, unknown>) => {
        const tier = opts["tier"] as string | undefined;
        if (tier && !["fts", "vector", "hybrid"].includes(tier)) {
          process.stderr.write(`error: invalid --tier "${tier}" (use fts|vector|hybrid)\n`);
          process.exit(2);
        }
        const out = await runSearch({
          query,
          root: opts["cwd"] as string | undefined,
          type: opts["type"] as string | undefined,
          k: opts["k"] as number | undefined,
          ...(tier ? { tier: tier as "fts" | "vector" | "hybrid" } : {}),
          json: Boolean(opts["json"]),
        });
        process.stdout.write(out + (out.endsWith("\n") ? "" : "\n"));
      });
  } catch {
    // module missing; skip silently.
  }
}

async function registerEnable(program: Command): Promise<void> {
  try {
    const { enableCommand, disableCommand } = (await import("./commands/enable.js")) as {
      enableCommand: () => Command;
      disableCommand: () => Command;
    };
    program.addCommand(enableCommand());
    program.addCommand(disableCommand());
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

async function registerReflect(program: Command): Promise<void> {
  try {
    const { reflectCommand } = (await import("./commands/reflect.js")) as {
      reflectCommand: () => Command;
    };
    program.addCommand(reflectCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerPromote(program: Command): Promise<void> {
  try {
    const { promoteCommand } = (await import("./commands/promote.js")) as {
      promoteCommand: () => Command;
    };
    program.addCommand(promoteCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerCurate(program: Command): Promise<void> {
  try {
    const { curateCommand } = (await import("./commands/curate.js")) as {
      curateCommand: () => Command;
    };
    program.addCommand(curateCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerGraph(program: Command): Promise<void> {
  try {
    const { graphCommand } = (await import("./commands/graph.js")) as {
      graphCommand: () => Command;
    };
    program.addCommand(graphCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerCodeindex(program: Command): Promise<void> {
  try {
    const { codeindexCommand } = (await import("./commands/codeindex.js")) as {
      codeindexCommand: () => Command;
    };
    program.addCommand(codeindexCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerEval(program: Command): Promise<void> {
  try {
    const { evalCommand } = (await import("./commands/eval.js")) as {
      evalCommand: () => Command;
    };
    program.addCommand(evalCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerCalibrate(program: Command): Promise<void> {
  try {
    const { calibrateCommand } = (await import("./commands/calibrate.js")) as {
      calibrateCommand: () => Command;
    };
    program.addCommand(calibrateCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerPlugin(program: Command): Promise<void> {
  try {
    const { pluginCommand } = (await import("./commands/plugin.js")) as {
      pluginCommand: () => Command;
    };
    program.addCommand(pluginCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerReview(program: Command): Promise<void> {
  try {
    const { reviewCommand } = (await import("./commands/review.js")) as {
      reviewCommand: () => Command;
    };
    program.addCommand(reviewCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerInstall(program: Command): Promise<void> {
  try {
    const { installCommand } = (await import("./commands/install.js")) as {
      installCommand: () => Command;
    };
    program.addCommand(installCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerLink(program: Command): Promise<void> {
  try {
    const { linkCommand, unlinkCommand } = (await import("./commands/link.js")) as {
      linkCommand: () => Command;
      unlinkCommand: () => Command;
    };
    program.addCommand(linkCommand());
    program.addCommand(unlinkCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerAudit(program: Command): Promise<void> {
  try {
    const { auditCommand } = (await import("./commands/audit.js")) as {
      auditCommand: () => Command;
    };
    program.addCommand(auditCommand());
  } catch {
    // module missing; skip silently.
  }
}

async function registerCommitKnowledge(program: Command): Promise<void> {
  try {
    const { commitKnowledgeCommand, verifyKnowledgeCommand } = (await import(
      "./commands/commit-knowledge.js"
    )) as {
      commitKnowledgeCommand: () => Command;
      verifyKnowledgeCommand: () => Command;
    };
    program.addCommand(commitKnowledgeCommand());
    program.addCommand(verifyKnowledgeCommand());
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
  await registerEnable(program);
  await registerHook(program);
  await registerArchaeologist(program);
  await registerReflect(program);
  await registerPromote(program);
  await registerCurate(program);
  await registerGraph(program);
  await registerCodeindex(program);
  await registerEval(program);
  await registerCalibrate(program);
  await registerPlugin(program);
  await registerReview(program);
  await registerInstall(program);
  await registerLink(program);
  await registerAudit(program);
  await registerCommitKnowledge(program);

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const e = err as Error;
  process.stderr.write(kleur.red(`apex: ${e.message}\n`));
  process.exit(1);
});
