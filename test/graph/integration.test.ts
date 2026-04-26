import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { KnowledgeGraph } from "../../src/graph/index.js";

function setupFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-graph-int-"));
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

const SUPERSEDING_DECISION = `---
id: auth-rotate-jwt-180d
type: decision
title: Rotate JWT every 180 days
applies_to: team
confidence: medium
sources:
  - kind: manual
    ref: manual/security-team
created: 2026-04-26
last_validated: 2026-04-26
supersedes: [auth-rotate-jwt-90d]
tags: [auth, security]
decision: Rotate the signing JWT every 180 days.
rationale: 90 days still surfaces silent-failure tickets each cycle.
outcome: pending
affects:
  - apps/api/jobs/rotate-jwt.ts
---

See [[auth-rotate-jwt-90d]] for the prior decision.
`;

const REFERENCING_PATTERN = `---
id: jwt-refresh-pattern
type: pattern
title: Refresh JWT before expiry on the client
applies_to: team
confidence: medium
sources:
  - kind: manual
    ref: manual/test
created: 2026-04-20
last_validated: 2026-04-26
tags: [auth, jwt]
intent: Avoid 401 storms on token expiry by refreshing proactively
applies_when:
  - Building a client that calls the API for >5 minutes
---

This pattern depends on [[auth-rotate-jwt-90d]] timings.
`;

describe("KnowledgeGraph — integration", () => {
  let root: string;
  let graph: KnowledgeGraph;

  beforeEach(() => {
    root = setupFixture();
    fs.writeFileSync(
      path.join(
        root,
        ".apex",
        "knowledge",
        "decisions",
        "auth-rotate-jwt-180d.md",
      ),
      SUPERSEDING_DECISION,
      "utf8",
    );
    fs.writeFileSync(
      path.join(
        root,
        ".apex",
        "knowledge",
        "patterns",
        "jwt-refresh-pattern.md",
      ),
      REFERENCING_PATTERN,
      "utf8",
    );
    graph = new KnowledgeGraph(root);
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("syncs a knowledge directory and produces nodes + edges", async () => {
    const r = await graph.sync();
    expect(r.nodes).toBeGreaterThan(14);
    expect(r.edges).toBeGreaterThan(10);
    expect(r.durationMs).toBeLessThan(500);
  });

  it("resolves supersedes with cross-entry type lookup", async () => {
    await graph.sync();
    const deps = await graph.dependencies("decision:auth-rotate-jwt-180d", {
      relation: "supersedes",
    });
    expect(deps.map((d) => d.node.id)).toContain("decision:auth-rotate-jwt-90d");
  });

  it("dependents() finds patterns that reference a decision", async () => {
    await graph.sync();
    const deps = await graph.dependents("decision:auth-rotate-jwt-90d", {
      maxDepth: 2,
    });
    const ids = deps.map((d) => d.node.id);
    expect(ids).toContain("pattern:jwt-refresh-pattern");
    expect(ids).toContain("decision:auth-rotate-jwt-180d");
  });

  it("blastRadius merges in/out and ranks results", async () => {
    await graph.sync();
    const blast = await graph.blastRadius("decision:auth-rotate-jwt-90d", 2);
    expect(blast.length).toBeGreaterThan(0);
    const ids = blast.map((b) => b.node.id);
    // Should reach both the superseder (incoming) and affected files (outgoing)
    expect(ids).toContain("decision:auth-rotate-jwt-180d");
    expect(ids).toContain("file:apps/api/jobs/rotate-jwt.ts");
    // Each node appears once (deduped)
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("findPath returns the shortest supersedes chain", async () => {
    await graph.sync();
    const p = await graph.findPath(
      "decision:auth-rotate-jwt-180d",
      "decision:auth-rotate-jwt-90d",
      4,
    );
    expect(p).not.toBeNull();
    expect(p?.length).toBe(1);
    expect(p?.[0]?.relation).toBe("supersedes");
  });

  it("findPath returns null when unreachable", async () => {
    await graph.sync();
    const p = await graph.findPath(
      "decision:auth-rotate-jwt-90d",
      "convention:gh-pnpm-not-npm",
      4,
    );
    expect(p).toBeNull();
  });

  it("stats reports counts across types and relations", async () => {
    await graph.sync();
    const s = graph.stats();
    expect(s.nodes).toBeGreaterThan(0);
    expect(s.byNodeType["decision"]).toBeGreaterThanOrEqual(4);
    expect(s.byNodeType["file"]).toBeGreaterThan(0);
    expect(s.byRelation["affects"]).toBeGreaterThan(0);
    expect(s.byRelation["supersedes"]).toBeGreaterThanOrEqual(1);
    expect(s.byRelation["tagged"]).toBeGreaterThan(0);
    expect(s.last_sync).not.toBeNull();
  });

  it("re-sync replaces stale state cleanly", async () => {
    await graph.sync();
    fs.unlinkSync(
      path.join(
        root,
        ".apex",
        "knowledge",
        "decisions",
        "auth-rotate-jwt-180d.md",
      ),
    );
    await graph.sync();
    const node = await graph.getNode("decision:auth-rotate-jwt-180d");
    expect(node).toBeNull();
  });
});
