import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { KnowledgeStore, type SearchOptions, type StoreStats } from "./store.js";
import { loadKnowledgeWithWarnings } from "./loader.js";
import { projectPaths } from "../util/paths.js";
import type { KnowledgeEntry, KnowledgeType, RecallHit } from "../types/shared.js";

export interface RecallOptions {
  /** Disable lazy mtime sync (useful for tests). */
  autoSync?: boolean;
  /** Custom warn channel for loader issues. */
  onWarn?: (msg: string) => void;
}

export interface RecallStats extends StoreStats {
  last_sync: string | null;
  index_path: string;
  drift_warnings: string[];
}

export class Recall {
  private readonly root: string;
  private readonly indexPath: string;
  private readonly knowledgeDir: string;
  private store: KnowledgeStore | null = null;
  private synced = false;
  private autoSync: boolean;
  private onWarn: (msg: string) => void;
  private lastWarnings: string[] = [];

  constructor(root: string, opts: RecallOptions = {}) {
    this.root = path.resolve(root);
    const paths = projectPaths(this.root);
    this.indexPath = path.join(paths.indexDir, "fts.sqlite");
    this.knowledgeDir = paths.knowledgeDir;
    this.autoSync = opts.autoSync !== false;
    this.onWarn = opts.onWarn ?? ((m) => console.warn(`[apex-recall] ${m}`));
  }

  private ensureStore(): KnowledgeStore {
    if (this.store) return this.store;
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
    try {
      this.store = new KnowledgeStore(this.indexPath);
    } catch {
      // Corrupt DB — wipe and retry once.
      try {
        fs.rmSync(this.indexPath, { force: true });
      } catch {
        /* ignore */
      }
      this.store = new KnowledgeStore(this.indexPath);
    }
    return this.store;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<RecallHit[]> {
    if (!fs.existsSync(this.knowledgeDir)) return [];
    const store = this.ensureStore();
    if (this.autoSync) await this.syncIfStale();
    return store.search(query, opts);
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
    return {
      ...store.stats(),
      last_sync: store.getSyncedAt(),
      index_path: this.indexPath,
      drift_warnings: [...this.lastWarnings],
    };
  }

  /** Force a full resync from disk. */
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
    for (const [key, prior] of existing) {
      if (!seen.has(key)) {
        const [type, id] = key.split(":") as [KnowledgeType, string];
        store.delete(type, id);
      }
      void prior;
    }
    store.setSyncedAt(new Date().toISOString());
    this.synced = true;
  }

  private async syncIfStale(): Promise<void> {
    if (!this.synced) {
      await this.sync();
      return;
    }
    // Cheap drift check: compare entry count via dir scan vs index.
    // For Phase 1, we trust the in-process flag plus mtime detection on full sync.
    // Re-sync if the knowledge dir has been touched since last sync.
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

  close(): void {
    this.store?.close();
    this.store = null;
  }
}
