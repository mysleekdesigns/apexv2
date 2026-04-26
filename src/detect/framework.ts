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
  for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const v = pkg[k];
    if (v && typeof v === "object") {
      for (const [name, ver] of Object.entries(v)) {
        if (typeof ver === "string") out[name] = ver;
      }
    }
  }
  return out;
}

export async function detectFrameworks(
  root: string,
  language: string,
): Promise<string[]> {
  const found: string[] = [];

  if (language === "node") {
    const pkg = await readJsonSafe(path.join(root, "package.json"));
    const deps = depsOf(pkg);

    const has = (name: string): boolean => deps[name] !== undefined;
    const hasPrefix = (prefix: string): boolean =>
      Object.keys(deps).some((d) => d.startsWith(prefix));

    if (
      has("next") ||
      (await exists(root, "next.config.js")) ||
      (await exists(root, "next.config.ts")) ||
      (await exists(root, "next.config.mjs"))
    ) {
      found.push("next");
    }
    if (hasPrefix("@remix-run/") || (await exists(root, "remix.config.js"))) {
      found.push("remix");
    }
    if (has("express")) found.push("express");
    if (has("fastify")) found.push("fastify");
    if (has("hono")) found.push("hono");
    if (has("nuxt") || (await exists(root, "nuxt.config.ts"))) found.push("nuxt");
    if (has("vue")) found.push("vue");
    if (
      has("@sveltejs/kit") ||
      (await exists(root, "svelte.config.js"))
    ) {
      found.push("sveltekit");
    } else if (has("svelte")) {
      found.push("svelte");
    }
    if (has("react") && !found.includes("next") && !found.includes("remix")) {
      found.push("react");
    }
  } else if (language === "python") {
    const pyproject = await readTextSafe(path.join(root, "pyproject.toml"));
    const requirements = await readTextSafe(path.join(root, "requirements.txt"));
    const haystack = `${pyproject ?? ""}\n${requirements ?? ""}`.toLowerCase();
    const hasDep = (n: string): boolean => haystack.includes(n.toLowerCase());

    if (hasDep("django") || (await exists(root, "manage.py"))) {
      found.push("django");
    }
    if (hasDep("fastapi")) found.push("fastapi");
    if (hasDep("flask")) found.push("flask");
    if (hasDep("starlette") && !found.includes("fastapi")) found.push("starlette");
    if (hasDep("pydantic") && found.length === 0) found.push("library");
  }

  return found;
}
