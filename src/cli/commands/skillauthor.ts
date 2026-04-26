import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import fs from "fs-extra";
import { fileURLToPath } from "node:url";
import { runSkillAuthor } from "../../skillauthor/index.js";

// ---------- propose subcommand ------------------------------------------------

interface ProposeOpts {
  threshold?: string;
  limit?: string;
  episodes?: string;
  cwd?: string;
  dryRun?: boolean;
}

async function runPropose(opts: ProposeOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const threshold = opts.threshold !== undefined ? parseInt(opts.threshold, 10) : 3;
  const limit = opts.limit !== undefined ? parseInt(opts.limit, 10) : 10;
  const episodes = opts.episodes !== undefined ? parseInt(opts.episodes, 10) : 50;

  const report = await runSkillAuthor(root, {
    threshold,
    limit,
    episodes,
    dryRun: opts.dryRun,
  });

  const tag = opts.dryRun ? "[dry-run] " : "";

  console.log(
    kleur.cyan(
      `${tag}skillauthor: ${report.patternsDetected} pattern(s) detected, ` +
        `${report.drafted} draft(s) proposed, ` +
        `${report.written.length} file(s) written, ` +
        `${report.skipped.length} skipped.`,
    ),
  );

  for (const w of report.written) {
    console.log(kleur.gray(`  ${tag}wrote ${w}`));
  }
  for (const s of report.skipped) {
    console.log(kleur.yellow(`  skipped ${s.slug} (${s.reason})`));
  }
}

// ---------- list subcommand ---------------------------------------------------

interface ListOpts {
  cwd?: string;
}

async function runList(opts: ListOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const proposedSkillsDir = path.join(root, ".apex", "proposed-skills");

  if (!(await fs.pathExists(proposedSkillsDir))) {
    console.log(kleur.gray("No proposed skills found (directory does not exist)."));
    return;
  }

  const entries = await fs.readdir(proposedSkillsDir);
  const skills: string[] = [];
  for (const entry of entries) {
    const skillFile = path.join(proposedSkillsDir, entry, "SKILL.md");
    if (await fs.pathExists(skillFile)) {
      skills.push(entry);
    }
  }

  if (skills.length === 0) {
    console.log(kleur.gray("No proposed skills found."));
    return;
  }

  console.log(kleur.cyan(`Proposed skills (${skills.length}):`));
  for (const slug of skills.sort()) {
    console.log(kleur.gray(`  ${slug}  →  ${path.join(proposedSkillsDir, slug, "SKILL.md")}`));
  }
}

// ---------- command builder ---------------------------------------------------

export function skillauthorCommand(): Command {
  const cmd = new Command("skillauthor");
  cmd.description(
    "Detect recurring tool workflows across episodes and draft SKILL.md proposals.",
  );

  cmd
    .command("propose")
    .description(
      "Detect patterns and draft SKILL.md files under .apex/proposed-skills/.",
    )
    .option("--threshold <n>", "minimum occurrences to qualify a pattern (default: 3)")
    .option("--limit <n>", "max skill drafts to produce per run (default: 10)")
    .option("--episodes <n>", "how many recent episodes to scan (default: 50)")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .option("--dry-run", "detect and draft but do not write files")
    .action(async (opts: ProposeOpts) => runPropose(opts));

  cmd
    .command("list")
    .description("List existing proposed skills under .apex/proposed-skills/.")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: ListOpts) => runList(opts));

  return cmd;
}

// ---------- standalone entry point -------------------------------------------

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
  const standalone = new Command("apex-skillauthor");
  standalone.description(
    "Detect recurring tool workflows across episodes and draft SKILL.md proposals.",
  );

  standalone
    .command("propose")
    .description("Detect patterns and draft SKILL.md files under .apex/proposed-skills/.")
    .option("--threshold <n>", "minimum occurrences to qualify a pattern (default: 3)")
    .option("--limit <n>", "max skill drafts to produce per run (default: 10)")
    .option("--episodes <n>", "how many recent episodes to scan (default: 50)")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .option("--dry-run", "detect and draft but do not write files")
    .action(async (opts: ProposeOpts) => runPropose(opts));

  standalone
    .command("list")
    .description("List existing proposed skills under .apex/proposed-skills/.")
    .option("--cwd <path>", "project root (default: cwd)", process.cwd())
    .action(async (opts: ListOpts) => runList(opts));

  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
