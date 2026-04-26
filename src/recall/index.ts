import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { KnowledgeStore, type SearchOptions, type StoreStats } from "./store.js";
import { loadKnowledgeWithWarnings } from "./loader.js";
import { projectPaths } from "../util/paths.js";
import { loadConfig } from "../config/index.js";
import { VectorStore, type VectorStoreStats } from "./vector/store.js";
import {
  HybridResultCache,
  hybridSearch,
  type RerankFn,
} from "./hybrid.js";
import type { KnowledgeEntry, KnowledgeType, RecallHit } from "../types/shared.js";

export type RecallTier = "fts" | "vector" | "hybrid";

export interface RecallOptions {
  /** Disable lazy mtime sync (useful for tests). */
  autoSync?: boolean;
  /** Custom warn channel for loader issues. */
  onWarn?: (msg: string) => void;
  /** Force-enable vector retrieval even if config disables it (used by `apex enable vector`). */
  vector?: boolean;
  /** Use deterministic synthetic embeddings — for tests without network. */
  fakeVector?: boolean;
  /** Optional reranker for hybrid retrieval. */
  rerank?: RerankFn;
}

export interface RecallSearchOptions extends Omit<SearchOptions, "tier"> {
  tier?: RecallTier;
}

export interface RecallStats extends StoreStats {
  last_sync: string | null;
  index_path: string;
  drift_warnings: string[];
  vector?: VectorStoreStats & { enabled: boolean };
}

export class Recall {
  private readonly root: string;
  private readonly indexPath: string;
  private readonly vectorPath: string;
  private readonly knowledgeDir: string;
  private store: KnowledgeStore | null = null;
  private vectorStore: VectorStore | null = null;
  private vectorEnabled: boolean | null = null;
  private vectorOverride: boolean | undefined;
  private fakeVector: boolean | undefined;
  private synced = false;
  private vectorSynced = false;
  private autoSync: boolean;
  private onWarn: (msg: string) => void;
  private lastWarnings: string[] = [];
  private readonly cache = new HybridResultCache();
  private readonly rerank: RerankFn | undefined;

  constructor(root: string, opts: RecallOptions = {}) {
    this.root = path.resolve(root);
    const paths = projectPaths(this.root);
    this.indexPath = path.join(paths.indexDir, "fts.sqlite");
    this.vectorPath = path.join(paths.indexDir, "vectors.lance");
    this.knowledgeDir = paths.knowledgeDir;
    this.autoSync = opts.autoSync !== false;
    this.onWarn = opts.onWarn ?? ((m) => console.warn(`[apex-recall] ${m}`));
    this.vectorOverride = opts.vector;
    this.fakeVector = opts.fakeVector;
    this.rerank = opts.rerank;
  }

  private ensureStore(): KnowledgeStore {
    if (this.store) return this.store;
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
    try {
      this.store = new KnowledgeStore(this.indexPath);
    } catch {
      try {
        fs.rmSync(this.indexPath, { force: true });
      } catch {
        /* ignore */
      }
      this.store = new KnowledgeStore(this.indexPath);
    }
    return this.store;
  }

  private async isVectorEnabled(): Promise<boolean> {
    if (this.vectorOverride !== undefined) return this.vectorOverride;
    if (this.vectorEnabled !== null) return this.vectorEnabled;
    const cfg = await loadConfig(this.root);
    this.vectorEnabled = cfg.vector.enabled;
    return this.vectorEnabled;
  }

  private async ensureVectorStore(): Promise<VectorStore | null> {
    if (this.vectorStore) return this.vectorStore;
    const enabled = await this.isVectorEnabled();
    if (!enabled) return null;
    const cfg = await loadConfig(this.root);
    this.vectorStore = new VectorStore({
      path: this.vectorPath,
      model: cfg.vector.model,
      dim: cfg.vector.dim,
      ...(this.fakeVector !== undefined ? { fake: this.fakeVector } : {}),
    });
    return this.vectorStore;
  }

  async search(query: string, opts: RecallSearchOptions = {}): Promise<RecallHit[]> {
    if (!fs.existsSync(this.knowledgeDir)) return [];
    const store = this.ensureStore();
    if (this.autoSync) await this.syncIfStale();

    const enabled = await this.isVectorEnabled();
    const requested: RecallTier = opts.tier ?? (enabled ? "hybrid" : "fts");
    const ftsOpts: SearchOptions = {};
    if (opts.type) ftsOpts.type = opts.type;
    if (opts.k !== undefined) ftsOpts.k = opts.k;
    if (opts.includeArchived !== undefined) ftsOpts.includeArchived = opts.includeArchived;

    if (requested === "fts" || !enabled) {
      return store.search(query, ftsOpts);
    }

    const vectorStore = await this.ensureVectorStore();
    if (!vectorStore) return store.search(query, ftsOpts);
    if (this.autoSync) await this.syncVectorIfStale();

    if (requested === "vector") {
      return vectorStore.search(query, { k: opts.k ?? 5, ...(opts.type ? { type: opts.type } : {}) });
    }

    const k = opts.k ?? 5;
    const knowledgeVersion = store.getSyncedAt() ?? "0";
    return hybridSearch(
      query,
      {
        ftsSearch: (q, n) => store.search(q, { ...ftsOpts, k: n }),
        vectorSearch: (q, n) =>
          vectorStore.search(q, { k: n, ...(opts.type ? { type: opts.type } : {}) }),
        knowledgeVersion: () => knowledgeVersion,
        cache: this.cache,
      },
      { k, ...(this.rerank ? { rerank: this.rerank } : {}) },
    );
  }

