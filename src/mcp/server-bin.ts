#!/usr/bin/env node
import { runStdio } from "./index.js";

async function main(): Promise<void> {
  const root = process.env["CLAUDE_PROJECT_DIR"]?.trim() || process.cwd();
  const { ctx } = await runStdio(root);
  const shutdown = (): void => {
    try {
      ctx.recall.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: Error) => {
  process.stderr.write(`apex-mcp: fatal: ${err.message}\n${err.stack ?? ""}\n`);
  process.exit(1);
});
