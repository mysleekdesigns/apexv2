import fs from "node:fs";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import {
  createEmbedder,
  DEFAULT_EMBED_DIM,
  DEFAULT_EMBED_MODEL,
  type Embedder,
} from "./embedder.js";
import type {
  Confidence,
  KnowledgeEntry,
  KnowledgeType,
  RecallHit,
} from "../../types/shared.js";

const TABLE_NAME = "knowledge";

export interface VectorStoreOptions {
  path: string;
  model?: string;
  dim?: number;
  fake?: boolean;
}

export interface VectorSearchOptions {
  k?: number;
  type?: KnowledgeType;
}

export interface VectorStoreStats {
  total: number;
  dim: number;
  model: string;
}

interface Row {
  pk: string;
  id: string;
  type: KnowledgeType;
  title: string;
  body: string;
  path: string;
  last_validated: string;
  confidence: Confidence;
  vector: Float32Array;
}

interface SearchRow extends Row {
  _distance: number;
}

export class VectorStore {
  private readonly indexPath: string;
  private readonly embedder: Embedder;
  private connection: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;

  constructor(opts: VectorStoreOptions) {
    this.indexPath = opts.path;
    this.embedder = createEmbedder({
      model: opts.model ?? DEFAULT_EMBED_MODEL,
      dim: opts.dim ?? DEFAULT_EMBED_DIM,
      ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
    });
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
  }

  private async conn(): Promise<lancedb.Connection> {
    if (this.connection) return this.connection;
    this.connection = await lancedb.connect(this.indexPath);
    return this.connection;
  }

  private async ensureTable(seed?: Row): Promise<lancedb.Table | null> {
    if (this.table) return this.table;
    const conn = await this.conn();
    const names = await conn.tableNames();
    if (names.includes(TABLE_NAME)) {
      this.table = await conn.openTable(TABLE_NAME);
      return this.table;
    }
    if (!seed) return null;
    this.table = await conn.createTable(TABLE_NAME, [rowToRecord(seed)]);
    return this.table;
  }

  async upsert(entries: KnowledgeEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const texts = entries.map((e) => `${e.frontmatter.title}\n\n${e.body}`);
    const vectors = await this.embedder.embed(texts);
    const rows: Row[] = entries.map((e, i) => ({
      pk: makePk(e.frontmatter.type, e.frontmatter.id),
      id: e.frontmatter.id,
      type: e.frontmatter.type,
      title: e.frontmatter.title,
      body: e.body,
      path: e.path,
      last_validated: e.frontmatter.last_validated,
      confidence: e.frontmatter.confidence,
      vector: vectors[i] ?? new Float32Array(this.embedder.dim),
    }));

    let table = await this.ensureTable(rows[0]);
    if (!table) {
      table = await this.ensureTable(rows[0]);
    }
    if (!table) throw new Error("vector table init failed");

    const records = rows.map(rowToRecord);

    await table
      .mergeInsert("pk")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(records);
  }

  async delete(type: KnowledgeType, id: string): Promise<void> {
    const table = await this.ensureTable();
    if (!table) return;
    const pk = makePk(type, id);
    await table.delete(`pk = '${pk.replace(/'/g, "''")}'`);
  }

  async search(query: string, opts: VectorSearchOptions = {}): Promise<RecallHit[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const table = await this.ensureTable();
    if (!table) return [];
    const k = opts.k ?? 5;
    const vector = await this.embedder.embedOne(trimmed);
    let q = table.vectorSearch(vector).limit(k);
    if (opts.type) {
      q = q.where(`type = '${opts.type}'`);
    }
    const rows = (await q.toArray()) as SearchRow[];
    return rows.map((r, i) => ({
      entry_id: r.id,
      entry_type: r.type,
      title: r.title,
      path: r.path,
      excerpt: makeExcerpt(r.body),
      score: distanceToScore(r._distance),
      rank: i + 1,
      tier: "vector",
      last_validated: r.last_validated,
      confidence: r.confidence,
    }));
  }

  async stats(): Promise<VectorStoreStats> {
    const table = await this.ensureTable();
    const total = table ? await table.countRows() : 0;
    return {
      total,
      dim: this.embedder.dim,
      model: this.embedder.model,
    };
  }

  async close(): Promise<void> {
    if (this.table) {
      try {
        this.table.close();
      } catch {
        /* ignore */
      }
      this.table = null;
    }
    if (this.connection) {
      try {
        this.connection.close();
      } catch {
        /* ignore */
      }
      this.connection = null;
    }
  }
}

function rowToRecord(r: Row): Record<string, unknown> {
  return {
    pk: r.pk,
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    path: r.path,
    last_validated: r.last_validated,
    confidence: r.confidence,
    vector: Array.from(r.vector),
  };
}

function makePk(type: KnowledgeType, id: string): string {
  return `${type}:${id}`;
}

function distanceToScore(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return 1 / (1 + Math.max(0, distance));
}

function makeExcerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= 160) return flat;
  return `${flat.slice(0, 160)}...`;
}
