// `apex review` — emit a clean PR-ready diff of pending knowledge proposals.
//
// Phase 5.2 Team sync. Reads `.apex/proposed/`, groups by type, marks which
// proposals would auto-promote vs. queue, and prints either:
//
//   - Markdown (default)        — paste-ready for a PR description.
//   - JSON     (--json)         — machine-readable.
//   - File     (--out <path>)   — same content, written to disk for review.
//
// Optional `--lint` runs the applies_to validator against `.apex/knowledge/`
// so the same review surfaces malformed entries already on disk.

import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runReview } from "../../review/cli.js";

interface CliOpts {
  out?: string;
  json?: boolean;
  lint?: boolean;
  cwd?: string;
}

async function runCli(opts: CliOpts): Promise<void> {
  const result = await runReview({
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.out ? { out: opts.out } : {}),
    ...(opts.json ? { json: true } : {}),
    ...(opts.lint ? { lint: true } : {}),
  });

  if (result.writtenTo) {
    // When writing to a file, print a one-liner on stderr so stdout stays
    // available for piping (in case both --out and another use are wanted).
    const root = path.resolve(opts.cwd ?? process.cwd());
    const rel = path.relative(root, result.writtenTo) || result.writtenTo;
    process.stderr.write(
      `apex review: wrote ${result.model.proposals.length} proposal(s) summary to ${rel}\n`,
    );
    return;
  }

  process.stdout.write(
    result.rendered.endsWith("\n") ? result.rendered : `${result.rendered}\n`,
  );
}

function configure(cmd: Command): Command {
  return cmd
    .option("--out <path>", "write rendered output to this file (relative to --cwd)")
    .option("--json", "emit JSON instead of Markdown")
    .option("--lint", "include applies_to lint warnings for .apex/knowledge/")
    .option("--cwd <path>", "project root (default: cwd)");
}

export function reviewCommand(): Command {
  const cmd = new Command("review").description(
    "Render a PR-ready summary of pending knowledge proposals (.apex/proposed/).",
  );
  configure(cmd).action(async (opts: CliOpts) => runCli(opts));
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
  const standalone = new Command("apex-review").description(
    "Render a PR-ready summary of pending knowledge proposals (.apex/proposed/).",
  );
  configure(standalone).action(async (opts: CliOpts) => runCli(opts));
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  });
}
