import Database, { type Database as DB } from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { CodeLanguage } from "./parsers.js";
import type { SymbolKind, ExtractedSymbol } from "./extract.js";

export interface SymbolHit {
  symbol: string;
  kind: SymbolKind;
  file: string;
  line: number;
  end_line: number;
  exported: boolean;
  language: CodeLanguage;
  score: number;
}

export interface SymbolSearchOptions {
  k?: number;
  kind?: SymbolKind;
  exported?: boolean;
}

export interface CodeIndexStats {
  totalFiles: number;
  totalSymbols: number;
  byLanguage: Record<CodeLanguage, number>;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
  file TEXT PRIMARY KEY,
  mtime_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  exported INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  name,
  kind,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const SCHEMA_VERSION = "1";

interface SymbolRow {
  id: number;
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  end_line: number;
  exported: number;
  language: CodeLanguage;
  mtime_ms: number;
}

export class CodeIndexStore {
  private readonly db: DB;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = openOrRebuild(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(SCHEMA_SQL);
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get("schema_version") as { value: string } | undefined;
    if (!row) {
      this.db
        .prepare("INSERT INTO meta(key, value) VALUES (?, ?)")
        .run("schema_version", SCHEMA_VERSION);
    } else if (row.value !== SCHEMA_VERSION) {
      this.rebuild();
    }
  }

  close(): void {
    this.db.close();
  }

  upsertFile(file: string, mtimeMs: number, symbols: ExtractedSymbol[]): void {
    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT id FROM symbols WHERE file = ?")
        .all(file) as Array<{ id: number }>;
      for (const r of existing) {
        this.db.prepare("DELETE FROM symbols_fts WHERE rowid = ?").run(r.id);
      }
      this.db.prepare("DELETE FROM symbols WHERE file = ?").run(file);

      this.db
        .prepare(
          "INSERT INTO files(file, mtime_ms) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET mtime_ms = excluded.mtime_ms",
        )
        .run(file, mtimeMs);

      const insertSymbol = this.db.prepare(
        `INSERT INTO symbols (name, kind, file, line, end_line, exported, language, mtime_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertFts = this.db.prepare(
        "INSERT INTO symbols_fts (rowid, name, kind) VALUES (?, ?, ?)",
      );
      for (const s of symbols) {
        const info = insertSymbol.run(
          s.symbol,
          s.kind,
          file,
          s.line,
          s.end_line,
          s.exported ? 1 : 0,
          s.language,
          mtimeMs,
        );
        insertFts.run(info.lastInsertRowid, s.symbol, s.kind);
      }
    });
    tx();
  }

  deleteFile(file: string): void {
    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT id FROM symbols WHERE file = ?")
        .all(file) as Array<{ id: number }>;
      for (const r of existing) {
        this.db.prepare("DELETE FROM symbols_fts WHERE rowid = ?").run(r.id);
      }
      this.db.prepare("DELETE FROM symbols WHERE file = ?").run(file);
      this.db.prepare("DELETE FROM files WHERE file = ?").run(file);
    });
    tx();
  }

  getFileMtime(file: string): number | null {
    const row = this.db
      .prepare("SELECT mtime_ms FROM files WHERE file = ?")
      .get(file) as { mtime_ms: number } | undefined;
    return row?.mtime_ms ?? null;
  }

  listFiles(): Array<{ file: string; mtime_ms: number }> {
    return this.db.prepare("SELECT file, mtime_ms FROM files").all() as Array<{
      file: string;
      mtime_ms: number;
    }>;
  }

  searchSymbol(query: string, opts: SymbolSearchOptions = {}): SymbolHit[] {
    const k = opts.k ?? 10;
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const ftsQuery = sanitizeFtsQuery(trimmed);
    if (ftsQuery.length === 0) return [];

    const filters: string[] = [];
    const params: unknown[] = [ftsQuery];
    if (opts.kind) {
      filters.push("s.kind = ?");
      params.push(opts.kind);
    }
    if (typeof opts.exported === "boolean") {
      filters.push("s.exported = ?");
      params.push(opts.exported ? 1 : 0);
    }
    const where = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";
    const sql = `
      SELECT s.id AS id,
             s.name AS name,
             s.kind AS kind,
             s.file AS file,
             s.line AS line,
             s.end_line AS end_line,
             s.exported AS exported,
             s.language AS language,
             s.mtime_ms AS mtime_ms,
             bm25(symbols_fts) AS score
      FROM symbols_fts
      JOIN symbols s ON s.id = symbols_fts.rowid
      WHERE symbols_fts MATCH ?
        ${where}
      ORDER BY score ASC
      LIMIT ?
    `;
    params.push(k);

    let rows: Array<SymbolRow & { score: number }>;
    try {
      rows = this.db.prepare(sql).all(...params) as typeof rows;
    } catch {
      return [];
    }
    return rows.map((r) => rowToHit(r, -r.score));
  }

  searchByPath(prefix: string, k = 10): SymbolHit[] {
    const trimmed = prefix.trim();
    if (trimmed.length === 0) return [];
    const like = `%${trimmed.toLowerCase()}%`;
    const rows = this.db
      .prepare(
        `SELECT id, name, kind, file, line, end_line, exported, language, mtime_ms
         FROM symbols
         WHERE LOWER(file) LIKE ?
         ORDER BY exported DESC, file ASC, line ASC
         LIMIT ?`,
      )
      .all(like, k) as SymbolRow[];
    return rows.map((r) => rowToHit(r, 1));
  }

  stats(): CodeIndexStats {
    const filesRow = this.db
      .prepare("SELECT COUNT(*) AS c FROM files")
      .get() as { c: number };
    const symbolsRow = this.db
      .prepare("SELECT COUNT(*) AS c FROM symbols")
      .get() as { c: number };
    const langRows = this.db
      .prepare("SELECT language, COUNT(*) AS c FROM symbols GROUP BY language")
      .all() as Array<{ language: CodeLanguage; c: number }>;
    const byLanguage: Record<CodeLanguage, number> = {
      ts: 0,
      tsx: 0,
      js: 0,
      py: 0,
    };
    for (const r of langRows) byLanguage[r.language] = r.c;
    return {
      totalFiles: filesRow.c,
      totalSymbols: symbolsRow.c,
      byLanguage,
    };
  }

  rebuild(): void {
    this.db.exec(`
      DROP TABLE IF EXISTS symbols_fts;
      DROP TABLE IF EXISTS symbols;
      DROP TABLE IF EXISTS files;
      DROP TABLE IF EXISTS meta;
    `);
    this.db.exec(SCHEMA_SQL);
    this.db
      .prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)")
      .run("schema_version", SCHEMA_VERSION);
  }

  setSyncedAt(iso: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)")
      .run("last_sync", iso);
  }

  getSyncedAt(): string | null {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get("last_sync") as { value: string } | undefined;
    return row?.value ?? null;
  }
}

function rowToHit(r: SymbolRow, score: number): SymbolHit {
  return {
    symbol: r.name,
    kind: r.kind,
    file: r.file,
    line: r.line,
    end_line: r.end_line,
    exported: r.exported === 1,
    language: r.language,
    score,
  };
}

function openOrRebuild(dbPath: string): DB {
  try {
    const db = new Database(dbPath);
    db.prepare("SELECT 1").get();
    return db;
  } catch {
    try {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    } catch {
      /* ignore */
    }
    return new Database(dbPath);
  }
}

function sanitizeFtsQuery(q: string): string {
  const tokens = q
    .split(/[^\p{L}\p{N}_]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 64);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");
}
