import path from "node:path";
import fs from "fs-extra";

async function readJsonSafe(p: string): Promise<Record<string, unknown> | null> {
  try {
    return (await fs.readJson(p)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readTextSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

function depsOf(pkg: Record<string, unknown> | null): Record<string, string> {
  if (!pkg) return {};
  const out: Record<string, string> = {};
  for (const k of ["dependencies", "devDependencies"]) {
    const v = pkg[k];
    if (v && typeof v === "object") {
      for (const [name, ver] of Object.entries(v)) {
        if (typeof ver === "string") out[name] = ver;
      }
    }
  }
  return out;
}

export async function detectTestRunner(
  root: string,
  language: string,
): Promise<string | null> {
  if (language === "node") {
    const pkg = await readJsonSafe(path.join(root, "package.json"));
    const deps = depsOf(pkg);
    const ordered = ["vitest", "jest", "mocha", "playwright", "cypress"];
    for (const r of ordered) {
      if (deps[r] !== undefined) return r;
    }
    const scripts = (pkg?.["scripts"] ?? {}) as Record<string, string>;
    if (typeof scripts["test"] === "string") {
      const t = scripts["test"];
      for (const r of ordered) {
        if (t.includes(r)) return r;
      }
    }
    return null;
  }
  if (language === "python") {
    const pyproject = await readTextSafe(path.join(root, "pyproject.toml"));
    const requirements = await readTextSafe(path.join(root, "requirements.txt"));
    const haystack = `${pyproject ?? ""}\n${requirements ?? ""}`.toLowerCase();
    if (haystack.includes("pytest") || /\[tool\.pytest/.test(pyproject ?? ""))
      return "pytest";
    if (haystack.includes("nose2")) return "nose2";
    if (haystack.includes("unittest")) return "unittest";
    return null;
  }
  if (language === "go") return "go test";
  if (language === "rust") return "cargo test";
  return null;
}
