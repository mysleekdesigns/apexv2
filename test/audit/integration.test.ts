// Loose integration test: run scanForExternalCalls against this very repo.
// Assertion is intentionally loose — we just want to ensure the scanner runs
// to completion against real source and produces a sensible shape.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  partitionFindings,
  scanForExternalCalls,
} from "../../src/audit/scanner.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");

describe("audit — scanner against APEX repo", () => {
  it("produces an array (possibly empty) of well-shaped findings", async () => {
    const findings = await scanForExternalCalls(REPO_ROOT);
    expect(Array.isArray(findings)).toBe(true);
    for (const f of findings) {
      expect(typeof f.file).toBe("string");
      expect(typeof f.line).toBe("number");
      expect(typeof f.text).toBe("string");
      expect(["fetch", "http", "library", "shell"]).toContain(f.kind);
      expect(typeof f.productionPath).toBe("boolean");
    }
  });

  it("partitions findings into production vs test-only", async () => {
    const findings = await scanForExternalCalls(REPO_ROOT);
    const { production, testOnly } = partitionFindings(findings);
    expect(production.length + testOnly.length).toBe(findings.length);
    // Every production finding must NOT be in a test-only path.
    for (const f of production) {
      expect(f.productionPath).toBe(true);
    }
  });
});
