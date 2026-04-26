import type { KnowledgeEntry, KnowledgeType } from "../types/shared.js";
import type { GraphEdge, GraphNode, GraphNodeType } from "./store.js";

export interface BuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const KNOWLEDGE_TYPES: KnowledgeType[] = [
  "decision",
  "pattern",
  "gotcha",
  "convention",
];

/**
 * Translate a list of KnowledgeEntry into nodes + edges.
 * Resolves cross-entry references (supersedes, references) by id-to-type
 * lookup; unresolved ids fall through as `unknown:<id>` placeholders.
 */
export function buildGraph(entries: KnowledgeEntry[]): BuildResult {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const idToType = new Map<string, KnowledgeType>();

  for (const e of entries) {
    idToType.set(e.frontmatter.id, e.frontmatter.type);
  }

  const upsertNode = (node: GraphNode): void => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      return;
    }
    if (isPlaceholder(existing) && !isPlaceholder(node)) {
      nodes.set(node.id, node);
    }
  };

  const upsertEdge = (edge: GraphEdge): void => {
    const key = `${edge.src}|${edge.relation}|${edge.dst}`;
    if (!edges.has(key)) edges.set(key, edge);
  };

  const ensureFileNode = (filePath: string): string => {
    const id = `file:${filePath}`;
    upsertNode({ id, type: "file", label: filePath });
    return id;
  };

  const ensureSymbolNode = (filePath: string, line: string): string => {
    const id = `symbol:${filePath}:${line}`;
    upsertNode({
      id,
      type: "symbol",
      label: `${filePath}:${line}`,
      props: { file: filePath, line },
    });
    return id;
  };

  const ensureTagNode = (tag: string): string => {
    const id = `tag:${tag}`;
    upsertNode({ id, type: "tag", label: tag });
    return id;
  };

  const ensureRefNode = (rawId: string): string => {
    const knownType = idToType.get(rawId);
    if (knownType) {
      const id = `${knownType}:${rawId}`;
      upsertNode({ id, type: knownType, label: rawId });
      return id;
    }
    const id = `unknown:${rawId}`;
    upsertNode({ id, type: "unknown", label: rawId });
    return id;
  };

  for (const e of entries) {
    const fm = e.frontmatter;
    const nodeId = `${fm.type}:${fm.id}`;
    const props: Record<string, unknown> = {
      tags: fm.tags ?? [],
    };
    const fmAny = fm as unknown as Record<string, unknown>;
    if (Array.isArray(fmAny["affects"])) props["applies_to"] = fmAny["affects"];
    if (typeof fmAny["applies_to"] === "string") props["audience"] = fmAny["applies_to"];

    upsertNode({
      id: nodeId,
      type: fm.type,
      label: fm.title,
      props,
      last_validated: fm.last_validated,
      confidence: fm.confidence,
    });

    for (const sup of fm.supersedes ?? []) {
      const target = ensureRefNode(sup);
      upsertEdge({ src: nodeId, dst: target, relation: "supersedes" });
    }

    for (const tag of fm.tags ?? []) {
      const tagId = ensureTagNode(tag);
      upsertEdge({ src: nodeId, dst: tagId, relation: "tagged" });
    }

    if (fm.type === "decision") {
      const affects = readStringArray(fmAny["affects"]);
      for (const a of affects) {
        const fileId = ensureFileNode(a);
        upsertEdge({ src: nodeId, dst: fileId, relation: "affects" });
      }
    }

    if (fm.type === "gotcha") {
      const affects = readStringArray(fmAny["affects"]);
      for (const a of affects) {
        const sym = parseSymbolRef(a);
        const target = sym
          ? ensureSymbolNode(sym.file, sym.line)
          : ensureFileNode(a);
        upsertEdge({ src: nodeId, dst: target, relation: "applies-to" });
      }
    }

    if (fm.type === "pattern") {
      const refs = new Set<string>();
      for (const r of readStringArray(fmAny["references"])) refs.add(r);
      for (const r of extractWikiRefs(e.body)) refs.add(r);
      for (const r of refs) {
        if (r === fm.id) continue;
        const target = ensureRefNode(r);
        upsertEdge({ src: nodeId, dst: target, relation: "references" });
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}

function isPlaceholder(n: GraphNode): boolean {
  return n.type === "unknown";
}

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function parseSymbolRef(s: string): { file: string; line: string } | null {
  const m = /^file\/(.+):(\d+)$/.exec(s);
  if (!m || !m[1] || !m[2]) return null;
  return { file: m[1], line: m[2] };
}

function extractWikiRefs(body: string): string[] {
  const out: string[] = [];
  const re = /\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

export function nodeIdFor(type: GraphNodeType, id: string): string {
  return `${type}:${id}`;
}
