// Tests for monorepo discovery.
//
// Each scenario builds a tmpdir laid out like a real monorepo, then asserts
// `detectMonorepo` returns the right kind + the expected packages, with
// `apexDir` populated when (and only when) `.apex/` exists.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { detectMonorepo } from "../../src/monorepo/discover.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-monorepo-discover-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePkg(root: string, dir: string, name: string): void {
  const full = path.join(root, dir);
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(
    path.join(full, "package.json"),
    JSON.stringify({ name }, null, 2),
    "utf8",
  );
}

describe("detectMonorepo", () => {
  it("returns null for a single-repo (no signals)", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "single" }),
      "utf8",
    );
    const info = await detectMonorepo(tmpDir);
    expect(info).toBeNull();
  });

  it("detects a pnpm workspace and enumerates packages with apexDir", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n",
      "utf8",
    );
    writePkg(tmpDir, "packages/foo", "@x/foo");
    writePkg(tmpDir, "packages/bar", "@x/bar");
    // Only `foo` has an .apex/ override.
    fs.mkdirSync(path.join(tmpDir, "packages/foo/.apex"), { recursive: true });

    const info = await detectMonorepo(tmpDir);
    expect(info).not.toBeNull();
    expect(info!.kind).toBe("pnpm");
    expect(info!.root).toBe(path.resolve(tmpDir));
    expect(info!.packages).toHaveLength(2);

    const byName = Object.fromEntries(info!.packages.map((p) => [p.name, p]));
    expect(byName["@x/foo"]?.apexDir).toBe(
      path.join(path.resolve(tmpDir), "packages/foo", ".apex"),
    );
    expect(byName["@x/bar"]?.apexDir).toBeNull();
  });

  it("detects npm workspaces from package.json (array form)", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "utf8",
    );
    writePkg(tmpDir, "packages/alpha", "alpha");
    writePkg(tmpDir, "packages/beta", "beta");

    const info = await detectMonorepo(tmpDir);
    expect(info).not.toBeNull();
    expect(info!.kind).toBe("npm");
    expect(info!.packages.map((p) => p.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("detects yarn workspaces when yarn.lock exists alongside workspaces field", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmpDir, "yarn.lock"), "", "utf8");
    writePkg(tmpDir, "packages/foo", "foo");

    const info = await detectMonorepo(tmpDir);
    expect(info!.kind).toBe("yarn");
  });

  it("detects lerna with explicit packages config", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "lerna.json"),
      JSON.stringify({ packages: ["modules/*"] }),
      "utf8",
    );
    writePkg(tmpDir, "modules/one", "one");
    const info = await detectMonorepo(tmpDir);
    expect(info!.kind).toBe("lerna");
    expect(info!.packages.map((p) => p.name)).toEqual(["one"]);
  });

  it("detects turbo using package.json workspaces", async () => {
    fs.writeFileSync(path.join(tmpDir, "turbo.json"), "{}", "utf8");
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["apps/*"] }),
      "utf8",
    );
    writePkg(tmpDir, "apps/web", "web");

    const info = await detectMonorepo(tmpDir);
    expect(info!.kind).toBe("turbo");
    expect(info!.packages.map((p) => p.name)).toEqual(["web"]);
  });

  it("detects nx and falls back to apps/*, libs/*, packages/* when no workspaces field", async () => {
    fs.writeFileSync(path.join(tmpDir, "nx.json"), "{}", "utf8");
    writePkg(tmpDir, "apps/api", "api");
    writePkg(tmpDir, "libs/util", "util");

    const info = await detectMonorepo(tmpDir);
    expect(info!.kind).toBe("nx");
    expect(info!.packages.map((p) => p.name).sort()).toEqual(["api", "util"]);
  });

  it("detects cargo workspaces and reads crate names from Cargo.toml", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "Cargo.toml"),
      `[workspace]\nmembers = ["crates/foo", "crates/bar"]\n`,
      "utf8",
    );
    fs.mkdirSync(path.join(tmpDir, "crates/foo"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "crates/bar"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "crates/foo/Cargo.toml"),
      `[package]\nname = "foo-crate"\nversion = "0.1.0"\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "crates/bar/Cargo.toml"),
      `[package]\nname = "bar-crate"\nversion = "0.1.0"\n`,
      "utf8",
    );

    const info = await detectMonorepo(tmpDir);
    expect(info!.kind).toBe("cargo");
    const names = info!.packages.map((p) => p.name).sort();
    expect(names).toEqual(["bar-crate", "foo-crate"]);
  });

  it("respects literal (non-glob) workspace patterns", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "pnpm-workspace.yaml"),
      "packages:\n  - 'tools/specific-pkg'\n",
      "utf8",
    );
    writePkg(tmpDir, "tools/specific-pkg", "specific");
    writePkg(tmpDir, "tools/other-pkg", "other");

    const info = await detectMonorepo(tmpDir);
    expect(info!.packages.map((p) => p.name)).toEqual(["specific"]);
  });
});
