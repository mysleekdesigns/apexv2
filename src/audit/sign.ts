// GPG signing / verification for `.apex/knowledge/` entries.
// Implements PRD §5.5 `apex commit-knowledge` + companion verify.
//
// Design:
//   - Shells out to `gpg --detach-sign --armor` (one detached signature per
//     `.md` file → `<entry>.md.asc` next to it).
//   - Idempotent: a signature is rewritten only if `<entry>.md` is newer than
//     `<entry>.md.asc`. Untouched entries are skipped.
//   - Refuses to run if no secret key is available (`gpg --list-secret-keys`).
//   - Refuses to run outside a project (no `.apex/`).
//
// Test seam: `signWithCommand` is the dependency-injected wrapper around
// `child_process.execFile`. Tests pass a stub so CI never invokes real `gpg`.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a command. Returns `{stdout, stderr, exitCode}` rather than throwing
 * on non-zero exit, so callers can render errors uniformly. Tests inject a
 * fake to avoid spawning real `gpg`.
 */
export type CommandRunner = (
  command: string,
  args: string[],
  opts?: { cwd?: string; input?: string },
) => Promise<CommandResult>;

/** Default runner — wraps `child_process.execFile` with our shape. */
export const defaultCommandRunner: CommandRunner = async (
  command,
  args,
  opts,
) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: opts?.cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
};

export interface SignOptions {
  /** Project root (default: cwd). Must contain `.apex/`. */
  cwd?: string;
  /** GPG key id (passed via `--local-user`). */
  key?: string;
  /** Plan-only; do not write or invoke gpg for signing. */
  dryRun?: boolean;
  /** Test seam — defaults to a real execFile wrapper. */
  signWithCommand?: CommandRunner;
}

export interface SignResultEntry {
  /** Absolute path to the source `.md` file. */
  path: string;
  /** What happened. */
  status: "signed" | "skipped-up-to-date" | "would-sign" | "error";
  /** Error message if status === "error". */
  error?: string;
}

export interface SignResult {
  signed: number;
  skipped: number;
  errors: number;
  entries: SignResultEntry[];
}

export interface VerifyResultEntry {
  path: string;
  status: "ok" | "missing-signature" | "bad-signature" | "error";
  error?: string;
}

export interface VerifyResult {
  ok: number;
  missing: number;
  bad: number;
  errors: number;
  entries: VerifyResultEntry[];
}

const KNOWLEDGE_DIR = ".apex/knowledge";

/** Collect every `.md` under `.apex/knowledge/` (recursive). */
async function collectKnowledgeMarkdown(root: string): Promise<string[]> {
  const base = path.join(root, KNOWLEDGE_DIR);
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (e.isFile() && e.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  await walk(base);
  out.sort();
  return out;
}

/** Throws if `<root>/.apex/` doesn't exist (we refuse to run outside a project). */
async function assertInProject(root: string): Promise<void> {
  const apex = path.join(root, ".apex");
  try {
    const st = await fs.stat(apex);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`refusing to run: no .apex/ directory at ${root}`);
  }
}

/** Returns true iff `gpg --list-secret-keys` reports at least one key. */
export async function hasSecretKey(
  runner: CommandRunner = defaultCommandRunner,
): Promise<boolean> {
  const r = await runner("gpg", ["--list-secret-keys", "--with-colons"]);
  if (r.exitCode !== 0) return false;
  // `--with-colons` output: lines starting with `sec:` mark secret keys.
  return /^sec:/m.test(r.stdout);
}

/** True iff `<src>` is newer than `<sig>` (or sig missing). */
async function needsResign(src: string, sig: string): Promise<boolean> {
  let sigStat: import("node:fs").Stats;
  try {
    sigStat = await fs.stat(sig);
  } catch {
    return true;
  }
  const srcStat = await fs.stat(src);
  return srcStat.mtimeMs > sigStat.mtimeMs;
}

/**
 * Sign every `.apex/knowledge/**\/*.md` with a detached `.asc`. Idempotent —
 * up-to-date signatures are skipped.
 */
export async function signKnowledgeEntries(
  options: SignOptions = {},
): Promise<SignResult> {
  const root = path.resolve(options.cwd ?? process.cwd());
  const dryRun = options.dryRun ?? false;
  const runner = options.signWithCommand ?? defaultCommandRunner;

  await assertInProject(root);

  if (!dryRun) {
    const ok = await hasSecretKey(runner);
    if (!ok) {
      throw new Error(
        "no GPG secret key available — run `gpg --list-secret-keys` to inspect; create or import one before signing.",
      );
    }
  }

  const files = await collectKnowledgeMarkdown(root);
  const entries: SignResultEntry[] = [];
  let signed = 0;
  let skipped = 0;
  let errors = 0;

  for (const src of files) {
    const sig = `${src}.asc`;
    const must = await needsResign(src, sig);
    if (!must) {
      entries.push({ path: src, status: "skipped-up-to-date" });
      skipped++;
      continue;
    }
    if (dryRun) {
      entries.push({ path: src, status: "would-sign" });
      continue;
    }
    const args = [
      "--batch",
      "--yes",
      "--armor",
      "--detach-sign",
      "--output",
      sig,
    ];
    if (options.key) {
      args.unshift("--local-user", options.key);
    }
    args.push(src);
    const r = await runner("gpg", args, { cwd: root });
    if (r.exitCode !== 0) {
      entries.push({
        path: src,
        status: "error",
        error: (r.stderr || r.stdout || "gpg failed").trim(),
      });
      errors++;
      continue;
    }
    entries.push({ path: src, status: "signed" });
    signed++;
  }

  return { signed, skipped, errors, entries };
}

/**
 * Verify every `.md.asc` next to a `.md` under `.apex/knowledge/`. Returns
 * counts: `ok`, `missing` (no `.asc`), `bad` (signature failed), `errors`.
 */
export async function verifyKnowledgeEntries(
  options: SignOptions = {},
): Promise<VerifyResult> {
  const root = path.resolve(options.cwd ?? process.cwd());
  const runner = options.signWithCommand ?? defaultCommandRunner;

  await assertInProject(root);

  const files = await collectKnowledgeMarkdown(root);
  const entries: VerifyResultEntry[] = [];
  let ok = 0;
  let missing = 0;
  let bad = 0;
  let errors = 0;

  for (const src of files) {
    const sig = `${src}.asc`;
    try {
      await fs.stat(sig);
    } catch {
      entries.push({ path: src, status: "missing-signature" });
      missing++;
      continue;
    }
    const r = await runner("gpg", ["--verify", sig, src], { cwd: root });
    if (r.exitCode === 0) {
      entries.push({ path: src, status: "ok" });
      ok++;
      continue;
    }
    // Distinguish "bad signature" from "tooling error". gpg returns 1 for a
    // bad signature too, so we treat any non-zero as bad-signature unless the
    // stderr suggests gpg itself failed to start.
    const stderr = (r.stderr || r.stdout || "").trim();
    if (stderr.toLowerCase().includes("bad signature")) {
      entries.push({ path: src, status: "bad-signature", error: stderr });
      bad++;
    } else {
      entries.push({ path: src, status: "error", error: stderr });
      errors++;
    }
  }

  return { ok, missing, bad, errors, entries };
}
