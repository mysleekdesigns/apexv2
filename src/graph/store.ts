import Database, { type Database as DB } from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export type GraphNodeType =
  | "decision"
  | "pattern"
  | "gotcha"
  | "convention"
  | "file"
  | "symbol"
  | "tag"
  | "unknown";

export type GraphRelation =
  | "supersedes"
  | "applies-to"
  | "references"
  | "tagged"
  | "affects";

export type GraphDirection = "out" | "in" | "both";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  props?: Record<string, unknown>;
  last_validated?: string | null;
  confidence?: string | null;
}

export interface GraphEdge {
  src: string;
  dst: string;
  relation: GraphRelation;
  weight?: number;
  props?: Record<string, unknown>;
}

export interface NeighborOptions {
  relation?: GraphRelation;
  direction?: GraphDirection;
  maxDepth?: 1 | 2 | 3;
}

export interface NeighborResult {
  node: GraphNode;
  relation: GraphRelation;
  depth: number;
}

export interface PathStep {
  src: string;
  dst: string;
  relation: GraphRelation;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  byNodeType: Record<string, number>;
  byRelation: Record<string, number>;
  orphanNodes: number;
}

interface NodeRow {
  id: string;
  type: GraphNodeType;
  label: string;
  props_json: string;
  last_validated: string | null;
  confidence: string | null;
}

interface EdgeRow {
  src: string;
  dst: string;
  relation: GraphRelation;
  weight: number;
  props_json: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  props_json TEXT NOT NULL DEFAULT '{}',
  last_validated TEXT,
  confidence TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  props_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (src, dst, relation)
);

CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
CREATE INDEX IF NOT EXISTS idx_edges_rel ON edges(relation);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const SCHEMA_VERSION = "1";

export class GraphStore {
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

  upsertNode(node: GraphNode): void {
    const props = JSON.stringify(node.props ?? {});
    this.db
      .prepare(
        `INSERT INTO nodes (id, type, label, props_json, last_validated, confidence)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type=excluded.type,
           label=excluded.label,
           props_json=excluded.props_json,
           last_validated=excluded.last_validated,
           confidence=excluded.confidence`,
      )
      .run(
        node.id,
        node.type,
        node.label,
        props,
        node.last_validated ?? null,
        node.confidence ?? null,
      );
  }

