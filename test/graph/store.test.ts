import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { GraphStore } from "../../src/graph/store.js";

function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-graph-"));
  return path.join(dir, "graph.sqlite");
}

describe("GraphStore", () => {
  let dbPath: string;
  let store: GraphStore;

  beforeEach(() => {
    dbPath = tmpDb();
    store = new GraphStore(dbPath);
  });

  afterEach(() => {
    store.close();
  });

  function seed(): void {
    store.upsertNode({ id: "decision:a", type: "decision", label: "A" });
    store.upsertNode({ id: "decision:b", type: "decision", label: "B" });
    store.upsertNode({ id: "decision:c", type: "decision", label: "C" });
    store.upsertNode({ id: "pattern:p", type: "pattern", label: "P" });
    store.upsertNode({ id: "file:apps/x.ts", type: "file", label: "apps/x.ts" });
    store.upsertNode({ id: "tag:auth", type: "tag", label: "auth" });
    store.upsertEdge({ src: "decision:b", dst: "decision:a", relation: "supersedes" });
    store.upsertEdge({ src: "decision:c", dst: "decision:b", relation: "supersedes" });
    store.upsertEdge({ src: "pattern:p", dst: "decision:a", relation: "references" });
    store.upsertEdge({ src: "decision:a", dst: "file:apps/x.ts", relation: "affects" });
    store.upsertEdge({ src: "decision:a", dst: "tag:auth", relation: "tagged" });
  }

  it("upserts and retrieves a node", () => {
    store.upsertNode({
      id: "decision:foo",
      type: "decision",
      label: "Foo",
      confidence: "high",
      last_validated: "2026-04-26",
    });
    const got = store.getNode("decision:foo");
    expect(got?.label).toBe("Foo");
    expect(got?.confidence).toBe("high");
  });

  it("upsertNode is idempotent", () => {
    store.upsertNode({ id: "x", type: "decision", label: "L1" });
    store.upsertNode({ id: "x", type: "decision", label: "L2" });
    expect(store.getNode("x")?.label).toBe("L2");
    expect(store.listNodes().length).toBe(1);
  });

  it("upsertEdge with same triple updates weight (no duplicate)", () => {
    store.upsertNode({ id: "a", type: "decision", label: "A" });
    store.upsertNode({ id: "b", type: "decision", label: "B" });
    store.upsertEdge({ src: "a", dst: "b", relation: "supersedes", weight: 1 });
    store.upsertEdge({ src: "a", dst: "b", relation: "supersedes", weight: 2 });
    const edges = store.listEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.weight).toBe(2);
  });

  it("deleteNode removes node and incident edges", () => {
    seed();
    store.deleteNode("decision:a");
    expect(store.getNode("decision:a")).toBeNull();
    const remaining = store.listEdges();
    for (const e of remaining) {
      expect(e.src).not.toBe("decision:a");
      expect(e.dst).not.toBe("decision:a");
    }
  });

  it("deleteEdgesFrom removes only outgoing edges", () => {
    seed();
    store.deleteEdgesFrom("decision:a");
    const fromA = store.listEdges().filter((e) => e.src === "decision:a");
    expect(fromA).toHaveLength(0);
    expect(store.listEdges().filter((e) => e.dst === "decision:a")).not.toHaveLength(0);
  });

  it("neighbors with direction=out returns outgoing nodes at depth 1", () => {
    seed();
    const n = store.neighbors("decision:a", { direction: "out" });
    const ids = n.map((x) => x.node.id).sort();
    expect(ids).toEqual(["file:apps/x.ts", "tag:auth"]);
  });

  it("neighbors with direction=in returns incoming nodes at depth 1", () => {
    seed();
    const n = store.neighbors("decision:a", { direction: "in" });
    const ids = n.map((x) => x.node.id).sort();
    expect(ids).toEqual(["decision:b", "pattern:p"]);
  });

  it("neighbors with direction=both at depth 2 traverses chain", () => {
    seed();
    const n = store.neighbors("decision:a", { direction: "in", maxDepth: 2 });
    const ids = n.map((x) => x.node.id).sort();
    expect(ids).toContain("decision:c");
    expect(ids).toContain("decision:b");
    expect(ids).toContain("pattern:p");
    const c = n.find((x) => x.node.id === "decision:c");
    expect(c?.depth).toBe(2);
  });

  it("neighbors filters by relation", () => {
    seed();
    const tagged = store.neighbors("decision:a", {
      direction: "out",
      relation: "tagged",
    });
    expect(tagged.map((t) => t.node.id)).toEqual(["tag:auth"]);
  });

  it("dependents() returns incoming nodes (callers)", () => {
    seed();
    const d = store.dependents("decision:a");
    const ids = d.map((x) => x.node.id).sort();
    expect(ids).toEqual(["decision:b", "pattern:p"]);
  });

  it("dependencies() returns outgoing nodes (targets)", () => {
    seed();
    const d = store.dependencies("decision:b");
    expect(d.map((x) => x.node.id)).toEqual(["decision:a"]);
  });

  it("paths returns shortest path through the graph", () => {
    seed();
    const ps = store.paths("decision:c", "decision:a", 4);
    expect(ps.length).toBeGreaterThan(0);
    expect(ps[0]).toEqual([
      { src: "decision:c", dst: "decision:b", relation: "supersedes" },
      { src: "decision:b", dst: "decision:a", relation: "supersedes" },
    ]);
  });

  it("paths respects maxDepth", () => {
    seed();
    const ps = store.paths("decision:c", "decision:a", 1);
    expect(ps).toEqual([]);
  });

  it("stats reports node and edge counts by type/relation and orphans", () => {
    seed();
    store.upsertNode({ id: "orphan:x", type: "tag", label: "orphan" });
    const s = store.stats();
    expect(s.nodes).toBe(7);
    expect(s.byNodeType["decision"]).toBe(3);
    expect(s.byRelation["supersedes"]).toBe(2);
    expect(s.orphanNodes).toBe(1);
  });

  it("rebuild clears all data", () => {
    seed();
    store.rebuild();
    expect(store.listNodes()).toHaveLength(0);
    expect(store.listEdges()).toHaveLength(0);
  });

  it("recovers from a corrupt index file", () => {
    store.close();
    fs.writeFileSync(dbPath, "garbage");
    const fresh = new GraphStore(dbPath);
    fresh.upsertNode({ id: "after", type: "decision", label: "After" });
    expect(fresh.getNode("after")?.label).toBe("After");
    fresh.close();
  });
});
