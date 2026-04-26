import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KnowledgeGraph } from "../../graph/index.js";

interface CommonOpts {
  cwd?: string;
  json?: boolean;
}

async function runSync(opts: CommonOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const graph = new KnowledgeGraph(root);
  const result = await graph.sync();
  graph.close();
  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  console.log(
    kleur.cyan(
      `graph: synced ${result.nodes} node(s), ${result.edges} edge(s) in ${result.durationMs}ms`,
    ),
  );
}

async function runDeps(
  entryId: string,
  opts: CommonOpts & { depth?: string; relation?: string },
): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const graph = new KnowledgeGraph(root);
  const maxDepth = parseDepth(opts.depth);
  const relation = opts.relation as
    | "supersedes"
    | "applies-to"
    | "references"
    | "tagged"
    | "affects"
    | undefined;
  const results = await graph.dependencies(entryId, { maxDepth, relation });
  graph.close();
  if (opts.json) {
    process.stdout.write(JSON.stringify({ entry_id: entryId, results }) + "\n");
    return;
  }
  if (results.length === 0) {
    console.log(kleur.gray(`graph deps ${entryId}: no dependencies`));
    return;
  }
  console.log(kleur.cyan(`graph deps ${entryId} (depth ≤ ${maxDepth}):`));
  for (const r of results) {
    console.log(
      kleur.gray(
        `  d${r.depth} -[${r.relation}]-> ${r.node.id}  ${kleur.dim(r.node.label)}`,
      ),
    );
  }
}

async function runDependents(
  entryId: string,
  opts: CommonOpts & { depth?: string; relation?: string },
): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const graph = new KnowledgeGraph(root);
  const maxDepth = parseDepth(opts.depth);
  const relation = opts.relation as
    | "supersedes"
    | "applies-to"
    | "references"
    | "tagged"
    | "affects"
    | undefined;
  const results = await graph.dependents(entryId, { maxDepth, relation });
  graph.close();
  if (opts.json) {
    process.stdout.write(JSON.stringify({ entry_id: entryId, results }) + "\n");
    return;
  }
  if (results.length === 0) {
    console.log(kleur.gray(`graph dependents ${entryId}: nothing depends on it`));
    return;
  }
  console.log(kleur.cyan(`graph dependents ${entryId} (depth ≤ ${maxDepth}):`));
  for (const r of results) {
    console.log(
      kleur.gray(
        `  d${r.depth} <-[${r.relation}]- ${r.node.id}  ${kleur.dim(r.node.label)}`,
      ),
    );
  }
}

async function runBlast(
  entryId: string,
  opts: CommonOpts & { depth?: string },
): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const graph = new KnowledgeGraph(root);
  const depth = parseDepth(opts.depth, 2);
  const results = await graph.blastRadius(entryId, depth);
  graph.close();
  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ entry_id: entryId, depth, results }) + "\n",
    );
    return;
  }
  if (results.length === 0) {
    console.log(kleur.gray(`graph blast ${entryId}: no neighbors`));
    return;
  }
  console.log(
    kleur.cyan(`graph blast ${entryId} (depth ≤ ${depth}, ${results.length} node(s)):`),
  );
  for (const r of results) {
    const arrow = r.direction === "in" ? "<-" : "->";
    console.log(
      kleur.gray(
        `  d${r.depth} ${arrow}[${r.relation}] ${r.node.id}  rank=${r.rank}  ${kleur.dim(r.node.label)}`,
      ),
    );
  }
}

async function runStats(opts: CommonOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const graph = new KnowledgeGraph(root);
  const s = graph.stats();
  graph.close();
  if (opts.json) {
    process.stdout.write(JSON.stringify(s) + "\n");
    return;
  }
  console.log(
    kleur.cyan(
      `graph stats: ${s.nodes} node(s), ${s.edges} edge(s), ${s.orphanNodes} orphan(s)`,
    ),
  );
  const types = Object.entries(s.byNodeType)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  if (types) console.log(kleur.gray(`  nodes by type:    ${types}`));
  const rels = Object.entries(s.byRelation)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  if (rels) console.log(kleur.gray(`  edges by relation: ${rels}`));
  if (s.last_sync) console.log(kleur.gray(`  last sync: ${s.last_sync}`));
}

function parseDepth(raw: string | undefined, fallback: 1 | 2 | 3 = 1): 1 | 2 | 3 {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (n === 1 || n === 2 || n === 3) return n;
  throw new Error(`--depth must be 1, 2, or 3 (got ${raw})`);
}

export function graphCommand(): Command {
  const cmd = new Command("graph");
  cmd.description("Build and query the APEX knowledge graph (opt-in property graph).");

  cmd
    .command("sync")
    .description("Build/refresh the graph at .apex/index/graph.sqlite from .apex/knowledge/")
    .option("--cwd <path>", "project root (default: cwd)")
    .option("--json", "Emit JSON")
    .action(async (opts: CommonOpts) => runSync(opts));

  cmd
    .command("deps <entry-id>")
    .description("Show outgoing dependencies of an entry (e.g. decision:auth-rotation)")
    .option("--depth <n>", "max traversal depth (1|2|3)", "1")
    .option("--relation <name>", "filter by relation")
    .option("--cwd <path>", "project root (default: cwd)")
    .option("--json", "Emit JSON")
    .action(
      async (
        entryId: string,
        opts: CommonOpts & { depth?: string; relation?: string },
      ) => runDeps(entryId, opts),
    );

  cmd
    .command("dependents <entry-id>")
    .description("Show entries that depend on this entry (incoming edges)")
    .option("--depth <n>", "max traversal depth (1|2|3)", "1")
    .option("--relation <name>", "filter by relation")
    .option("--cwd <path>", "project root (default: cwd)")
    .option("--json", "Emit JSON")
    .action(
      async (
        entryId: string,
        opts: CommonOpts & { depth?: string; relation?: string },
      ) => runDependents(entryId, opts),
    );

  cmd
    .command("blast <entry-id>")
    .description("Show full blast-radius (in + out) for an entry, ranked by incidence")
    .option("--depth <n>", "max traversal depth (1|2|3)", "2")
    .option("--cwd <path>", "project root (default: cwd)")
    .option("--json", "Emit JSON")
    .action(
      async (entryId: string, opts: CommonOpts & { depth?: string }) =>
        runBlast(entryId, opts),
    );

  cmd
    .command("stats")
    .description("Show graph stats (counts by node type and relation, orphans)")
    .option("--cwd <path>", "project root (default: cwd)")
    .option("--json", "Emit JSON")
    .action(async (opts: CommonOpts) => runStats(opts));

  return cmd;
}

function isInvokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const here = fileURLToPath(import.meta.url);
    return path.resolve(here) === path.resolve(argv1);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  const standalone = graphCommand();
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
