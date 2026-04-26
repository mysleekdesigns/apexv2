// `apex audit` — list every external call APEX (or any project) makes.
// PRD §5.5: default expected output for APEX itself is zero. The command is
// a *report*, not a gate, so it always exits 0.
//
// What this command does NOT cover:
//   - Transitive `node_modules` deps unless `--include-deps`. The spirit of
//     the audit is "what does APEX itself do".
//   - Runtime behaviour. This is static text-based evidence only — a process
//     could in theory build a URL by string concat or use a native binding;
//     such cases will not be flagged.
//   - Build-tool / config-file phone-home (telemetry in framework configs).
//
// Output: human-readable by default, `--json` for machine consumers.

import { Command } from "commander";
import kleur from "kleur";
import path from "node:path";
import {
  partitionFindings,
  scanForExternalCalls,
  type AuditFinding,
} from "../../audit/scanner.js";

interface CliOpts {
  cwd?: string;
  json?: boolean;
  includeDeps?: boolean;
}

interface JsonReport {
  root: string;
  includeDeps: boolean;
  counts: {
    productionFindings: number;
    testOnlyFindings: number;
    totalFindings: number;
  };
  productionFindings: AuditFinding[];
  testOnlyFindings: AuditFinding[];
  notCovered: string[];
}

const NOT_COVERED = [
  "Transitive dependencies in node_modules (unless --include-deps).",
  "Runtime-only network calls (e.g. URLs built via string concatenation).",
  "Native bindings or worker-thread network calls.",
  "Configuration-driven phone-home in build tools.",
];

async function runAudit(opts: CliOpts): Promise<void> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  const findings = await scanForExternalCalls(root, {
    includeDeps: opts.includeDeps ?? false,
  });
  const { production, testOnly } = partitionFindings(findings);

  if (opts.json) {
    const report: JsonReport = {
      root,
      includeDeps: opts.includeDeps ?? false,
      counts: {
        productionFindings: production.length,
        testOnlyFindings: testOnly.length,
        totalFindings: findings.length,
      },
      productionFindings: production,
      testOnlyFindings: testOnly,
      notCovered: NOT_COVERED,
    };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.exit(0);
    return;
  }

  // Human output.
  const header = `apex audit — external-call report for ${root}`;
  process.stdout.write(kleur.bold(header) + "\n");
  process.stdout.write(
    kleur.gray(
      `(scope: ${opts.includeDeps ? "project + node_modules" : "project source only"})`,
    ) + "\n\n",
  );

  if (production.length === 0) {
    process.stdout.write(
      kleur.green(
        "No external calls detected on production paths. (Expected: zero — APEX is local-only.)",
      ) + "\n",
    );
  } else {
    process.stdout.write(
      kleur.yellow(
        `${production.length} production-path finding${production.length === 1 ? "" : "s"}:`,
      ) + "\n",
    );
    for (const f of production) {
      const rel = path.relative(root, f.file);
      process.stdout.write(
        `  ${kleur.cyan(`${rel}:${f.line}`)} [${f.kind}/${f.rule}]\n    ${kleur.gray(f.text)}\n`,
      );
    }
  }

  if (testOnly.length > 0) {
    process.stdout.write(
      "\n" +
        kleur.gray(
          `${testOnly.length} test-only finding${testOnly.length === 1 ? "" : "s"} (not in production paths; informational):`,
        ) +
        "\n",
    );
    for (const f of testOnly) {
      const rel = path.relative(root, f.file);
      process.stdout.write(
        `  ${kleur.gray(`${rel}:${f.line}`)} [${f.kind}/${f.rule}]\n    ${kleur.gray(f.text)}\n`,
      );
    }
  }

  process.stdout.write("\n" + kleur.gray("This audit does NOT cover:") + "\n");
  for (const note of NOT_COVERED) {
    process.stdout.write(kleur.gray(`  - ${note}`) + "\n");
  }

  // Always exit 0 — this is a report, not a gate.
  process.exit(0);
}

export function auditCommand(): Command {
  const cmd = new Command("audit").description(
    "List every external call APEX makes (default: zero). Reports static evidence in source files.",
  );
  cmd
    .option("--json", "emit JSON report instead of human-readable text")
    .option(
      "--include-deps",
      "also scan node_modules (default: off — audits APEX itself only)",
    )
    .option("--cwd <path>", "project root (default: cwd)")
    .action(async (opts: CliOpts) => runAudit(opts));
  return cmd;
}
