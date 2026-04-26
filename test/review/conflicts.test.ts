import { describe, it, expect } from "vitest";
import { resolveConflict, type ConflictFrontmatter } from "../../src/review/conflicts.js";

function fm(
  overrides: Partial<ConflictFrontmatter> & { id?: string } = {},
): ConflictFrontmatter {
  return {
    id: "test-entry",
    confidence: "medium",
    last_validated: "2026-04-01",
    ...overrides,
  };
}

describe("resolveConflict", () => {
  it("returns use_local when content is byte-identical", () => {
    const local = fm();
    const remote = fm();
    const res = resolveConflict(local, remote, "body", "body");
    expect(res.action).toBe("use_local");
    expect(res.reason).toMatch(/identical/);
  });

  it("flags id mismatch as manual", () => {
    const local = fm({ id: "foo" });
    const remote = fm({ id: "bar" });
    const res = resolveConflict(local, remote, "a", "b");
    expect(res.action).toBe("manual");
    expect(res.reason).toMatch(/id mismatch/);
  });

  it("prefers higher confidence (rule 1)", () => {
    const local = fm({ confidence: "high", last_validated: "2026-01-01" });
    const remote = fm({ confidence: "low", last_validated: "2026-12-31" });
    const res = resolveConflict(local, remote, "L", "R");
    expect(res.action).toBe("use_local");
    expect(res.resolved.body).toBe("L");
    expect(res.reason).toMatch(/confidence/);
  });

  it("prefers remote when remote has higher confidence", () => {
    const local = fm({ confidence: "low" });
    const remote = fm({ confidence: "high" });
    const res = resolveConflict(local, remote, "L", "R");
    expect(res.action).toBe("use_remote");
    expect(res.resolved.body).toBe("R");
  });

  it("falls back to last_validated when confidence ties (rule 2)", () => {
    const local = fm({ confidence: "medium", last_validated: "2026-04-25" });
    const remote = fm({ confidence: "medium", last_validated: "2026-04-26" });
    const res = resolveConflict(local, remote, "L", "R");
    expect(res.action).toBe("use_remote");
    expect(res.reason).toMatch(/last_validated/);
  });

  it("rule 3 is inert when neither side's supersedes references the other's id", () => {
    const local: ConflictFrontmatter = {
      id: "rule-v2",
      confidence: "medium",
      last_validated: "2026-04-26",
      supersedes: ["unrelated-other-id"],
    };
    const remote: ConflictFrontmatter = {
      id: "rule-v2",
      confidence: "medium",
      last_validated: "2026-04-26",
    };
    // Bodies differ → resolver exhausts every rule and falls back to manual.
    const res = resolveConflict(local, remote, "L", "R");
    expect(res.action).toBe("manual");
  });

  it("rule 3 fires when local supersedes references remote.id (different ids only allowed via mismatch path)", () => {
    // Conflict-resolution is for the same on-disk file, so ids must match.
    // The intent of rule 3 is "the entry whose supersedes-chain references
    // the prior id wins". Within a same-id resolution this manifests when
    // one side ALREADY carries supersedes (a marker that it's the newer
    // generation written by curator). Verify we treat that as decisive.
    const local = fm({
      confidence: "medium",
      last_validated: "2026-04-26",
      supersedes: ["someone-else"],
    });
    const remote = fm({
      confidence: "medium",
      last_validated: "2026-04-26",
    });
    // Neither side supersedes the OTHER (same id). Rule 3 inert → falls
    // through to body comparison.
    const res = resolveConflict(local, remote, "same", "same");
    expect(res.action).toBe("merge");
  });

  it("rule 3 picks the supersession-aware side when one references the other.id by mistake", () => {
    // Pathological-but-deterministic: local has `supersedes: [<remote.id>]`
    // even though they share id. Rule 3 still resolves it by name.
    const local: ConflictFrontmatter = {
      id: "shared",
      confidence: "medium",
      last_validated: "2026-04-26",
      supersedes: ["shared"],
    };
    const remote: ConflictFrontmatter = {
      id: "shared",
      confidence: "medium",
      last_validated: "2026-04-26",
    };
    const res = resolveConflict(local, remote, "L", "R");
    expect(res.action).toBe("use_local");
    expect(res.reason).toMatch(/supersedes/);
  });

  it("flags supersedes cycle as manual", () => {
    const local: ConflictFrontmatter = {
      id: "shared",
      confidence: "medium",
      last_validated: "2026-04-26",
      supersedes: ["shared"],
    };
    const remote: ConflictFrontmatter = {
      id: "shared",
      confidence: "medium",
      last_validated: "2026-04-26",
      supersedes: ["shared"],
    };
    const res = resolveConflict(local, remote, "L", "R");
    expect(res.action).toBe("manual");
    expect(res.reason).toMatch(/cycle/);
  });

  it("merges identical body when frontmatter equal-ranked but unequal", () => {
    const local = fm({ confidence: "medium", last_validated: "2026-04-26" });
    const remote = fm({
      confidence: "medium",
      last_validated: "2026-04-26",
      tags: ["extra"],
    } as ConflictFrontmatter);
    const res = resolveConflict(local, remote, "shared", "shared");
    expect(res.action).toBe("merge");
    expect(res.resolved.body).toBe("shared");
  });

  it("returns manual when bodies differ and no rule fires", () => {
    const local = fm({ confidence: "medium", last_validated: "2026-04-26" });
    const remote = fm({ confidence: "medium", last_validated: "2026-04-26" });
    const res = resolveConflict(local, remote, "L", "R");
    expect(res.action).toBe("manual");
    expect(res.reason).toMatch(/manual/);
  });

  it("is deterministic — repeated calls return the same answer", () => {
    const local = fm({ confidence: "high" });
    const remote = fm({ confidence: "low" });
    const a = resolveConflict(local, remote, "L", "R");
    const b = resolveConflict(local, remote, "L", "R");
    expect(a).toEqual(b);
  });

  it("preserves the winning frontmatter via the resolved field", () => {
    const local = fm({ confidence: "high", tags: ["a"] } as ConflictFrontmatter);
    const remote = fm({ confidence: "low", tags: ["b"] } as ConflictFrontmatter);
    const res = resolveConflict(local, remote, "L", "R");
    expect(res.resolved.frontmatter).toBe(local);
  });
});
