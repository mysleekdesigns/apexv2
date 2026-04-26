import { Command } from "commander";
import kleur from "kleur";
import { CodeIndex, type SymbolHit } from "../../codeindex/index.js";
import { loadConfig, getCodeIndexConfig } from "../../config/index.js";
import type { SymbolKind } from "../../codeindex/extract.js";

interface CommonOpts {
  cwd?: string;
}

function resolveRoot(opts: CommonOpts): string {
  return opts.cwd ?? process.cwd();
}

export function codeindexCommand(): Command {
  const cmd = new Command("codeindex").description(
    "Tree-sitter code-symbol index (opt-in)",
  );

  cmd
    .command("sync")
    .description("Walk the repo and refresh the symbol index")
    .option("--cwd <path>", "Run as if invoked from <path>")
    .option("--json", "Emit JSON")
    .action(async (opts: CommonOpts & { json?: boolean }) => {
      const root = resolveRoot(opts);
      const ci = getCodeIndexConfig(await loadConfig(root));
      const index = new CodeIndex(root, {
        maxFileKb: ci.max_file_kb,
        ...(ci.languages ? { languages: ci.languages } : {}),
      });
      try {
        const result = await index.sync();
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          return;
        }
        process.stdout.write(
          `Scanned ${result.filesScanned} files; updated ${result.filesUpdated}; removed ${result.filesRemoved}.\n` +
            `Total symbols: ${result.symbolsTotal}. (${result.durationMs}ms)\n`,
        );
      } finally {
        index.close();
      }
    });

  cmd
    .command("find <query>")
    .description("Search the symbol index")
    .option("--kind <kind>", "Filter by kind (function|class|method|type|interface|const)")
    .option("--exported", "Restrict to exported symbols")
    .option("--path <hint>", "Path-substring hint to bias results")
    .option("--k <n>", "Number of results", (v) => parseInt(v, 10), 10)
    .option("--cwd <path>", "Run as if invoked from <path>")
    .option("--json", "Emit JSON")
    .action(
      async (
        query: string,
        opts: CommonOpts & {
          kind?: SymbolKind;
          exported?: boolean;
          path?: string;
          k?: number;
          json?: boolean;
        },
      ) => {
        const root = resolveRoot(opts);
        const index = new CodeIndex(root);
        try {
          const direct = await index.findSymbol(query, {
            k: opts.k,
            kind: opts.kind,
            exported: opts.exported,
          });
          let hits: SymbolHit[] = direct;
          if (opts.path) {
            const byPath = await index.findByPathHint(opts.path, { k: opts.k });
            const merged = new Map<string, SymbolHit>();
            for (const h of direct) merged.set(`${h.file}:${h.line}:${h.symbol}`, h);
            for (const h of byPath) {
              const key = `${h.file}:${h.line}:${h.symbol}`;
              const prior = merged.get(key);
              if (prior) prior.score += 0.5;
              else merged.set(key, { ...h, score: h.score * 0.5 });
            }
            hits = [...merged.values()]
              .sort((a, b) => b.score - a.score)
              .slice(0, opts.k ?? 10);
          }
          if (opts.json) {
            process.stdout.write(JSON.stringify(hits, null, 2) + "\n");
            return;
          }
          if (hits.length === 0) {
            process.stdout.write(`No symbols match "${query}".\n`);
            return;
          }
          process.stdout.write(
            `Top ${hits.length} symbol${hits.length === 1 ? "" : "s"} for "${query}":\n`,
          );
          for (const h of hits) {
            const exp = h.exported ? kleur.green("export") : kleur.dim("local");
            process.stdout.write(
              `  ${kleur.bold(h.symbol)} ${kleur.dim(`(${h.kind}, ${h.language}, ${exp})`)} — ${h.file}:${h.line}\n`,
            );
          }
        } finally {
          index.close();
        }
      },
    );

  cmd
    .command("stats")
    .description("Show code-index stats")
    .option("--cwd <path>", "Run as if invoked from <path>")
    .option("--json", "Emit JSON")
    .action(async (opts: CommonOpts & { json?: boolean }) => {
      const root = resolveRoot(opts);
      const index = new CodeIndex(root);
      try {
        const stats = await index.stats();
        if (opts.json) {
          process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
          return;
        }
        process.stdout.write(
          `Indexed ${stats.totalFiles} files / ${stats.totalSymbols} symbols.\n`,
        );
        for (const [lang, n] of Object.entries(stats.byLanguage)) {
          if (n > 0) process.stdout.write(`  ${lang}: ${n}\n`);
        }
        process.stdout.write(`Last sync: ${stats.last_sync ?? "never"}\n`);
        process.stdout.write(`Index path: ${stats.index_path}\n`);
      } finally {
        index.close();
      }
    });

  return cmd;
}
