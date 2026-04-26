import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  linkRepo,
  unlinkRepo,
  listLinks,
  LinkError,
} from "../../monorepo/link.js";

interface LinkCliOpts {
  name?: string;
  list?: boolean;
  cwd?: string;
}

interface UnlinkCliOpts {
  cwd?: string;
}

async function runLink(target: string | undefined, opts: LinkCliOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();

  if (opts.list) {
    const links = await listLinks(root);
    if (links.length === 0) {
      console.log(kleur.gray("no links configured"));
      return;
    }
    for (const l of links) {
      const status =
        l.symlinkExists && l.targetReachable
          ? kleur.green("ok")
          : !l.symlinkExists
            ? kleur.red("symlink missing")
            : kleur.yellow("target unreachable");
      console.log(
        `${kleur.cyan(l.name)} → ${l.target} [${status}] (created ${l.created})`,
      );
    }
    return;
  }

  if (!target) {
    console.error(kleur.red("error: <other-repo-path> required (or use --list)"));
    process.exit(1);
  }

  try {
    const record = await linkRepo(root, target, opts.name ? { name: opts.name } : {});
    console.log(
      kleur.green(
        `linked ${record.name} → ${record.target} (${path.relative(root, record.symlinkPath)})`,
      ),
    );
  } catch (e: unknown) {
    if (e instanceof LinkError) {
      console.error(kleur.red(`error: ${e.message}`));
      process.exit(1);
    }
    throw e;
  }
}

async function runUnlink(name: string, opts: UnlinkCliOpts): Promise<void> {
  const root = opts.cwd ?? process.cwd();
  const removed = await unlinkRepo(root, name);
  if (removed) {
    console.log(kleur.green(`unlinked ${name}`));
  } else {
    console.log(kleur.gray(`no link named "${name}" found`));
  }
}

function configureLink(cmd: Command): Command {
  return cmd
    .argument("[other-repo-path]", "absolute or relative path to the sibling repo")
    .option("--name <name>", "override the derived link name (default: basename of target)")
    .option("--list", "list all current links instead of creating one")
    .option("--cwd <path>", "project root (default: cwd)");
}

function configureUnlink(cmd: Command): Command {
  return cmd
    .argument("<name>", "link name to remove (matches `apex link --list`)")
    .option("--cwd <path>", "project root (default: cwd)");
}

export function linkCommand(): Command {
  const cmd = new Command("link").description(
    "Link knowledge from a sibling repo into this repo's .apex/links/<name>/. Refuses targets without .apex/knowledge/.",
  );
  configureLink(cmd).action(async (target: string | undefined, opts: LinkCliOpts) =>
    runLink(target, opts),
  );
  return cmd;
}

export function unlinkCommand(): Command {
  const cmd = new Command("unlink").description(
    "Remove a previously created knowledge link by name.",
  );
  configureUnlink(cmd).action(async (name: string, opts: UnlinkCliOpts) =>
    runUnlink(name, opts),
  );
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
  const standalone = new Command("apex-link").description(
    "Link knowledge from a sibling repo.",
  );
  configureLink(standalone).action(async (target: string | undefined, opts: LinkCliOpts) =>
    runLink(target, opts),
  );
  standalone.parseAsync(process.argv).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
