import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import ignore, { type Ignore } from "ignore";
import { projectPaths } from "../util/paths.js";
import { detectLanguage, type CodeLanguage } from "./parsers.js";
import { extractSymbolsFromText } from "./extract.js";
import {
  CodeIndexStore,
  type SymbolHit,
  type SymbolSearchOptions,
  type CodeIndexStats,
} from "./store.js";

export type { SymbolHit, SymbolSearchOptions, CodeIndexStats } from "./store.js";
export type { CodeLanguage } from "./parsers.js";
export type { ExtractedSymbol, SymbolKind } from "./extract.js";

export interface CodeIndexOptions {
  /** Override default file size limit (in KB). */
  maxFileKb?: number;
  /** Restrict to a subset of languages. Default: all supported. */
  languages?: CodeLanguage[];
}

export interface SyncResult {
  filesScanned: number;
  filesUpdated: number;
  filesRemoved: number;
  symbolsTotal: number;
  durationMs: number;
}

const DEFAULT_MAX_FILE_KB = 2000;
const ALWAYS_SKIP = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".apex",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "out",
]);

export class CodeIndex {
  private readonly root: string;
  private readonly indexPath: string;
  private readonly maxFileBytes: number;
  private readonly enabledLangs: Set<CodeLanguage>;
  private store: CodeIndexStore | null = null;

  constructor(root: string, opts: CodeIndexOptions = {}) {
    this.root = path.resolve(root);
    const paths = projectPaths(this.root);
    this.indexPath = path.join(paths.indexDir, "symbols.sqlite");
    this.maxFileBytes = (opts.maxFileKb ?? DEFAULT_MAX_FILE_KB) * 1024;
    this.enabledLangs = new Set(opts.languages ?? ["ts", "tsx", "js", "py"]);
  }

  private ensureStore(): CodeIndexStore {
    if (this.store) return this.store;
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
    this.store = new CodeIndexStore(this.indexPath);
    return this.store;
  }

  close(): void {
    this.store?.close();
    this.store = null;
  }

  async sync(): Promise<SyncResult> {
    const start = Date.now();
    const store = this.ensureStore();
    const ig = await loadIgnore(this.root);
    const files = await walk(this.root, this.root, ig);

    const known = new Map<string, number>();
    for (const f of store.listFiles()) known.set(f.file, f.mtime_ms);

    let filesScanned = 0;
    let filesUpdated = 0;
    let symbolsTotal = 0;
    const seen = new Set<string>();

    for (const abs of files) {
      const rel = path.relative(this.root, abs).split(path.sep).join("/");
      const lang = detectLanguage(rel);
      if (!lang || !this.enabledLangs.has(lang)) continue;

      let st: fs.Stats;
      try {
        st = await fsp.stat(abs);
      } catch {
        continue;
      }
      if (st.size > this.maxFileBytes) continue;
      filesScanned++;
      seen.add(rel);
      const mtime = Math.floor(st.mtimeMs);
      const prior = known.get(rel);
      if (prior === mtime) continue;

      let source: string;
      try {
        source = await fsp.readFile(abs, "utf8");
      } catch {
        continue;
      }
      const symbols = await extractSymbolsFromText(rel, source, lang);
      store.upsertFile(rel, mtime, symbols);
      filesUpdated++;
      symbolsTotal += symbols.length;
    }

    let filesRemoved = 0;
    for (const file of known.keys()) {
      if (!seen.has(file)) {
        store.deleteFile(file);
        filesRemoved++;
      }
    }
    store.setSyncedAt(new Date().toISOString());

    return {
      filesScanned,
      filesUpdated,
      filesRemoved,
      symbolsTotal: store.stats().totalSymbols,
      durationMs: Date.now() - start,
    };
  }

  async findSymbol(query: string, opts: SymbolSearchOptions = {}): Promise<SymbolHit[]> {
    const store = this.ensureStore();
    return store.searchSymbol(query, opts);
  }

  async findByPathHint(hint: string, opts: { k?: number } = {}): Promise<SymbolHit[]> {
    const store = this.ensureStore();
    const tokens = hint
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 1);
    if (tokens.length === 0) return [];
    const merged = new Map<string, SymbolHit>();
    const k = opts.k ?? 10;
    for (const tok of tokens) {
      for (const hit of store.searchByPath(tok, k * 2)) {
        const key = `${hit.file}:${hit.line}:${hit.symbol}`;
        const prior = merged.get(key);
        if (prior) {
          prior.score += 1;
        } else {
          merged.set(key, { ...hit, score: 1 });
        }
      }
    }
    return [...merged.values()]
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
      .slice(0, k);
  }

  async stats(): Promise<CodeIndexStats & { last_sync: string | null; index_path: string }> {
    const store = this.ensureStore();
    return {
      ...store.stats(),
      last_sync: store.getSyncedAt(),
      index_path: this.indexPath,
    };
  }
}

async function loadIgnore(root: string): Promise<Ignore> {
  const ig = ignore();
  const gitignorePath = path.join(root, ".gitignore");
  try {
    const text = await fsp.readFile(gitignorePath, "utf8");
    ig.add(text);
  } catch {
    /* no .gitignore */
  }
  for (const dir of ALWAYS_SKIP) ig.add(dir);
  return ig;
}

async function walk(root: string, dir: string, ig: Ignore): Promise<string[]> {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.length === 0) continue;
    if (ALWAYS_SKIP.has(ent.name)) continue;
    const ignoredPath = ent.isDirectory() ? `${rel}/` : rel;
    if (ig.ignores(ignoredPath)) continue;
    if (ent.isDirectory()) {
      out.push(...(await walk(root, abs, ig)));
    } else if (ent.isFile()) {
      out.push(abs);
    }
  }
  return out;
}
