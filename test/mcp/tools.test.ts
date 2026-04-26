import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  apexGet,
  apexPropose,
  apexRecordCorrection,
  apexSearch,
  apexStats,
  createToolContext,
  type ToolContext,
} from "../../src/mcp/tools.js";

function setupFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-mcp-"));
  const src = path.resolve("test/fixtures/knowledge");
  const dest = path.join(root, ".apex", "knowledge");
  fs.mkdirSync(dest, { recursive: true });
  for (const sub of ["decisions", "patterns", "gotchas", "conventions"]) {
    fs.mkdirSync(path.join(dest, sub), { recursive: true });
    const dir = path.join(src, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      fs.copyFileSync(path.join(dir, f), path.join(dest, sub, f));
    }
  }
  return root;
}

describe("MCP tools", () => {
  let ctx: ToolContext;
  let root: string;

  beforeEach(() => {
    root = setupFixture();
    ctx = createToolContext(root);
  });

  afterEach(() => {
    ctx.recall.close();
  });

  it("apex_search returns ranked hits with provenance", async () => {
    const result = await apexSearch(ctx, { query: "pnpm package manager" });
    expect(result.query).toBe("pnpm package manager");
    expect(result.hits.length).toBeGreaterThan(0);
    const top = result.hits[0]!;
    expect(top.entry_id).toBe("gh-pnpm-not-npm");
    expect(top.path).toContain(".apex/knowledge/conventions/gh-pnpm-not-npm.md");
    expect(top.last_validated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(top.tier).toBe("fts");
    expect(top.rank).toBe(1);
  });

  it("apex_search honors the type filter", async () => {
    const all = await apexSearch(ctx, { query: "prisma users" });
    const onlyGotchas = await apexSearch(ctx, {
      query: "prisma users",
      type: "gotcha",
    });
    expect(onlyGotchas.hits.every((h) => h.entry_type === "gotcha")).toBe(true);
    expect(onlyGotchas.hits.length).toBeLessThanOrEqual(all.hits.length);
  });

  it("apex_search returns no hits for an unknown query", async () => {
    const r = await apexSearch(ctx, { query: "xyzzy-nonsense-token" });
    expect(r.hits).toEqual([]);
  });

  it("apex_get returns a full entry", async () => {
    const e = await apexGet(ctx, { entry_id: "gh-pnpm-not-npm", type: "convention" });
    expect(e).not.toBeNull();
    expect(e?.frontmatter.title).toContain("pnpm");
    expect(e?.body.length).toBeGreaterThan(0);
  });

  it("apex_get returns null for an unknown id", async () => {
    const e = await apexGet(ctx, { entry_id: "does-not-exist" });
    expect(e).toBeNull();
  });

  it("apex_record_correction appends to _corrections.md", async () => {
    const r = await apexRecordCorrection(ctx, {
      prompt: "use npm install",
      correction: "this project uses pnpm",
      evidence: "see .github/workflows/ci.yml step verify-lockfile",
    });
    expect(r.path).toBe(".apex/proposed/_corrections.md");
    const abs = path.join(root, r.path);
    const content = fs.readFileSync(abs, "utf8");
    expect(content).toContain("Correction recorded");
    expect(content).toContain("use npm install");
    expect(content).toContain("this project uses pnpm");

    // Append again — the file grows.
    await apexRecordCorrection(ctx, {
      prompt: "second prompt",
      correction: "second correction",
      evidence: "second evidence",
    });
    const after = fs.readFileSync(abs, "utf8");
    expect(after.length).toBeGreaterThan(content.length);
    expect(after).toContain("second correction");
  });

  it("apex_propose writes to .apex/proposed/<file>", async () => {
    const r = await apexPropose(ctx, {
      entry: {
        frontmatter: {
          id: "test-proposal",
          type: "convention",
          title: "Test proposal",
          applies_to: "team",
          confidence: "low",
          sources: [{ kind: "manual", ref: "manual/test" }],
          created: "2026-04-26",
          last_validated: "2026-04-26",
          rule: "do the thing",
          enforcement: "manual",
        },
        body: "Body of the proposal.",
      },
    });
    expect(r.id).toBe("test-proposal");
    expect(r.type).toBe("convention");
    expect(r.path).toBe(".apex/proposed/convention-test-proposal.md");
    const abs = path.join(root, r.path);
    expect(fs.existsSync(abs)).toBe(true);
    const content = fs.readFileSync(abs, "utf8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("id: test-proposal");
    expect(content).toContain("Body of the proposal.");
  });

  it("apex_stats returns counts and last_sync", async () => {
    // Trigger a search first to ensure the index is hydrated.
    await apexSearch(ctx, { query: "anything" });
    const s = await apexStats(ctx);
    expect(s.total).toBe(12);
    expect(s.by_type.decision).toBe(3);
    expect(s.by_type.pattern).toBe(3);
    expect(s.by_type.gotcha).toBe(3);
    expect(s.by_type.convention).toBe(3);
    expect(s.last_sync).not.toBeNull();
    expect(s.index_path).toContain(".apex/index/fts.sqlite");
  });

  it("P50 search latency on the fixture set is under 50ms", async () => {
    // Warm.
    await apexSearch(ctx, { query: "warm" });
    const queries = [
      "pnpm",
      "jwt rotation",
      "prisma soft delete",
      "cursor pagination",
      "zod validation",
      "feature flag",
      "next.js cache",
      "convention commits",
      "default exports",
      "postgres",
      "result type",
      "user service",
    ];
    const samples: number[] = [];
    for (let i = 0; i < 4; i++) {
      for (const q of queries) {
        const t0 = performance.now();
        await apexSearch(ctx, { query: q });
        samples.push(performance.now() - t0);
      }
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length / 2)] ?? 0;
    // Soft assertion: log and require well under 50ms.
    process.stdout.write(
      `[apex-mcp] P50 search latency: ${p50.toFixed(2)}ms over ${samples.length} samples\n`,
    );
    expect(p50).toBeLessThan(50);
  });
});
