#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";
import { registerInit } from "./commands/init.js";
import { registerUpgrade } from "./commands/upgrade.js";
import { registerStatus } from "./commands/status.js";
import { registerUninstall } from "./commands/uninstall.js";

const APEX_VERSION = process.env["APEX_VERSION"] ?? "0.1.0-phase1";

async function tryRegister(
  program: Command,
  name: string,
  modulePath: string,
  registerFnName: string,
): Promise<void> {
  try {
    const mod = (await import(modulePath)) as Record<string, unknown>;
    const fn = mod[registerFnName];
    if (typeof fn === "function") {
      (fn as (p: Command) => void)(program);
      return;
    }
  } catch {
    // fall through to stub.
  }
  program
    .command(name)
    .description(`(${name}: command unavailable in this build)`)
    .allowUnknownOption(true)
    .action(() => {
      process.stderr.write(
        kleur.yellow(`apex ${name}: command unavailable in this build\n`),
      );
      process.exit(0);
    });
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

  await tryRegister(program, "search", "./commands/search.js", "registerSearch");
  await tryRegister(program, "hook", "./commands/hook.js", "registerHook");
  await tryRegister(
    program,
    "archaeologist",
    "./commands/archaeologist.js",
    "registerArchaeologist",
  );

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const e = err as Error;
  process.stderr.write(kleur.red(`apex: ${e.message}\n`));
  process.exit(1);
});
