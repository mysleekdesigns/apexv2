import { Recall } from "../../recall/index.js";
import type { KnowledgeType } from "../../types/shared.js";

export interface SearchCliOptions {
  query: string;
  root?: string;
  type?: KnowledgeType;
  k?: number;
  json?: boolean;
}

export async function runSearch(opts: SearchCliOptions): Promise<string> {
  const root = opts.root ?? process.cwd();
  const recall = new Recall(root);
  try {
    const hits = await recall.search(opts.query, { type: opts.type, k: opts.k ?? 5 });
    if (opts.json) return JSON.stringify(hits, null, 2);
    if (hits.length === 0) {
      return `No results for "${opts.query}".`;
    }
    const lines: string[] = [];
    lines.push(`Top ${hits.length} result${hits.length === 1 ? "" : "s"} for "${opts.query}":`);
    for (const h of hits) {
      lines.push("");
      lines.push(`  ${h.rank}. [${h.entry_type}] ${h.title}`);
      lines.push(`     ${h.path}  (confidence: ${h.confidence}, validated: ${h.last_validated})`);
      lines.push(`     ${h.excerpt}`);
    }
    return lines.join("\n");
  } finally {
    recall.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write("usage: apex search <query> [--type <t>] [--k <n>] [--json]\n");
    process.exit(2);
  }
  let type: KnowledgeType | undefined;
  let k: number | undefined;
  let json = false;
  const queryParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--type" && i + 1 < args.length) {
      type = args[++i] as KnowledgeType;
    } else if (a === "--k" && i + 1 < args.length) {
      const next = args[++i];
      k = next ? Number(next) : undefined;
    } else if (a === "--json") {
      json = true;
    } else if (a !== undefined) {
      queryParts.push(a);
    }
  }
  const query = queryParts.join(" ").trim();
  if (!query) {
    process.stderr.write("error: empty query\n");
    process.exit(2);
  }
  const out = await runSearch({ query, type, k, json });
  process.stdout.write(`${out}\n`);
}

const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirect) {
  main().catch((err: Error) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}
