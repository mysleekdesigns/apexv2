import path from "node:path";
import fs from "fs-extra";

async function exists(root: string, file: string): Promise<boolean> {
  return fs.pathExists(path.join(root, file));
}

async function dirHasFiles(root: string, dir: string, extRe: RegExp): Promise<boolean> {
  const p = path.join(root, dir);
  if (!(await fs.pathExists(p))) return false;
  const entries = await fs.readdir(p).catch(() => [] as string[]);
  return entries.some((e) => extRe.test(e));
}

export async function detectCi(root: string): Promise<string[]> {
  const out: string[] = [];
  if (await dirHasFiles(root, ".github/workflows", /\.ya?ml$/)) {
    out.push("github-actions");
  }
  if (await exists(root, ".gitlab-ci.yml")) out.push("gitlab-ci");
  if (await exists(root, ".circleci/config.yml")) out.push("circleci");
  if (await fs.pathExists(path.join(root, ".buildkite"))) out.push("buildkite");
  if (await exists(root, "azure-pipelines.yml")) out.push("azure-pipelines");
  return out;
}
