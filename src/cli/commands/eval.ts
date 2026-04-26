import path from "node:path";
import { Command } from "commander";
import kleur from "kleur";
import { planRun, runEval } from "../../eval/index.js";
import type { EvalStack, RunOptions } from "../../eval/types.js";

const VALID_STACKS: EvalStack[] = ["node-typescript", "python", "nextjs"];

interface CliOpts {
  stack?: string;
  episodeGlob?: string;
  withApex?: boolean;
  withoutApex?: boolean;
  out?: string;
  dryRun?: boolean;
  cwd?: string;
}

function parseStack(raw: string | undefined): EvalStack | undefined {
  if (!raw) return undefined;
  if (!VALID_STACKS.includes(raw as EvalStack)) {
    throw new Error(
      `invalid --stack "${raw}" (use ${VALID_STACKS.join("|")})`,
    );
  }
  return raw as EvalStack;
}

export async function runEvalCli(opts: CliOpts): Promise<number> {
  const root = opts.cwd ?? process.cwd();
  let stack: EvalStack | undefined;
  try {
    stack = parseStack(opts.stack);
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 2;
  }
  if (opts.withApex && opts.withoutApex) {
    process.stderr.write("error: cannot pass both --with-apex and --without-apex\n");
    return 2;
  }
  const withApex = opts.withoutApex ? false : true;

  const runOpts: RunOptions = { root, withApex };
  if (stack) runOpts.stack = stack;
  if (opts.episodeGlob) runOpts.episodeGlob = opts.episodeGlob;
  if (opts.out) runOpts.out = opts.out;
  if (opts.dryRun) runOpts.dryRun = true;

  if (opts.dryRun) {
    const plan = await planRun(runOpts);
    const total = plan.syntheticTasks.length + plan.replayTasks.length;
    process.stdout.write(
      kleur.cyan(
        `[dry-run] eval would run ${total} task${total === 1 ? "" : "s"} ` +
          `(${plan.syntheticTasks.length} synthetic, ${plan.replayTasks.length} replay)\n`,
      ),
    );
    for (const t of plan.syntheticTasks) {
      process.stdout.write(`  synthetic  ${t.frontmatter.stack.padEnd(16)} ${t.frontmatter.id}\n`);
    }
    for (const r of plan.replayTasks) {
      process.stdout.write(
        `  replay     ${r.task.frontmatter.stack.padEnd(16)} ${r.task.frontmatter.id}\n`,
      );
    }
    return 0;
  }

  const summary = await runEval(runOpts);
  const total = summary.pass_count + summary.fail_count;
  const pr = total === 0 ? 0 : summary.pass_count / total;
  process.stdout.write(
    `eval: ${summary.pass_count}/${total} passed (${(pr * 100).toFixed(0)}%) — ` +
      `${summary.synthetic_count} synthetic, ${summary.replay_count} replay\n`,
  );
  if (summary.prev_report_path) {
    process.stdout.write(
      `  vs ${path.basename(summary.prev_report_path)}: ` +
        `prior pass rate ${summary.prev_pass_rate !== null ? (summary.prev_pass_rate * 100).toFixed(0) + "%" : "n/a"}\n`,
    );
  }
  process.stdout.write(
    `  metrics: repeat-mistake=${summary.metrics.repeat_mistake_rate.toFixed(2)} ` +
      `hit-rate=${summary.metrics.knowledge_hit_rate.toFixed(2)} ` +
      `correction/100=${summary.metrics.user_correction_frequency.toFixed(2)}\n`,
  );
  return summary.fail_count === 0 ? 0 : 1;
}

export function evalCommand(): Command {
  const cmd = new Command("eval");
  cmd
    .description(
      "Run the APEX eval harness: synthetic tasks + replay episodes; writes a markdown report.",
    )
    .option("--stack <name>", "Filter to a stack (node-typescript|python|nextjs)")
    .option("--episode-glob <pattern>", "Filter replay episodes by id glob")
    .option("--with-apex", "Score retrieval signals as available (default)")
    .option("--without-apex", "Strip retrieved-knowledge context (ablation)")
    .option("--out <path>", "Override report output path")
    .option("--dry-run", "List tasks without executing")
    .option("--cwd <path>", "Run as if invoked from <path>")
    .action(async (opts: CliOpts) => {
      const code = await runEvalCli(opts);
      process.exit(code);
    });
  return cmd;
}
