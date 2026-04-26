#!/usr/bin/env node
// stdin -> stdout redactor filter. Used by hook scripts that prefer to pipe
// raw bytes through a separate process rather than route via `apex hook`.
//
// Usage:  cat input | node dist/redactor/cli.js  > output
//
// Exit codes:
//   0  success (mask/warn/no-op)
//   1  unexpected runtime error
//
// Phase 1 does not implement the `block` -> exit 10 contract from
// redactor-design.md §3 because every Phase 1 caller treats redacted output
// as the canonical write. The block-tier exit is added in the CI-lint mode
// (Phase 1 §10) — out of scope for this module.

import { redactString } from "./index.js";

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const input = Buffer.concat(chunks).toString("utf8");
  const output = redactString(input);
  process.stdout.write(output);
}

main().catch((err) => {
  // Never block the caller's pipeline — log to stderr and exit 0 if input was
  // empty (so `set -o pipefail` doesn't fire on an idle hook). Otherwise
  // propagate as exit 1.
  process.stderr.write(`apex-redact: ${(err as Error).message}\n`);
  process.exit(1);
});
