import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "../../src/detect/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures/projects");

describe("detect()", () => {
  it("identifies a Node + TypeScript + Next + pnpm + vitest + eslint + GH-Actions project", async () => {
    const r = await detect(path.join(fixtures, "node-ts-next"));
    expect(r.language).toBe("node");
    expect(r.hasTypeScript).toBe(true);
    expect(r.frameworks).toContain("next");
    expect(r.packageManager).toBe("pnpm");
    expect(r.testRunner).toBe("vitest");
    expect(r.lint).toContain("eslint");
    expect(r.format).toContain("prettier");
    expect(r.ci).toContain("github-actions");
  });

  it("identifies a Python Django project with uv + ruff + pytest", async () => {
    const r = await detect(path.join(fixtures, "python-django"));
    expect(r.language).toBe("python");
    expect(r.frameworks).toContain("django");
    expect(r.packageManager).toBe("uv");
    expect(r.testRunner).toBe("pytest");
    expect(r.lint).toContain("ruff");
  });

  it("identifies a Go project with golangci-lint", async () => {
    const r = await detect(path.join(fixtures, "go"));
    expect(r.language).toBe("go");
    expect(r.packageManager).toBe("go");
    expect(r.testRunner).toBe("go test");
    expect(r.lint).toContain("golangci-lint");
    expect(r.format).toContain("gofmt");
  });

  it("identifies a Rust project", async () => {
    const r = await detect(path.join(fixtures, "rust"));
    expect(r.language).toBe("rust");
    expect(r.packageManager).toBe("cargo");
    expect(r.testRunner).toBe("cargo test");
    expect(r.lint).toContain("clippy");
    expect(r.format).toContain("rustfmt");
  });

  it("returns 'unknown' for an empty directory", async () => {
    const r = await detect(path.join(fixtures, "..", "empty-does-not-exist-yet"));
    expect(r.language).toBe("unknown");
  });
});
