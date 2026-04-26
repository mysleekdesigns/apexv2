import path from "node:path";
import fs from "node:fs";
import { GraphStore, type GraphNode, type GraphRelation } from "./store.js";
import { buildGraph } from "./builder.js";
import { loadKnowledge } from "../recall/loader.js";
import { projectPaths } from "../util/paths.js";

export interface SyncResult {
  nodes: number;
  edges: number;
  durationMs: number;
}

export interface NeighborOpts {
  relation?: GraphRelation;
  maxDepth?: 1 | 2 | 3;
}

export interface NeighborOutput {
  node: GraphNode;
  relation: GraphRelation;
  depth: number;
}

export interface BlastEntry extends NeighborOutput {
  direction: "out" | "in";
  rank: number;
}

export interface PathStep {
  src: string;
  dst: string;
  relation: GraphRelation;
}

export interface GraphFacadeStats {
  nodes: number;
  edges: number;
  byNodeType: Record<string, number>;
  byRelation: Record<string, number>;
  orphanNodes: number;
  last_sync: string | null;
  index_path: string;
}

export class KnowledgeGraph {
  private readonly root: string;
  private readonly indexPath: string;
  private store: GraphStore | null = null;

  constructor(root: string) {
    this.root = path.resolve(root);
    const paths = projectPaths(this.root);
    this.indexPath = path.join(paths.indexDir, "graph.sqlite");
  }

  private ensureStore(): GraphStore {
    if (this.store) return this.store;
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
    this.store = new GraphStore(this.indexPath);
    return this.store;
  }

  async sync(): Promise<SyncResult> {
    const t0 = Date.now();
    const store = this.ensureStore();
    const entries = await loadKnowledge(this.root);
    const { nodes, edges } = buildGraph(entries);
    store.transaction(() => {
      store.rebuild();
      for (const n of nodes) store.upsertNode(n);
      for (const e of edges) store.upsertEdge(e);
    });
    store.setSyncedAt(new Date().toISOString());
    return {
      nodes: nodes.length,
      edges: edges.length,
      durationMs: Date.now() - t0,
    };
  }

  async dependents(id: string, opts: NeighborOpts = {}): Promise<NeighborOutput[]> {
    const store = this.ensureStore();
    return store.dependents(id, opts);
  }

  async dependencies(id: string, opts: NeighborOpts = {}): Promise<NeighborOutput[]> {
    const store = this.ensureStore();
    return store.dependencies(id, opts);
  }

  async blastRadius(id: string, depth: 1 | 2 | 3 = 2): Promise<BlastEntry[]> {
    const store = this.ensureStore();
    const out = store.dependencies(id, { maxDepth: depth }).map((r) => ({
      ...r,
      direction: "out" as const,
    }));
    const inn = store.dependents(id, { maxDepth: depth }).map((r) => ({
      ...r,
      direction: "in" as const,
    }));

    const merged = new Map<string, BlastEntry>();
    for (const e of [...inn, ...out]) {
      const prior = merged.get(e.node.id);
      if (!prior || e.depth < prior.depth) {
        merged.set(e.node.id, { ...e, rank: 0 });
      }
    }

    const incidence = new Map<string, number>();
    for (const e of store.listEdges()) {
      incidence.set(e.src, (incidence.get(e.src) ?? 0) + 1);
      incidence.set(e.dst, (incidence.get(e.dst) ?? 0) + 1);
    }

    const arr = Array.from(merged.values()).map((e) => ({
      ...e,
      rank: (incidence.get(e.node.id) ?? 0) - e.depth,
    }));
    arr.sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.node.id.localeCompare(b.node.id);
    });
    return arr;
  }

  async findPath(srcId: string, dstId: string, maxDepth = 4): Promise<PathStep[] | null> {
    const store = this.ensureStore();
    const all = store.paths(srcId, dstId, maxDepth);
    if (all.length === 0) return null;
    return all[0] ?? null;
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const store = this.ensureStore();
    return store.getNode(id);
  }

  stats(): GraphFacadeStats {
    const store = this.ensureStore();
    const s = store.stats();
    return {
      ...s,
      last_sync: store.getSyncedAt(),
      index_path: this.indexPath,
    };
  }

  close(): void {
    this.store?.close();
    this.store = null;
  }
}

export type { GraphNode, GraphEdge, GraphRelation } from "./store.js";
