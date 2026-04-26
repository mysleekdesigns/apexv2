/**
 * apex shadow — cross-session memory shadow prefetch subsystem.
 *
 * Subcommands:
 *   prefetch  Run prediction + recall + cache-write for a prompt.
 *   stats     Report cache size and hit rate.
 *   clear     Remove the prefetch cache.
 */

import { Command } from "commander";
import kleur from "kleur";
import { runShadowPrefetch } from "../../shadow/index.js";
import { computeShadowStats } from "../../shadow/stats.js";
import { clearCache } from "../../shadow/cache.js";

interface PrefetchOpts {
  prompt: string;
  ttl: string;
  cwd: string;
}

interface StatsOpts {
  cwd: string;
  json?: boolean;
}

interface ClearOpts {
  cwd: string;
}

async function runPrefetch(opts: PrefetchOpts): Promise<void> {
  const root = opts.cwd;
  const ttlMs = Math.round(parseFloat(opts.ttl) * 60 * 1000);

  const start = Date.now();
  const result = await runShadowPrefetch(root, opts.prompt, { ttlMs });
  const elapsed = Date.now() - start;

  console.log(
    kleur.cyan(
      `predicted ${result.predicted.length} queries, ` +
        `cached ${result.cached} results in ${elapsed}ms`,
    ),
  );

  if (result.hits.length > 0) {
    console.log(kleur.gray(`  warm hits: ${result.hits.join(", ")}`));
  }
  for (const q of result.predicted) {
    console.log(kleur.gray(`  query: ${q}`));
  }
}

async function runStats(opts: StatsOpts): Promise<void> {
  const root = opts.cwd;
  const stats = computeShadowStats(root);

  if (opts.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  const rate = (stats.hitRate24h * 100).toFixed(1);
  console.log(kleur.cyan("shadow prefetch stats:"));
  console.log(kleur.gray(`  cache entries: ${stats.cacheEntries}`));
  console.log(kleur.gray(`  hits (last 24h): ${stats.hitsLast24h}`));
  console.log(kleur.gray(`  total hits: ${stats.totalHits}`));
  console.log(kleur.gray(`  hit rate (24h/total): ${rate}%`));
}

async function runClear(opts: ClearOpts): Promise<void> {
  await clearCache(opts.cwd);
  console.log(kleur.cyan("shadow prefetch cache cleared."));
}

export function shadowCommand(): Command {
  const shadow = new Command("shadow");
  shadow.description("Cross-session memory shadow: prefetch and cache likely-needed knowledge.");

  // prefetch subcommand
  const prefetch = new Command("prefetch");
  prefetch
    .description("Predict queries from a prompt and warm the recall cache.")
    .requiredOption("--prompt <text>", "The prompt to predict from")
    .option("--ttl <minutes>", "Cache TTL in minutes", "15")
    .option("--cwd <path>", "Project root", process.cwd())
    .action(async (opts: PrefetchOpts) => {
      await runPrefetch(opts);
    });

  // stats subcommand
  const stats = new Command("stats");
  stats
    .description("Show cache size and hit rate.")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (opts: StatsOpts) => {
      await runStats(opts);
    });

  // clear subcommand
  const clear = new Command("clear");
  clear
    .description("Remove the prefetch cache directory.")
    .option("--cwd <path>", "Project root", process.cwd())
    .action(async (opts: ClearOpts) => {
      await runClear(opts);
    });

  shadow.addCommand(prefetch);
  shadow.addCommand(stats);
  shadow.addCommand(clear);

  return shadow;
}
