import path from "node:path";
import fs from "node:fs/promises";
import { Command } from "commander";
import kleur from "kleur";
import { projectPaths } from "../../util/paths.js";
import { setVectorEnabled } from "../../config/index.js";
import { Recall } from "../../recall/index.js";

type Feature = "vector";

const SUPPORTED: readonly Feature[] = ["vector"] as const;

function isSupported(name: string): name is Feature {
  return (SUPPORTED as readonly string[]).includes(name);
}

interface RunOpts {
  cwd?: string;
  fake?: boolean;
}

export async function enableFeature(feature: string, opts: RunOpts = {}): Promise<number> {
  if (!isSupported(feature)) {
    process.stderr.write(
      kleur.red(`unsupported feature "${feature}". Supported: ${SUPPORTED.join(", ")}\n`),
    );
    return 2;
  }
  const root = path.resolve(opts.cwd ?? process.cwd());
  if (feature === "vector") return enableVector(root, opts);
  return 0;
}

export async function disableFeature(feature: string, opts: RunOpts = {}): Promise<number> {
  if (!isSupported(feature)) {
    process.stderr.write(
      kleur.red(`unsupported feature "${feature}". Supported: ${SUPPORTED.join(", ")}\n`),
    );
    return 2;
  }
  const root = path.resolve(opts.cwd ?? process.cwd());
  if (feature === "vector") return disableVector(root);
  return 0;
}

async function enableVector(root: string, opts: RunOpts): Promise<number> {
  const paths = projectPaths(root);
  await fs.mkdir(path.join(paths.indexDir, "vectors.lance"), { recursive: true });
  await setVectorEnabled(root, true);
  process.stderr.write(kleur.cyan("apex: vector retrieval enabled.\n"));
  process.stderr.write(
    "apex: building local vector index (first run downloads ~25MB embedding model)...\n",
  );

  const recall = new Recall(root, {
    vector: true,
    ...(opts.fake !== undefined ? { fakeVector: opts.fake } : {}),
  });
  try {
    await recall.sync();
    await recall.syncVector();
    const stats = await recall.stats();
    if (stats.vector) {
      process.stderr.write(
        kleur.green(
          `apex: vector index ready (${stats.vector.total} entries, dim=${stats.vector.dim}, model=${stats.vector.model}).\n`,
        ),
      );
    } else {
      process.stderr.write(kleur.green("apex: vector index ready.\n"));
    }
  } finally {
    recall.close();
  }
  return 0;
}

async function disableVector(root: string): Promise<number> {
  await setVectorEnabled(root, false);
  process.stderr.write(
    kleur.cyan("apex: vector retrieval disabled. Index files retained at .apex/index/vectors.lance/.\n"),
  );
  return 0;
}

export function enableCommand(): Command {
  const cmd = new Command("enable");
  cmd
    .description("Enable an opt-in APEX feature (e.g. vector)")
    .argument("<feature>", "feature name to enable (vector)")
    .option("--cwd <path>", "Run as if invoked from <path>")
    .option("--fake", "Use synthetic embeddings (skip model download); for testing")
    .action(async (feature: string, opts: { cwd?: string; fake?: boolean }) => {
      const runOpts: RunOpts = {};
      if (opts.cwd) runOpts.cwd = opts.cwd;
      if (opts.fake) runOpts.fake = true;
      const code = await enableFeature(feature, runOpts);
      if (code !== 0) process.exit(code);
    });
  return cmd;
}

export function disableCommand(): Command {
  const cmd = new Command("disable");
  cmd
    .description("Disable an opt-in APEX feature (e.g. vector)")
    .argument("<feature>", "feature name to disable (vector)")
    .option("--cwd <path>", "Run as if invoked from <path>")
    .action(async (feature: string, opts: { cwd?: string }) => {
      const runOpts: RunOpts = {};
      if (opts.cwd) runOpts.cwd = opts.cwd;
      const code = await disableFeature(feature, runOpts);
      if (code !== 0) process.exit(code);
    });
  return cmd;
}
