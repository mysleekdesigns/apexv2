// `apex commit-knowledge` / `verify-knowledge` core. Mocks `child_process` via
// the `signWithCommand` injection seam, so CI never invokes real `gpg`.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  signKnowledgeEntries,
  verifyKnowledgeEntries,
  type CommandResult,
  type CommandRunner,
} from "../../src/audit/sign.js";

let workdir: string;

interface RunnerCall {
  command: string;
  args: string[];
}

function makeRunner(handler: (call: RunnerCall) => CommandResult | Promise<CommandResult>): {
  runner: CommandRunner;
  calls: RunnerCall[];
} {
  const calls: RunnerCall[] = [];
  const runner: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    return handler({ command, args });
  };
  return { runner, calls };
}

async function writeKnowledge(rel: string, content: string): Promise<string> {
  const full = path.join(workdir, ".apex/knowledge", rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
  return full;
}

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-sign-"));
  await fs.mkdir(path.join(workdir, ".apex"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
});

describe("audit/sign — signKnowledgeEntries", () => {
  it("refuses outside a project (no .apex/)", async () => {
    const noApex = await fs.mkdtemp(path.join(os.tmpdir(), "apex-no-"));
    try {
      const { runner } = makeRunner(() => ({ stdout: "", stderr: "", exitCode: 0 }));
      await expect(
        signKnowledgeEntries({ cwd: noApex, signWithCommand: runner }),
      ).rejects.toThrow(/no \.apex\//);
    } finally {
      await fs.rm(noApex, { recursive: true, force: true });
    }
  });

  it("refuses with a clear error when no GPG secret key is available", async () => {
    await writeKnowledge("a.md", "# A");
    const { runner } = makeRunner(({ args }) => {
      if (args.includes("--list-secret-keys")) {
        // no secret keys -> empty stdout
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    await expect(
      signKnowledgeEntries({ cwd: workdir, signWithCommand: runner }),
    ).rejects.toThrow(/no GPG secret key/i);
  });

  it("signs each .md by writing a .md.asc next to it", async () => {
    const file = await writeKnowledge("note.md", "# Note");
    const { runner, calls } = makeRunner(async ({ args }) => {
      if (args.includes("--list-secret-keys")) {
        return { stdout: "sec:u:4096:1:ABCDEF\n", stderr: "", exitCode: 0 };
      }
      // Detached-sign: write a fake .asc to the --output target.
      const outIdx = args.indexOf("--output");
      if (outIdx >= 0 && args[outIdx + 1]) {
        await fs.writeFile(
          args[outIdx + 1] as string,
          "-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n",
        );
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const result = await signKnowledgeEntries({
      cwd: workdir,
      signWithCommand: runner,
    });
    expect(result.signed).toBe(1);
    expect(result.errors).toBe(0);
    const sigStat = await fs.stat(`${file}.asc`);
    expect(sigStat.isFile()).toBe(true);
    // Verify gpg was invoked with --detach-sign + --armor.
    const signCall = calls.find((c) => c.args.includes("--detach-sign"));
    expect(signCall).toBeDefined();
    expect(signCall?.args).toContain("--armor");
  });

  it("is idempotent: a second run with no changes skips up-to-date signatures", async () => {
    const file = await writeKnowledge("note.md", "# Note");
    const handler: Parameters<typeof makeRunner>[0] = async ({ args }) => {
      if (args.includes("--list-secret-keys")) {
        return { stdout: "sec:u:4096:1:ABCDEF\n", stderr: "", exitCode: 0 };
      }
      const outIdx = args.indexOf("--output");
      if (outIdx >= 0 && args[outIdx + 1]) {
        await fs.writeFile(args[outIdx + 1] as string, "fake-sig");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const first = makeRunner(handler);
    await signKnowledgeEntries({ cwd: workdir, signWithCommand: first.runner });

    // Bump sig mtime so it's clearly newer than src.
    const future = new Date(Date.now() + 10_000);
    await fs.utimes(`${file}.asc`, future, future);

    const second = makeRunner(handler);
    const result = await signKnowledgeEntries({
      cwd: workdir,
      signWithCommand: second.runner,
    });
    expect(result.signed).toBe(0);
    expect(result.skipped).toBe(1);
    // `--detach-sign` must not have been called the second time.
    expect(second.calls.some((c) => c.args.includes("--detach-sign"))).toBe(false);
  });

  it("re-signs when the source .md is newer than the .asc", async () => {
    const file = await writeKnowledge("note.md", "# Note");
    const handler: Parameters<typeof makeRunner>[0] = async ({ args }) => {
      if (args.includes("--list-secret-keys")) {
        return { stdout: "sec:u:4096:1:ABCDEF\n", stderr: "", exitCode: 0 };
      }
      const outIdx = args.indexOf("--output");
      if (outIdx >= 0 && args[outIdx + 1]) {
        await fs.writeFile(args[outIdx + 1] as string, "fake-sig");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const first = makeRunner(handler);
    await signKnowledgeEntries({ cwd: workdir, signWithCommand: first.runner });
    // Make sig OLDER than source.
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(`${file}.asc`, past, past);
    await fs.writeFile(file, "# Note v2");

    const second = makeRunner(handler);
    const result = await signKnowledgeEntries({
      cwd: workdir,
      signWithCommand: second.runner,
    });
    expect(result.signed).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("--dry-run reports would-sign without invoking gpg or writing files", async () => {
    const file = await writeKnowledge("note.md", "# Note");
    const { runner, calls } = makeRunner(() => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    }));
    const result = await signKnowledgeEntries({
      cwd: workdir,
      dryRun: true,
      signWithCommand: runner,
    });
    expect(result.signed).toBe(0);
    expect(result.entries[0]?.status).toBe("would-sign");
    // No gpg invocations at all in dry-run mode.
    expect(calls.length).toBe(0);
    await expect(fs.stat(`${file}.asc`)).rejects.toThrow();
  });

  it("passes --local-user when --key is provided", async () => {
    await writeKnowledge("note.md", "# Note");
    const { runner, calls } = makeRunner(async ({ args }) => {
      if (args.includes("--list-secret-keys")) {
        return { stdout: "sec:u:4096:1:KEY\n", stderr: "", exitCode: 0 };
      }
      const outIdx = args.indexOf("--output");
      if (outIdx >= 0 && args[outIdx + 1]) {
        await fs.writeFile(args[outIdx + 1] as string, "sig");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    await signKnowledgeEntries({
      cwd: workdir,
      key: "MYKEYID",
      signWithCommand: runner,
    });
    const signCall = calls.find((c) => c.args.includes("--detach-sign"));
    expect(signCall?.args).toContain("--local-user");
    expect(signCall?.args).toContain("MYKEYID");
  });

  it("records errors when gpg sign fails", async () => {
    await writeKnowledge("note.md", "# Note");
    const { runner } = makeRunner(({ args }) => {
      if (args.includes("--list-secret-keys")) {
        return { stdout: "sec:u:4096:1:KEY\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "gpg: signing failed", exitCode: 2 };
    });
    const result = await signKnowledgeEntries({
      cwd: workdir,
      signWithCommand: runner,
    });
    expect(result.errors).toBe(1);
    expect(result.entries[0]?.status).toBe("error");
    expect(result.entries[0]?.error).toMatch(/signing failed/);
  });
});

describe("audit/sign — verifyKnowledgeEntries", () => {
  it("reports missing-signature when .asc is absent", async () => {
    await writeKnowledge("a.md", "# A");
    const { runner } = makeRunner(() => ({ stdout: "", stderr: "", exitCode: 0 }));
    const result = await verifyKnowledgeEntries({
      cwd: workdir,
      signWithCommand: runner,
    });
    expect(result.missing).toBe(1);
    expect(result.ok).toBe(0);
  });

  it("reports ok when gpg --verify exits 0", async () => {
    const file = await writeKnowledge("a.md", "# A");
    await fs.writeFile(`${file}.asc`, "fake-sig");
    const { runner, calls } = makeRunner(({ args }) => {
      if (args[0] === "--verify") {
        return { stdout: "", stderr: "Good signature", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const result = await verifyKnowledgeEntries({
      cwd: workdir,
      signWithCommand: runner,
    });
    expect(result.ok).toBe(1);
    expect(result.missing).toBe(0);
    expect(calls.find((c) => c.args[0] === "--verify")).toBeDefined();
  });

  it("reports bad-signature on gpg failure with 'BAD signature' marker", async () => {
    const file = await writeKnowledge("a.md", "# A");
    await fs.writeFile(`${file}.asc`, "tampered");
    const { runner } = makeRunner(() => ({
      stdout: "",
      stderr: "gpg: BAD signature from ...",
      exitCode: 1,
    }));
    const result = await verifyKnowledgeEntries({
      cwd: workdir,
      signWithCommand: runner,
    });
    expect(result.bad).toBe(1);
    expect(result.ok).toBe(0);
  });
});
