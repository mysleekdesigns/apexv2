// `apex commit-knowledge` and `apex verify-knowledge` — GPG signing /
// verification for `.apex/knowledge/` entries. PRD §5.5.
//
// These commands wrap `src/audit/sign.ts`. The CLI layer's only job is option
// parsing + human/JSON formatting; the signing/verification logic is in
// `audit/sign.ts` so it's testable without spawning a CLI.

import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import {
  signKnowledgeEntries,
  verifyKnowledgeEntries,
  type SignOptions,
} from "../../audit/sign.js";

interface SignCliOpts {
  cwd?: string;
  key?: string;
  dryRun?: boolean;
  json?: boolean;
}

interface VerifyCliOpts {
  cwd?: string;
  json?: boolean;
}

async function runCommitKnowledge(opts: SignCliOpts): Promise<void> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  const signOpts: SignOptions = { cwd: root };
  if (opts.key !== undefined) signOpts.key = opts.key;
  if (opts.dryRun !== undefined) signOpts.dryRun = opts.dryRun;
  let result;
  try {
    result = await signKnowledgeEntries(signOpts);
  } catch (err: unknown) {
    const e = err as Error;
    process.stderr.write(kleur.red(`apex commit-knowledge: ${e.message}\n`));
    process.exit(1);
    return;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(0);
    return;
  }

  const tag = opts.dryRun ? "[dry-run] " : "";
  process.stdout.write(
    kleur.cyan(
      `${tag}commit-knowledge: ${result.signed} signed, ${result.skipped} skipped (up to date), ${result.errors} error(s)`,
    ) + "\n",
  );
  for (const e of result.entries) {
    const rel = path.relative(root, e.path);
    if (e.status === "error") {
      process.stdout.write(
        kleur.red(`  error: ${rel} — ${e.error ?? "unknown"}`) + "\n",
      );
    } else if (e.status === "signed") {
      process.stdout.write(kleur.gray(`  signed: ${rel}`) + "\n");
    } else if (e.status === "would-sign") {
      process.stdout.write(kleur.gray(`  would sign: ${rel}`) + "\n");
    } else {
      process.stdout.write(kleur.gray(`  up to date: ${rel}`) + "\n");
    }
  }
  process.exit(result.errors > 0 ? 1 : 0);
}

async function runVerifyKnowledge(opts: VerifyCliOpts): Promise<void> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  let result;
  try {
    result = await verifyKnowledgeEntries({ cwd: root });
  } catch (err: unknown) {
    const e = err as Error;
    process.stderr.write(kleur.red(`apex verify-knowledge: ${e.message}\n`));
    process.exit(1);
    return;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(0);
    return;
  }

  process.stdout.write(
    kleur.cyan(
      `verify-knowledge: ${result.ok} ok, ${result.missing} missing-signature, ${result.bad} bad, ${result.errors} error(s)`,
    ) + "\n",
  );
  for (const e of result.entries) {
    const rel = path.relative(root, e.path);
    if (e.status === "ok") {
      process.stdout.write(kleur.green(`  ok: ${rel}`) + "\n");
    } else if (e.status === "missing-signature") {
      process.stdout.write(kleur.yellow(`  missing signature: ${rel}`) + "\n");
    } else if (e.status === "bad-signature") {
      process.stdout.write(
        kleur.red(`  BAD signature: ${rel} — ${e.error ?? ""}`) + "\n",
      );
    } else {
      process.stdout.write(
        kleur.red(`  error: ${rel} — ${e.error ?? "unknown"}`) + "\n",
      );
    }
  }
  // Exit non-zero if any signature is bad or any verify call errored.
  process.exit(result.bad > 0 || result.errors > 0 ? 1 : 0);
}

export function commitKnowledgeCommand(): Command {
  const cmd = new Command("commit-knowledge").description(
    "GPG-sign every .apex/knowledge/**/*.md (idempotent; refuses without a secret key).",
  );
  cmd
    .option("--key <id>", "GPG key id passed to gpg --local-user")
    .option("--cwd <path>", "project root (default: cwd)")
    .option(
      "--dry-run",
      "report what would be signed without invoking gpg or writing files",
    )
    .option("--json", "emit JSON report")
    .action(async (opts: SignCliOpts) => runCommitKnowledge(opts));
  return cmd;
}

export function verifyKnowledgeCommand(): Command {
  const cmd = new Command("verify-knowledge").description(
    "Verify every .apex/knowledge/**/*.md.asc detached signature with gpg --verify.",
  );
  cmd
    .option("--cwd <path>", "project root (default: cwd)")
    .option("--json", "emit JSON report")
    .action(async (opts: VerifyCliOpts) => runVerifyKnowledge(opts));
  return cmd;
}