  async get(entryId: string, type?: KnowledgeType): Promise<KnowledgeEntry | null> {
    const store = this.ensureStore();
    if (this.autoSync) await this.syncIfStale();
    if (type) return store.get(type, entryId);
    return store.getById(entryId);
  }

  async stats(): Promise<RecallStats> {
    const store = this.ensureStore();
    if (this.autoSync) await this.syncIfStale();
    const base: RecallStats = {
      ...store.stats(),
      last_sync: store.getSyncedAt(),
      index_path: this.indexPath,
      drift_warnings: [...this.lastWarnings],
    };
    const enabled = await this.isVectorEnabled();
    if (enabled) {
      const vec = await this.ensureVectorStore();
      if (vec) {
        const vs = await vec.stats();
        base.vector = { ...vs, enabled: true };
      }
    }
    return base;
  }

  /** Force a full resync of the FTS index from disk. */
  async sync(): Promise<void> {
    const store = this.ensureStore();
    if (!fs.existsSync(this.knowledgeDir)) {
      this.synced = true;
      return;
    }
    const { entries, warnings } = await loadKnowledgeWithWarnings(this.root, {
      onWarn: this.onWarn,
    });
    this.lastWarnings = warnings;

    const existing = new Map<string, { type: KnowledgeType; mtime_ms: number }>();
    for (const row of store.listAll()) {
      existing.set(`${row.type}:${row.id}`, { type: row.type, mtime_ms: row.mtime_ms });
    }

    const seen = new Set<string>();
    for (const entry of entries) {
      const absPath = path.join(this.root, entry.path);
      let mtimeMs = 0;
      try {
        const st = await fsp.stat(absPath);
        mtimeMs = Math.floor(st.mtimeMs);
      } catch {
        /* ignore */
      }
      const key = `${entry.frontmatter.type}:${entry.frontmatter.id}`;
      seen.add(key);
      const prior = existing.get(key);
      if (!prior || prior.mtime_ms !== mtimeMs) {
        store.upsert(entry, mtimeMs);
      }
    }
    for (const [key] of existing) {
      if (!seen.has(key)) {
        const [type, id] = key.split(":") as [KnowledgeType, string];
        store.delete(type, id);
      }
    }
    store.setSyncedAt(new Date().toISOString());
    this.cache.invalidate();
    this.synced = true;
  }

  /** Mtime-incremental sync of the vector store from disk. No-op when disabled. */
  async syncVector(): Promise<void> {
    if (!fs.existsSync(this.knowledgeDir)) {
      this.vectorSynced = true;
      return;
    }
    const enabled = await this.isVectorEnabled();
    if (!enabled) return;
    const vectorStore = await this.ensureVectorStore();
    if (!vectorStore) return;

    const { entries, warnings } = await loadKnowledgeWithWarnings(this.root, {
      onWarn: this.onWarn,
    });
    this.lastWarnings = warnings;

    const store = this.ensureStore();
    const ftsRows = new Map<string, { mtime_ms: number }>();
    for (const row of store.listAll()) {
      ftsRows.set(`${row.type}:${row.id}`, { mtime_ms: row.mtime_ms });
    }

    const stateFile = path.join(this.vectorPath, ".sync.json");
    let lastSync: Record<string, number> = {};
    try {
      const text = await fsp.readFile(stateFile, "utf8");
      lastSync = JSON.parse(text) as Record<string, number>;
    } catch {
      /* fresh */
    }

    const upserts: KnowledgeEntry[] = [];
    const next: Record<string, number> = {};
    for (const entry of entries) {
      const absPath = path.join(this.root, entry.path);
      let mtimeMs = 0;
      try {
        const st = await fsp.stat(absPath);
        mtimeMs = Math.floor(st.mtimeMs);
      } catch {
        /* ignore */
      }
      const key = `${entry.frontmatter.type}:${entry.frontmatter.id}`;
      next[key] = mtimeMs;
      if (lastSync[key] !== mtimeMs) {
        upserts.push(entry);
      }
    }

    for (const key of Object.keys(lastSync)) {
      if (!(key in next)) {
        const [type, id] = key.split(":") as [KnowledgeType, string];
        await vectorStore.delete(type, id);
      }
    }

    if (upserts.length > 0) {
      await vectorStore.upsert(upserts);
    }

    await fsp.mkdir(this.vectorPath, { recursive: true });
    await fsp.writeFile(stateFile, JSON.stringify(next), "utf8");
    this.cache.invalidate();
    this.vectorSynced = true;
  }

  private async syncIfStale(): Promise<void> {
    if (!this.synced) {
      await this.sync();
      return;
    }
    try {
      const st = await fsp.stat(this.knowledgeDir);
      const last = this.store?.getSyncedAt();
      if (last && new Date(last).getTime() < st.mtimeMs) {
        await this.sync();
      }
    } catch {
      /* ignore */
    }
  }

  private async syncVectorIfStale(): Promise<void> {
    if (!this.vectorSynced) {
      await this.syncVector();
    }
  }

  close(): void {
    this.store?.close();
    this.store = null;
    if (this.vectorStore) {
      const vs = this.vectorStore;
      this.vectorStore = null;
      void vs.close();
    }
  }
}
