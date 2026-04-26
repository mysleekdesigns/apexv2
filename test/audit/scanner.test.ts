// `apex audit` static scanner — fixtures under a tmpdir with clean code,
// fetch usage, library imports, and shelled commands. Verifies test-only
// path classification and the `--include-deps` walk gate.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  partitionFindings,
  scanForExternalCalls,
} from "../../src/audit/scanner.js";

let workdir: string;

async function write(rel: string, content: string): Promise<string> {
  const full = path.join(workdir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
  return full;
}

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-audit-"));
});

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
});

describe("audit/scanner — scanForExternalCalls", () => {
  it("returns no findings for clean code", async () => {
    await write(
      "src/clean.ts",
      [
        "// pure local-only module",
        "export function add(a: number, b: number) {",
        "  return a + b;",
        "}",
      ].join("\n"),
    );
    const findings = await scanForExternalCalls(workdir);
    expect(findings).toEqual([]);
  });

  it("flags global fetch() in a production path", async () => {
    await write(
      "src/net.ts",
      ["export async function go() {", '  return fetch("https://example.com");', "}"].join(
        "\n",
      ),
    );
    const findings = await scanForExternalCalls(workdir);
    expect(findings.length).toBeGreaterThan(0);
    const f = findings.find((x) => x.rule === "global-fetch");
    expect(f).toBeDefined();
    expect(f?.productionPath).toBe(true);
    expect(f?.kind).toBe("fetch");
    expect(f?.line).toBeGreaterThan(0);
  });

  it("flags shelled curl commands", async () => {
    await write(
      "src/shell.ts",
      [
        "import { execSync } from 'node:child_process';",
        "export function ping() {",
        "  return execSync('curl https://api.example.com');",
        "}",
      ].join("\n"),
    );
    const findings = await scanForExternalCalls(workdir);
    const shell = findings.find((f) => f.rule === "shell-curl");
    expect(shell).toBeDefined();
    expect(shell?.kind).toBe("shell");
    expect(shell?.productionPath).toBe(true);
  });

  it("flags axios import as library kind", async () => {
    await write(
      "src/api.ts",
      ["import axios from 'axios';", "export const a = axios;"].join("\n"),
    );
    const findings = await scanForExternalCalls(workdir);
    const lib = findings.find((f) => f.rule === "axios-import");
    expect(lib).toBeDefined();
    expect(lib?.kind).toBe("library");
  });

  it("flags node:http request as http kind", async () => {
    await write(
      "src/http-call.ts",
      [
        "import https from 'node:https';",
        "export function go() {",
        "  return https.request({ host: 'example.com' });",
        "}",
      ].join("\n"),
    );
    const findings = await scanForExternalCalls(workdir);
    const http = findings.find((f) => f.rule === "node-http-request");
    expect(http).toBeDefined();
    expect(http?.kind).toBe("http");
  });

  it("classifies findings under test/ as testOnly", async () => {
    // Same fetch call, in a test directory.
    await write(
      "test/foo.test.ts",
      ['it("calls", async () => { await fetch("x"); });'].join("\n"),
    );
    const findings = await scanForExternalCalls(workdir);
    expect(findings.length).toBe(1);
    expect(findings[0]?.productionPath).toBe(false);
    const { production, testOnly } = partitionFindings(findings);
    expect(production.length).toBe(0);
    expect(testOnly.length).toBe(1);
  });

  it("classifies fixtures and __tests__ as testOnly", async () => {
    await write("src/__tests__/x.ts", 'fetch("a");');
    await write("test/fixtures/y.ts", 'fetch("b");');
    const findings = await scanForExternalCalls(workdir);
    const { production, testOnly } = partitionFindings(findings);
    expect(production.length).toBe(0);
    expect(testOnly.length).toBe(2);
  });

  it("skips node_modules by default", async () => {
    await write("node_modules/some-pkg/index.js", 'fetch("https://x");');
    await write("src/clean.ts", "export const x = 1;");
    const findings = await scanForExternalCalls(workdir);
    expect(findings).toEqual([]);
  });

  it("includes node_modules with includeDeps=true", async () => {
    await write("node_modules/some-pkg/index.js", 'fetch("https://x");');
    const findings = await scanForExternalCalls(workdir, { includeDeps: true });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.file.includes("node_modules"))).toBe(true);
  });

  it("skips dist/ build/ coverage/ by default", async () => {
    await write("dist/bundle.js", 'fetch("https://x");');
    await write("build/out.js", 'fetch("https://y");');
    await write("coverage/foo.js", 'fetch("https://z");');
    const findings = await scanForExternalCalls(workdir);
    expect(findings).toEqual([]);
  });

  it("returns findings sorted deterministically by file then line", async () => {
    await write("src/a.ts", ['fetch("a");', 'fetch("b");'].join("\n"));
    await write("src/b.ts", 'fetch("c");');
    const findings = await scanForExternalCalls(workdir);
    expect(findings.length).toBe(3);
    expect(findings[0]?.file.endsWith("a.ts")).toBe(true);
    expect(findings[0]?.line).toBe(1);
    expect(findings[1]?.line).toBe(2);
    expect(findings[2]?.file.endsWith("b.ts")).toBe(true);
  });
});
