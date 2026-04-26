import Database, { type Database as DB } from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type {
  KnowledgeEntry,
  KnowledgeType,
  RecallHit,
  Confidence,
} from "../types/shared.js";

export interface SearchOptions {
  type?: KnowledgeType;
  k?: number;
  tier?: "fts" | "hybrid";
  includeArchived?: boolean;
}

export interface StoreStats {
  total: number;
  byType: Record<KnowledgeType, number>;
}

interface EntryRow {
  id: string;
  type: KnowledgeType;
  title: string;
  path: string;
  body: string;
  applies_to: string;
  confidence: Confidence;
  created: string;
  last_validated: string;
  supersedes_json: string;
  tags_json: string;
  archived: number;
  mtime_ms: number;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entries (
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT NOT NULL,
  applies_to TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created TEXT NOT NULL,
  last_validated TEXT NOT NULL,
  supersedes_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (type, id)
);

CREATE INDEX IF NOT EXISTS idx_entries_path ON entries(path);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  title,
  body,
  tags,
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS entries_fts_map (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  UNIQUE (type, id)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const SCHEMA_VERSION = "1";

export class KnowledgeStore {
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

  upsert(entry: KnowledgeEntry, mtimeMs = 0): void {
    const fm = entry.frontmatter;
    const archived = (fm as unknown as { archived?: boolean }).archived === true ? 1 : 0;
    const supersedes = JSON.stringify(fm.supersedes ?? []);
    const tags = JSON.stringify(fm.tags ?? []);

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO entries (id, type, title, path, body, applies_to, confidence, created, last_validated, supersedes_json, tags_json, archived, mtime_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(type, id) DO UPDATE SET
             title=excluded.title,
             path=excluded.path,
             body=excluded.body,
             applies_to=excluded.applies_to,
             confidence=excluded.confidence,
             created=excluded.created,
             last_validated=excluded.last_validated,
             supersedes_json=excluded.supersedes_json,
             tags_json=excluded.tags_json,
             archived=excluded.archived,
             mtime_ms=excluded.mtime_ms`,
        )
        .run(
          fm.id,
          fm.type,
          fm.title,
          entry.path,
          entry.body,
          fm.applies_to,
          fm.confidence,
          fm.created,
          fm.last_validated,
          supersedes,
          tags,
          archived,
          mtimeMs,
        );

      const mapRow = this.db
        .prepare("SELECT rowid FROM entries_fts_map WHERE type = ? AND id = ?")
        .get(fm.type, fm.id) as { rowid: number } | undefined;

      const tagsText = (fm.tags ?? []).join(" ");
      if (mapRow) {
        this.db
          .prepare(
            `UPDATE entries_fts SET title = ?, body = ?, tags = ? WHERE rowid = ?`,
          )
          .run(fm.title, entry.body, tagsText, mapRow.rowid);
      } else {
        const info = this.db
          .prepare("INSERT INTO entries_fts_map (type, id) VALUES (?, ?)")
          .run(fm.type, fm.id);
        this.db
          .prepare(
            `INSERT INTO entries_fts (rowid, title, body, tags) VALUES (?, ?, ?, ?)`,
          )
          .run(info.lastInsertRowid, fm.title, entry.body, tagsText);
      }
    });
    tx();
  }

  delete(type: KnowledgeType, id: string): void {
    const tx = this.db.transaction(() => {
      const mapRow = this.db
        .prepare("SELECT rowid FROM entries_fts_map WHERE type = ? AND id = ?")
        .get(type, id) as { rowid: number } | undefined;
      if (mapRow) {
        this.db.prepare("DELETE FROM entries_fts WHERE rowid = ?").run(mapRow.rowid);
        this.db.prepare("DELETE FROM entries_fts_map WHERE rowid = ?").run(mapRow.rowid);
      }
      this.db.prepare("DELETE FROM entries WHERE type = ? AND id = ?").run(type, id);
    });
    tx();
  }

  get(type: KnowledgeType, id: string): KnowledgeEntry | null {
    const row = this.db
      .prepare("SELECT * FROM entries WHERE type = ? AND id = ?")
      .get(type, id) as EntryRow | undefined;
    if (!row) return null;
    return rowToEntry(row);
  }

  getById(id: string): KnowledgeEntry | null {
    const row = this.db
      .prepare("SELECT * FROM entries WHERE id = ? ORDER BY archived ASC LIMIT 1")
      .get(id) as EntryRow | undefined;
    if (!row) return null;
    return rowToEntry(row);
  }

  listAll(): Array<{ type: KnowledgeType; id: string; path: string; mtime_ms: number }> {
    return this.db
      .prepare("SELECT type, id, path, mtime_ms FROM entries")
      .all() as Array<{ type: KnowledgeType; id: string; path: string; mtime_ms: number }>;
  }

  search(query: string, opts: SearchOptions = {}): RecallHit[] {
    const k = opts.k ?? 5;
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const ftsQuery = sanitizeFtsQuery(trimmed);
    if (ftsQuery.length === 0) return [];

    const params: unknown[] = [ftsQuery];
    const filters: string[] = [];
    if (opts.type) {
      filters.push("e.type = ?");
      params.push(opts.type);
    }
    if (!opts.includeArchived) {
      filters.push("e.archived = 0");
    }
    if (opts.tier && opts.tier !== "fts") {
      // Phase 1 only implements FTS; hybrid silently degrades.
    }
    const where = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

    const sql = `
      SELECT
        e.id AS id,
        e.type AS type,
        e.title AS title,
        e.path AS path,
        e.body AS body,
        e.confidence AS confidence,
        e.last_validated AS last_validated,
        bm25(entries_fts) AS score
      FROM entries_fts
      JOIN entries_fts_map m ON m.rowid = entries_fts.rowid
      JOIN entries e ON e.type = m.type AND e.id = m.id
      WHERE entries_fts MATCH ?
        ${where}
      ORDER BY score ASC
      LIMIT ?
    `;
    params.push(k);

    let rows: Array<{
      id: string;
      type: KnowledgeType;
      title: string;
      path: string;
      body: string;
      confidence: Confidence;
      last_validated: string;
      score: number;
    }>;
    try {
      rows = this.db.prepare(sql).all(...params) as typeof rows;
    } catch {
      return [];
    }

    return rows.map((r, i) => ({
      entry_id: r.id,
      entry_type: r.type,
      title: r.title,
      path: r.path,
      excerpt: makeExcerpt(r.body, trimmed),
      score: -r.score,
      rank: i + 1,
      tier: "fts",
      last_validated: r.last_validated,
      confidence: r.confidence,
    }));
  }

  stats(): StoreStats {
    const totalRow = this.db
      .prepare("SELECT COUNT(*) AS c FROM entries WHERE archived = 0")
      .get() as { c: number };
    const rows = this.db
      .prepare(
        "SELECT type, COUNT(*) AS c FROM entries WHERE archived = 0 GROUP BY type",
      )
      .all() as Array<{ type: KnowledgeType; c: number }>;
    const byType: Record<KnowledgeType, number> = {
      decision: 0,
      pattern: 0,
      gotcha: 0,
      convention: 0,
    };
    for (const r of rows) byType[r.type] = r.c;
    return { total: totalRow.c, byType };
  }

  /** Drop all data and rebuild empty tables. Used on corrupt index recovery. */
  rebuild(): void {
    this.db.exec(`
      DROP TABLE IF EXISTS entries_fts;
      DROP TABLE IF EXISTS entries_fts_map;
      DROP TABLE IF EXISTS entries;
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

function openOrRebuild(dbPath: string): DB {
  try {
    const db = new Database(dbPath);
    // Touch to verify integrity.
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

function rowToEntry(row: EntryRow): KnowledgeEntry {
  let supersedes: string[] = [];
  let tags: string[] = [];
  try {
    supersedes = JSON.parse(row.supersedes_json);
  } catch {
    /* default */
  }
  try {
    tags = JSON.parse(row.tags_json);
  } catch {
    /* default */
  }
  return {
    frontmatter: {
      id: row.id,
      type: row.type,
      title: row.title,
      applies_to: row.applies_to as "user" | "team" | "all",
      confidence: row.confidence,
      sources: [],
      created: row.created,
      last_validated: row.last_validated,
      supersedes,
      tags,
    },
    body: row.body,
    path: row.path,
  };
}

function sanitizeFtsQuery(q: string): string {
  // Tokenize on non-word characters, drop FTS5 syntax characters, then join with OR by space.
  const tokens = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 64);
  if (tokens.length === 0) return "";
  // Quote each token to defang FTS operator characters; allow prefix match.
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");
}

function makeExcerpt(body: string, query: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";
  const lc = flat.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((t) => t.length > 1);
  let bestIdx = -1;
  for (const t of terms) {
    const idx = lc.indexOf(t);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
  }
  const start = bestIdx === -1 ? 0 : Math.max(0, bestIdx - 20);
  const end = Math.min(flat.length, start + 160);
  const slice = flat.slice(start, end);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < flat.length ? "..." : "";
  return `${prefix}${slice}${suffix}`;
}
