import path from "node:path";
import fs from "fs-extra";

export interface LanguageResult {
  language: "node" | "python" | "go" | "rust" | "unknown";
  hasTypeScript: boolean;
  signals: Record<string, string>;
}

const NODE_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "tsconfig.json",
  "bun.lockb",
];

const PYTHON_FILES = [
  "pyproject.toml",
  "Pipfile",
  "setup.py",
  "poetry.lock",
  "uv.lock",
];

const GO_FILES = ["go.mod", "go.sum"];
const RUST_FILES = ["Cargo.toml", "Cargo.lock"];

async function exists(root: string, file: string): Promise<boolean> {
  return fs.pathExists(path.join(root, file));
}

async function hasRequirementsTxt(root: string): Promise<string | null> {
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  const match = entries.find((e) => /^requirements.*\.txt$/.test(e));
  return match ?? null;
}

export async function detectLanguage(root: string): Promise<LanguageResult> {
  const signals: Record<string, string> = {};

  for (const f of NODE_FILES) {
    if (await exists(root, f)) signals[f] = "present";
  }
  for (const f of PYTHON_FILES) {
    if (await exists(root, f)) signals[f] = "present";
  }
  const reqTxt = await hasRequirementsTxt(root);
  if (reqTxt) signals[reqTxt] = "present";
  for (const f of GO_FILES) {
    if (await exists(root, f)) signals[f] = "present";
  }
  for (const f of RUST_FILES) {
    if (await exists(root, f)) signals[f] = "present";
  }

  const hasNode = NODE_FILES.some((f) => signals[f]);
  const hasPython =
    PYTHON_FILES.some((f) => signals[f]) || reqTxt !== null;
  const hasGo = GO_FILES.some((f) => signals[f]);
  const hasRust = RUST_FILES.some((f) => signals[f]);

  let language: LanguageResult["language"] = "unknown";
  if (hasNode) language = "node";
  else if (hasPython) language = "python";
  else if (hasGo) language = "go";
  else if (hasRust) language = "rust";

  const hasTypeScript = Boolean(signals["tsconfig.json"]);

  return { language, hasTypeScript, signals };
}
