import { describe, it, expect } from "vitest";
import { buildGraph } from "../../src/graph/builder.js";
import type { KnowledgeEntry } from "../../src/types/shared.js";

function entry(
  partial: Partial<KnowledgeEntry["frontmatter"]> & {
    id: string;
    type: KnowledgeEntry["frontmatter"]["type"];
    title: string;
  },
  body = "",
  extraFm: Record<string, unknown> = {},
): KnowledgeEntry {
  const fm: KnowledgeEntry["frontmatter"] = {
    id: partial.id,
    type: partial.type,
    title: partial.title,
    applies_to: partial.applies_to ?? "all",
    confidence: partial.confidence ?? "high",
    sources: partial.sources ?? [{ kind: "manual", ref: "manual/test" }],
    created: partial.created ?? "2026-01-01",
    last_validated: partial.last_validated ?? "2026-04-26",
    supersedes: partial.supersedes ?? [],
    tags: partial.tags ?? [],
  };
  return {
    frontmatter: { ...fm, ...extraFm } as KnowledgeEntry["frontmatter"],
    body,
    path: `.apex/knowledge/${partial.type}s/${partial.id}.md`,
  };
}

describe("buildGraph — node creation", () => {
  it("creates one node per knowledge entry with type:id form", () => {
    const entries = [
      entry({ id: "auth-rotation", type: "decision", title: "Rotate JWT" }),
      entry({ id: "use-pnpm", type: "convention", title: "Use pnpm" }),
    ];
    const { nodes } = buildGraph(entries);
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toContain("decision:auth-rotation");
    expect(ids).toContain("convention:use-pnpm");
  });

  it("attaches label, confidence and last_validated to entry nodes", () => {
    const entries = [
      entry(
        {
          id: "x",
          type: "pattern",
          title: "Pattern X",
          confidence: "medium",
          last_validated: "2026-04-15",
        },
        "",
      ),
    ];
    const { nodes } = buildGraph(entries);
    const x = nodes.find((n) => n.id === "pattern:x");
    expect(x?.label).toBe("Pattern X");
    expect(x?.confidence).toBe("medium");
    expect(x?.last_validated).toBe("2026-04-15");
  });
});

describe("buildGraph — supersedes edges", () => {
  it("creates supersedes edges with cross-entry type lookup", () => {
    const entries = [
      entry({ id: "old", type: "decision", title: "Old" }),
      entry({ id: "new", type: "decision", title: "New", supersedes: ["old"] }),
    ];
    const { edges } = buildGraph(entries);
    const sup = edges.find(
      (e) => e.relation === "supersedes" && e.src === "decision:new",
    );
    expect(sup?.dst).toBe("decision:old");
  });

  it("falls back to unknown:<id> when target not in entries", () => {
    const entries = [
      entry({
        id: "new",
        type: "decision",
        title: "New",
        supersedes: ["never-existed"],
      }),
    ];
    const { nodes, edges } = buildGraph(entries);
    expect(nodes.find((n) => n.id === "unknown:never-existed")).toBeDefined();
    const sup = edges.find((e) => e.relation === "supersedes");
    expect(sup?.dst).toBe("unknown:never-existed");
  });
});

describe("buildGraph — tags", () => {
  it("creates tag nodes and tagged edges", () => {
    const entries = [
      entry({
        id: "p",
        type: "pattern",
        title: "P",
        tags: ["security", "auth"],
      }),
    ];
    const { nodes, edges } = buildGraph(entries);
    expect(nodes.find((n) => n.id === "tag:security")?.type).toBe("tag");
    expect(nodes.find((n) => n.id === "tag:auth")?.type).toBe("tag");
    expect(
      edges.filter(
        (e) => e.relation === "tagged" && e.src === "pattern:p",
      ).length,
    ).toBe(2);
  });
});

describe("buildGraph — affects (decision)", () => {
  it("creates file nodes and affects edges from decision.affects", () => {
    const entries = [
      entry(
        { id: "auth", type: "decision", title: "Auth decision" },
        "",
        { affects: ["apps/api/jobs/rotate.ts", "apps/api/src/auth/keys.ts"] },
      ),
    ];
    const { nodes, edges } = buildGraph(entries);
    expect(nodes.find((n) => n.id === "file:apps/api/jobs/rotate.ts")?.type).toBe("file");
    const affects = edges.filter(
      (e) => e.relation === "affects" && e.src === "decision:auth",
    );
    expect(affects.length).toBe(2);
  });
});

describe("buildGraph — applies-to (gotcha)", () => {
  it("creates file or symbol targets from gotcha.affects", () => {
    const entries = [
      entry(
        { id: "g1", type: "gotcha", title: "Gotcha 1" },
        "",
        {
          symptom: "x",
          resolution: "y",
          affects: ["apps/api/src/users.ts", "file/apps/api/src/users.ts:14"],
        },
      ),
    ];
    const { nodes, edges } = buildGraph(entries);
    expect(nodes.find((n) => n.id === "file:apps/api/src/users.ts")).toBeDefined();
    const sym = nodes.find((n) => n.id === "symbol:apps/api/src/users.ts:14");
    expect(sym?.type).toBe("symbol");
    const ats = edges.filter(
      (e) => e.relation === "applies-to" && e.src === "gotcha:g1",
    );
    expect(ats.length).toBe(2);
  });
});

describe("buildGraph — references (pattern)", () => {
  it("extracts wiki refs and explicit references list", () => {
    const entries = [
      entry({ id: "auth-rotation", type: "decision", title: "Auth" }),
      entry(
        { id: "p1", type: "pattern", title: "P1" },
        "See [[auth-rotation]] and [[other-id]] for context.",
      ),
      entry(
        { id: "p2", type: "pattern", title: "P2" },
        "",
        { references: ["auth-rotation"] },
      ),
    ];
    const { edges } = buildGraph(entries);
    const p1Refs = edges.filter(
      (e) => e.relation === "references" && e.src === "pattern:p1",
    );
    const dsts = p1Refs.map((e) => e.dst).sort();
    expect(dsts).toEqual(["decision:auth-rotation", "unknown:other-id"]);
    const p2Refs = edges.filter(
      (e) => e.relation === "references" && e.src === "pattern:p2",
    );
    expect(p2Refs[0]?.dst).toBe("decision:auth-rotation");
  });

  it("does not create a self-reference", () => {
    const entries = [
      entry({ id: "self", type: "pattern", title: "Self" }, "look at [[self]]"),
    ];
    const { edges } = buildGraph(entries);
    expect(edges.filter((e) => e.relation === "references")).toHaveLength(0);
  });
});

describe("buildGraph — dedup", () => {
  it("does not produce duplicate edges or nodes", () => {
    const entries = [
      entry(
        { id: "p", type: "pattern", title: "P", tags: ["a", "a", "b"] },
        "[[x]] [[x]]",
      ),
      entry({ id: "x", type: "decision", title: "X" }),
    ];
    const { nodes, edges } = buildGraph(entries);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    expect(
      new Set(edges.map((e) => `${e.src}|${e.relation}|${e.dst}`)).size,
    ).toBe(edges.length);
  });
});
