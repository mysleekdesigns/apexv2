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

export interface LintFormat {
  lint: string[];
  format: string[];
}

export async function detectLintFormat(
  root: string,
  language: string,
): Promise<LintFormat> {
  const lint: string[] = [];
  const format: string[] = [];

  if (language === "node") {
    const pkg = await readJsonSafe(path.join(root, "package.json"));
    const deps = depsOf(pkg);
    if (deps["eslint"]) lint.push("eslint");
    if (deps["@biomejs/biome"] || deps["biome"]) {
      lint.push("biome");
      format.push("biome");
    }
    if (deps["oxlint"]) lint.push("oxlint");
    if (deps["prettier"]) format.push("prettier");
    if (deps["typescript"]) lint.push("tsc");
  } else if (language === "python") {
    const pyproject = await readTextSafe(path.join(root, "pyproject.toml"));
    const requirements = await readTextSafe(path.join(root, "requirements.txt"));
    const haystack = `${pyproject ?? ""}\n${requirements ?? ""}`.toLowerCase();
    if (haystack.includes("ruff")) {
      lint.push("ruff");
      format.push("ruff");
    }
    if (haystack.includes("flake8")) lint.push("flake8");
    if (haystack.includes("mypy")) lint.push("mypy");
    if (haystack.includes("pyright")) lint.push("pyright");
    if (haystack.includes("black")) format.push("black");
  } else if (language === "go") {
    format.push("gofmt");
    if (
      (await exists(root, ".golangci.yml")) ||
      (await exists(root, ".golangci.yaml")) ||
      (await exists(root, ".golangci.toml"))
    ) {
      lint.push("golangci-lint");
    }
  } else if (language === "rust") {
    format.push("rustfmt");
    lint.push("clippy");
  }

  return { lint, format };
}