  deleteNode(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").run(id, id);
      this.db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
    });
    tx();
  }

  getNode(id: string): GraphNode | null {
    const row = this.db
      .prepare("SELECT * FROM nodes WHERE id = ?")
      .get(id) as NodeRow | undefined;
    if (!row) return null;
    return rowToNode(row);
  }

  upsertEdge(edge: GraphEdge): void {
    const props = JSON.stringify(edge.props ?? {});
    const weight = edge.weight ?? 1.0;
    this.db
      .prepare(
        `INSERT INTO edges (src, dst, relation, weight, props_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(src, dst, relation) DO UPDATE SET
           weight=excluded.weight,
           props_json=excluded.props_json`,
      )
      .run(edge.src, edge.dst, edge.relation, weight, props);
  }

  deleteEdgesFrom(src: string): void {
    this.db.prepare("DELETE FROM edges WHERE src = ?").run(src);
  }

  listNodes(): GraphNode[] {
    const rows = this.db.prepare("SELECT * FROM nodes").all() as NodeRow[];
    return rows.map(rowToNode);
  }

  listEdges(): GraphEdge[] {
    const rows = this.db.prepare("SELECT * FROM edges").all() as EdgeRow[];
    return rows.map(rowToEdge);
  }

  neighbors(id: string, opts: NeighborOptions = {}): NeighborResult[] {
    const direction = opts.direction ?? "out";
    const maxDepth = opts.maxDepth ?? 1;
    const visited = new Set<string>([id]);
    const results: NeighborResult[] = [];
    let frontier: string[] = [id];

    for (let depth = 1; depth <= maxDepth; depth++) {
      const nextFrontier: string[] = [];
      for (const cur of frontier) {
        const edges = this.edgesFrom(cur, direction, opts.relation);
        for (const e of edges) {
          const other = e.src === cur ? e.dst : e.src;
          if (visited.has(other)) continue;
          visited.add(other);
          const node = this.getNode(other);
          if (!node) continue;
          results.push({ node, relation: e.relation, depth });
          nextFrontier.push(other);
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }
    return results;
  }

  dependents(id: string, opts: NeighborOptions = {}): NeighborResult[] {
    return this.neighbors(id, { ...opts, direction: "in" });
  }

  dependencies(id: string, opts: NeighborOptions = {}): NeighborResult[] {
    return this.neighbors(id, { ...opts, direction: "out" });
  }

  paths(srcId: string, dstId: string, maxDepth: number): PathStep[][] {
    if (srcId === dstId) return [[]];
    const queue: Array<{ node: string; path: PathStep[] }> = [
      { node: srcId, path: [] },
    ];
    const found: PathStep[][] = [];
    let shortest = Infinity;
    const seenAtDepth = new Map<string, number>();
    seenAtDepth.set(srcId, 0);

    while (queue.length > 0) {
      const cur = queue.shift();
      if (!cur) break;
      if (cur.path.length >= maxDepth) continue;
      if (cur.path.length >= shortest) continue;
      const edges = this.edgesFrom(cur.node, "out");
      for (const e of edges) {
        const next = e.dst;
        const newPath = [
          ...cur.path,
          { src: e.src, dst: e.dst, relation: e.relation },
        ];
        if (next === dstId) {
          if (newPath.length < shortest) {
            shortest = newPath.length;
            found.length = 0;
            found.push(newPath);
          } else if (newPath.length === shortest) {
            found.push(newPath);
          }
          continue;
        }
        const prev = seenAtDepth.get(next);
        if (prev !== undefined && prev <= newPath.length) continue;
        seenAtDepth.set(next, newPath.length);
        queue.push({ node: next, path: newPath });
      }
    }
    return found;
  }

  stats(): GraphStats {
    const nodeCount = (
      this.db.prepare("SELECT COUNT(*) AS c FROM nodes").get() as { c: number }
    ).c;
    const edgeCount = (
      this.db.prepare("SELECT COUNT(*) AS c FROM edges").get() as { c: number }
    ).c;
    const byNodeRows = this.db
      .prepare("SELECT type, COUNT(*) AS c FROM nodes GROUP BY type")
      .all() as Array<{ type: string; c: number }>;
    const byRelationRows = this.db
      .prepare("SELECT relation, COUNT(*) AS c FROM edges GROUP BY relation")
      .all() as Array<{ relation: string; c: number }>;
    const byNodeType: Record<string, number> = {};
    for (const r of byNodeRows) byNodeType[r.type] = r.c;
    const byRelation: Record<string, number> = {};
    for (const r of byRelationRows) byRelation[r.relation] = r.c;
    const orphanRow = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM nodes n
         WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.src = n.id OR e.dst = n.id)`,
      )
      .get() as { c: number };
    return {
      nodes: nodeCount,
      edges: edgeCount,
      byNodeType,
      byRelation,
      orphanNodes: orphanRow.c,
    };
  }

  rebuild(): void {
    this.db.exec(`
      DROP TABLE IF EXISTS edges;
      DROP TABLE IF EXISTS nodes;
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

  /** Run multiple writes atomically. */
  transaction(fn: () => void): void {
    const tx = this.db.transaction(fn);
    tx();
  }

  private edgesFrom(
    node: string,
    direction: GraphDirection,
    relation?: GraphRelation,
  ): EdgeRow[] {
    const relClause = relation ? "AND relation = ?" : "";
    const params: unknown[] = [];
    let sql: string;
    if (direction === "out") {
      sql = `SELECT * FROM edges WHERE src = ? ${relClause}`;
      params.push(node);
      if (relation) params.push(relation);
    } else if (direction === "in") {
      sql = `SELECT * FROM edges WHERE dst = ? ${relClause}`;
      params.push(node);
      if (relation) params.push(relation);
    } else {
      sql = `SELECT * FROM edges WHERE (src = ? OR dst = ?) ${relClause}`;
      params.push(node, node);
      if (relation) params.push(relation);
    }
    return this.db.prepare(sql).all(...params) as EdgeRow[];
  }
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

function rowToNode(row: NodeRow): GraphNode {
  let props: Record<string, unknown> = {};
  try {
    props = JSON.parse(row.props_json) as Record<string, unknown>;
  } catch {
    /* default */
  }
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    props,
    last_validated: row.last_validated,
    confidence: row.confidence,
  };
}

function rowToEdge(row: EdgeRow): GraphEdge {
  let props: Record<string, unknown> = {};
  try {
    props = JSON.parse(row.props_json) as Record<string, unknown>;
  } catch {
    /* default */
  }
  return {
    src: row.src,
    dst: row.dst,
    relation: row.relation,
    weight: row.weight,
    props,
  };
}
