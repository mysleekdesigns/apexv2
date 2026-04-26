import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { CodeIndexStore } from "../../src/codeindex/store.js";
import type { ExtractedSymbol } from "../../src/codeindex/extract.js";

function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-codeindex-store-"));
  return path.join(dir, "symbols.sqlite");
}

function sym(partial: Partial<ExtractedSymbol> & { symbol: string }): ExtractedSymbol {
  return {
    symbol: partial.symbol,
    kind: partial.kind ?? "function",
    file: partial.file ?? "src/a.ts",
    line: partial.line ?? 1,
    end_line: partial.end_line ?? 1,
    exported: partial.exported ?? true,
    language: partial.language ?? "ts",
  };
}

describe("CodeIndexStore", () => {
  let dbPath: string;
  let store: CodeIndexStore;

  beforeEach(() => {
    dbPath = tmpDb();
    store = new CodeIndexStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("upserts and finds symbols by name", () => {
    store.upsertFile("src/auth/handler.ts", 1000, [
      sym({ symbol: "authHandler", kind: "function", file: "src/auth/handler.ts" }),
      sym({ symbol: "AuthService", kind: "class", file: "src/auth/handler.ts", line: 10 }),
    ]);
    const hits = store.searchSymbol("auth", { k: 5 });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.map((h) => h.symbol).sort()).toEqual(["AuthService", "authHandler"]);
  });

  it("filters by kind and exported", () => {
    store.upsertFile("a.ts", 1000, [
      sym({ symbol: "Foo", kind: "class", exported: true }),
      sym({ symbol: "foo", kind: "function", exported: false }),
    ]);
    const classes = store.searchSymbol("foo", { kind: "class" });
    expect(classes.map((h) => h.symbol)).toEqual(["Foo"]);
    const exportedOnly = store.searchSymbol("foo", { exported: true });
    expect(exportedOnly.map((h) => h.symbol)).toEqual(["Foo"]);
  });

  it("replaces symbols on re-upsert and removes old ones", () => {
    store.upsertFile("a.ts", 1000, [sym({ symbol: "alpha", file: "a.ts" })]);
    store.upsertFile("a.ts", 2000, [sym({ symbol: "beta", file: "a.ts" })]);
    expect(store.searchSymbol("alpha").length).toBe(0);
    expect(store.searchSymbol("beta").length).toBe(1);
  });

  it("deleteFile removes symbols and file row", () => {
    store.upsertFile("a.ts", 1000, [sym({ symbol: "alpha", file: "a.ts" })]);
    store.deleteFile("a.ts");
    expect(store.searchSymbol("alpha").length).toBe(0);
    expect(store.getFileMtime("a.ts")).toBeNull();
  });

  it("searchByPath returns symbols whose file path matches the substring", () => {
    store.upsertFile("src/auth/handler.ts", 1000, [
      sym({ symbol: "doStuff", file: "src/auth/handler.ts" }),
    ]);
    store.upsertFile("src/users/list.ts", 1000, [
      sym({ symbol: "listUsers", file: "src/users/list.ts" }),
    ]);
    const hits = store.searchByPath("auth");
    expect(hits.map((h) => h.symbol)).toEqual(["doStuff"]);
  });

  it("stats counts files, symbols and languages", () => {
    store.upsertFile("a.ts", 1000, [sym({ symbol: "a", language: "ts" })]);
    store.upsertFile("b.py", 1000, [
      sym({ symbol: "b", language: "py" }),
      sym({ symbol: "c", language: "py" }),
    ]);
    const stats = store.stats();
    expect(stats.totalFiles).toBe(2);
    expect(stats.totalSymbols).toBe(3);
    expect(stats.byLanguage.ts).toBe(1);
    expect(stats.byLanguage.py).toBe(2);
  });

  it("survives empty queries", () => {
    expect(store.searchSymbol("")).toEqual([]);
    expect(store.searchSymbol("   ")).toEqual([]);
    expect(store.searchByPath("")).toEqual([]);
  });

  it("setSyncedAt and getSyncedAt round-trip", () => {
    expect(store.getSyncedAt()).toBeNull();
    store.setSyncedAt("2026-04-26T12:00:00Z");
    expect(store.getSyncedAt()).toBe("2026-04-26T12:00:00Z");
  });
});
