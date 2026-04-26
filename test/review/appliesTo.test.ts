import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import {
  filterByAudience,
  lintEntries,
  pickValidApplies,
  VALID_APPLIES_TO,
} from "../../src/review/appliesTo.js";
import type { KnowledgeEntry } from "../../src/types/shared.js";

function makeEntry(
  id: string,
  applies_to: string,
): KnowledgeEntry {
  return {
    frontmatter: {
      id,
      type: "convention",
      title: `Title for ${id}`,
      applies_to: applies_to as KnowledgeEntry["frontmatter"]["applies_to"],
      confidence: "medium",
      sources: [{ kind: "manual", ref: "manual/test" }],
      created: "2026-01-01",
      last_validated: "2026-01-02",
    },
    body: "body",
    path: `.apex/knowledge/conventions/${id}.md`,
  };
}

describe("VALID_APPLIES_TO", () => {
  it("matches the schema enum", () => {
    expect([...VALID_APPLIES_TO].sort()).toEqual(["all", "team", "user"]);
  });
});

describe("filterByAudience", () => {
  const entries = [
    makeEntry("u", "user"),
    makeEntry("t", "team"),
    makeEntry("a", "all"),
    makeEntry("bad", "garbage"),
  ];

  it("returns team + all when audience is team", () => {
    const out = filterByAudience(entries, "team").map((e) => e.frontmatter.id);
    expect(out.sort()).toEqual(["a", "t"]);
  });

  it("returns user + all when audience is user", () => {
    const out = filterByAudience(entries, "user").map((e) => e.frontmatter.id);
    expect(out.sort()).toEqual(["a", "u"]);
  });

  it("returns every valid entry when audience is all", () => {
    const out = filterByAudience(entries, "all").map((e) => e.frontmatter.id);
    expect(out.sort()).toEqual(["a", "t", "u"]);
  });

  it("drops entries with missing applies_to", () => {
    const e: { frontmatter: { applies_to?: unknown } } = { frontmatter: {} };
    const out = filterByAudience([e], "all");
    expect(out).toEqual([]);
  });

  it("drops entries with non-string applies_to", () => {
    const e: { frontmatter: { applies_to?: unknown } } = {
      frontmatter: { applies_to: 42 },
    };
    expect(filterByAudience([e], "all")).toEqual([]);
  });
});

describe("pickValidApplies", () => {
  it("keeps only well-formed applies_to entries", () => {
    const entries = [
      makeEntry("ok", "team"),
      makeEntry("nope", "garbage"),
    ];
    const out = pickValidApplies(entries);
    expect(out.map((e) => e.frontmatter.id)).toEqual(["ok"]);
  });
});

describe("lintEntries", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-applies-lint-"));
  });

  afterEach(async () => {
    await fs.remove(tmp).catch(() => {});
  });

  function writeEntry(
    type: "decisions" | "patterns" | "gotchas" | "conventions",
    id: string,
    frontmatter: Record<string, unknown>,
  ): string {
    const dir = path.join(tmp, type);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.md`);
    const lines = ["---"];
    for (const [k, v] of Object.entries(frontmatter)) {
      if (v === undefined) continue;
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
    lines.push("---");
    lines.push("");
    lines.push("body");
    fs.writeFileSync(file, lines.join("\n"));
    return file;
  }

  it("returns no warnings when every applies_to is valid", async () => {
    writeEntry("conventions", "ok", { id: "ok", applies_to: "team" });
    writeEntry("decisions", "ok2", { id: "ok2", applies_to: "all" });
    const w = await lintEntries(tmp);
    expect(w).toEqual([]);
  });

  it("warns on missing applies_to", async () => {
    const fp = writeEntry("conventions", "miss", { id: "miss" });
    const w = await lintEntries(tmp);
    expect(w).toHaveLength(1);
    expect(w[0]!.kind).toBe("missing");
    expect(w[0]!.id).toBe("miss");
    expect(w[0]!.path).toBe(fp);
  });

  it("warns on invalid applies_to value", async () => {
    writeEntry("patterns", "bad", { id: "bad", applies_to: "everyone" });
    const w = await lintEntries(tmp);
    expect(w).toHaveLength(1);
    expect(w[0]!.kind).toBe("invalid");
    expect(w[0]!.value).toBe("everyone");
  });

  it("skips files starting with underscore", async () => {
    writeEntry("conventions", "_pending", { id: "_pending" });
    const w = await lintEntries(tmp);
    expect(w).toEqual([]);
  });

  it("emits unparseable warning instead of throwing on bad YAML", async () => {
    const dir = path.join(tmp, "gotchas");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "broken.md"),
      "---\nthis: is: not: valid: yaml: [\n---\n",
    );
    const w = await lintEntries(tmp);
    expect(w).toHaveLength(1);
    expect(w[0]!.kind).toBe("unparseable");
  });

  it("returns warnings sorted by path", async () => {
    writeEntry("decisions", "z-bad", { id: "z-bad", applies_to: "x" });
    writeEntry("conventions", "a-bad", { id: "a-bad", applies_to: "y" });
    const w = await lintEntries(tmp);
    const paths = w.map((x) => x.path);
    expect(paths).toEqual([...paths].sort());
  });

  it("silently skips missing subdirs", async () => {
    // tmp exists but contains no knowledge subdirs.
    const w = await lintEntries(tmp);
    expect(w).toEqual([]);
  });
});
