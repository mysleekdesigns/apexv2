import path from "node:path";
import fs from "fs-extra";

async function exists(root: string, file: string): Promise<boolean> {
  return fs.pathExists(path.join(root, file));
}

async function readJsonSafe(p: string): Promise<Record<string, unknown> | null> {
  try {
    return (await fs.readJson(p)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function detectPackageManager(
  root: string,
  language: string,
): Promise<string | null> {
  if (language === "node") {
    if (await exists(root, "pnpm-lock.yaml")) return "pnpm";
    if (await exists(root, "yarn.lock")) return "yarn";
    if (await exists(root, "bun.lockb")) return "bun";
    if (await exists(root, "package-lock.json")) return "npm";
    const pkg = await readJsonSafe(path.join(root, "package.json"));
    if (pkg && typeof pkg["packageManager"] === "string") {
      const pm = pkg["packageManager"] as string;
      const name = pm.split("@")[0];
      if (name) return name;
    }
    if (await exists(root, "package.json")) return "npm";
    return null;
  }
  if (language === "python") {
    if (await exists(root, "uv.lock")) return "uv";
    if (await exists(root, "poetry.lock")) return "poetry";
    if (await exists(root, "Pipfile.lock") || (await exists(root, "Pipfile")))
      return "pipenv";
    const reqs = await fs.readdir(root).catch(() => [] as string[]);
    if (reqs.some((e) => /^requirements.*\.txt$/.test(e))) return "pip";
    if (await exists(root, "pyproject.toml")) return "pip";
    return null;
  }
  if (language === "go") {
    return (await exists(root, "go.mod")) ? "go" : null;
  }
  if (language === "rust") {
    return (await exists(root, "Cargo.toml")) ? "cargo" : null;
  }
  return null;
}
