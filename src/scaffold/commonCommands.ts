// Derive the "Common Commands" section from a StackDetection.
// Pure: no I/O, deterministic given the same input.
//
// Output is a markdown bullet list. Callers splice it into CLAUDE.md and
// .claude/rules/00-stack.md via the {{COMMON_COMMANDS}} variable.

import type { StackDetection } from "../types/shared.js";

interface Command {
  /** Short label, e.g. "install" or "test". */
  label: string;
  /** Concrete shell command, e.g. "pnpm install". */
  cmd: string;
}

/**
 * Build a markdown bullet list of the canonical commands for this stack.
 * Order is stable: install, test, typecheck (when relevant), lint, format, build.
 */
export function renderCommonCommands(detection: StackDetection): string {
  const cmds = deriveCommands(detection);
  if (cmds.length === 0) {
    return "_No commands detected. Add the canonical commands for this project here._";
  }
  return cmds.map((c) => `- \`${c.cmd}\` — ${c.label}`).join("\n");
}

/**
 * Internal: produce the ordered command list. Exposed for testing and reuse.
 */
export function deriveCommands(detection: StackDetection): Command[] {
  switch (detection.language) {
    case "node":
      return nodeCommands(detection);
    case "python":
      return pythonCommands(detection);
    case "go":
      return goCommands(detection);
    case "rust":
      return rustCommands(detection);
    default:
      return [];
  }
}

function nodeCommands(detection: StackDetection): Command[] {
  const pm = (detection.packageManager ?? "npm").toLowerCase();
  const out: Command[] = [];

  // install
  if (pm === "pnpm") out.push({ label: "install dependencies", cmd: "pnpm install" });
  else if (pm === "yarn") out.push({ label: "install dependencies", cmd: "yarn install" });
  else if (pm === "bun") out.push({ label: "install dependencies", cmd: "bun install" });
  else out.push({ label: "install dependencies", cmd: "npm ci" });

  // test
  const testCmd = nodeTestCommand(pm, detection.testRunner);
  if (testCmd) out.push({ label: "run tests", cmd: testCmd });

  // typecheck — only if TS is present
  if (detection.hasTypeScript) {
    out.push({ label: "typecheck", cmd: nodeRunScript(pm, "typecheck") });
  }

  // lint
  if (detection.lint.length > 0) {
    out.push({ label: "lint", cmd: nodeRunScript(pm, "lint") });
  }

  // format
  if (detection.format.length > 0) {
    out.push({ label: "format", cmd: nodeRunScript(pm, "format") });
  }

  // build (frameworks like Next.js, or generic build script)
  if (detection.frameworks.some((f) => /next|remix|nuxt|sveltekit|vite/i.test(f))) {
    out.push({ label: "build", cmd: nodeRunScript(pm, "build") });
  }

  return out;
}

function nodeRunScript(pm: string, script: string): string {
  // pnpm/yarn/bun support `<pm> <script>` directly; npm needs `npm run`.
  if (pm === "npm") return `npm run ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  if (pm === "bun") return `bun run ${script}`;
  return `pnpm run ${script}`;
}

function nodeTestCommand(pm: string, runner: string | null): string | null {
  if (!runner) {
    // Fall back to the conventional `test` script.
    if (pm === "npm") return "npm test";
    if (pm === "yarn") return "yarn test";
    if (pm === "bun") return "bun test";
    return "pnpm test";
  }
  const r = runner.toLowerCase();
  // Most runners expose themselves via the `test` script in package.json,
  // so we delegate to that. Direct invocation is included for runners where
  // the bare command is more idiomatic.
  if (r === "vitest" || r === "jest" || r === "mocha") {
    if (pm === "npm") return "npm test";
    if (pm === "yarn") return "yarn test";
    if (pm === "bun") return "bun test";
    return "pnpm test";
  }
  if (r === "playwright") return `${pmExec(pm)} playwright test`;
  if (r === "cypress") return `${pmExec(pm)} cypress run`;
  // Unknown runner — defer to `test` script.
  if (pm === "npm") return "npm test";
  return `${pm} test`;
}

function pmExec(pm: string): string {
  if (pm === "npm") return "npx";
  if (pm === "yarn") return "yarn";
  if (pm === "bun") return "bunx";
  return "pnpm exec";
}

function pythonCommands(detection: StackDetection): Command[] {
  const pm = (detection.packageManager ?? "").toLowerCase();
  const out: Command[] = [];

  if (pm === "uv") {
    out.push({ label: "install dependencies", cmd: "uv sync" });
    out.push({ label: "run tests", cmd: "uv run pytest" });
    if (detection.lint.includes("ruff")) {
      out.push({ label: "lint", cmd: "uv run ruff check" });
      out.push({ label: "format", cmd: "uv run ruff format" });
    } else if (detection.format.includes("black")) {
      out.push({ label: "format", cmd: "uv run black ." });
    }
    if (detection.lint.includes("mypy") || detection.lint.includes("pyright")) {
      const tool = detection.lint.includes("mypy") ? "mypy" : "pyright";
      out.push({ label: "typecheck", cmd: `uv run ${tool} .` });
    }
    return out;
  }
  if (pm === "poetry") {
    out.push({ label: "install dependencies", cmd: "poetry install" });
    out.push({ label: "run tests", cmd: "poetry run pytest" });
    if (detection.lint.includes("ruff")) {
      out.push({ label: "lint", cmd: "poetry run ruff check" });
      out.push({ label: "format", cmd: "poetry run ruff format" });
    }
    return out;
  }
  // Plain pip / venv
  out.push({ label: "install dependencies", cmd: "pip install -r requirements.txt" });
  out.push({ label: "run tests", cmd: detection.testRunner === "pytest" ? "pytest" : "python -m unittest" });
  if (detection.lint.includes("ruff")) out.push({ label: "lint", cmd: "ruff check" });
  if (detection.format.includes("black")) out.push({ label: "format", cmd: "black ." });
  return out;
}

function goCommands(_detection: StackDetection): Command[] {
  return [
    { label: "build", cmd: "go build ./..." },
    { label: "run tests", cmd: "go test ./..." },
    { label: "format", cmd: "go fmt ./..." },
    { label: "vet", cmd: "go vet ./..." },
  ];
}

function rustCommands(detection: StackDetection): Command[] {
  const out: Command[] = [
    { label: "build", cmd: "cargo build" },
    { label: "run tests", cmd: "cargo test" },
    { label: "format", cmd: "cargo fmt" },
  ];
  if (detection.lint.includes("clippy")) {
    out.push({ label: "lint", cmd: "cargo clippy --all-targets" });
  }
  return out;
}
