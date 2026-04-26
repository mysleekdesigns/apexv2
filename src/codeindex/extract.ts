import { getLanguage, getParser, type CodeLanguage } from "./parsers.js";

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "type"
  | "interface"
  | "const";

export interface ExtractedSymbol {
  symbol: string;
  kind: SymbolKind;
  file: string;
  line: number;
  end_line: number;
  exported: boolean;
  language: CodeLanguage;
}

const TS_QUERY = `
(function_declaration name: (identifier) @name) @function
(class_declaration name: (type_identifier) @name) @class
(method_definition name: (property_identifier) @name) @method
(interface_declaration name: (type_identifier) @name) @interface
(type_alias_declaration name: (type_identifier) @name) @type
(lexical_declaration (variable_declarator name: (identifier) @name)) @const
(variable_declaration (variable_declarator name: (identifier) @name)) @const
`;

const JS_QUERY = `
(function_declaration name: (identifier) @name) @function
(class_declaration name: (identifier) @name) @class
(method_definition name: (property_identifier) @name) @method
(lexical_declaration (variable_declarator name: (identifier) @name)) @const
(variable_declaration (variable_declarator name: (identifier) @name)) @const
`;

const PY_QUERY = `
(module
  (function_definition name: (identifier) @name) @function)
(module
  (class_definition name: (identifier) @name) @class)
(class_definition
  body: (block
    (function_definition name: (identifier) @name) @method))
`;

const QUERY_SOURCES: Record<CodeLanguage, string> = {
  ts: TS_QUERY,
  tsx: TS_QUERY,
  js: JS_QUERY,
  py: PY_QUERY,
};

interface SyntaxNode {
  type: string;
  text: string;
  parent: SyntaxNode | null;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}

interface QueryCapture {
  name: string;
  node: SyntaxNode;
}

interface QueryMatch {
  pattern: number;
  captures: QueryCapture[];
}

interface QueryHandle {
  matches: (node: SyntaxNode) => QueryMatch[];
}

interface TreeHandle {
  rootNode: SyntaxNode;
  delete: () => void;
}

const queryCache = new Map<CodeLanguage, QueryHandle>();

async function getQuery(lang: CodeLanguage): Promise<QueryHandle> {
  const cached = queryCache.get(lang);
  if (cached) return cached;
  const language = (await getLanguage(lang)) as unknown as {
    query: (s: string) => QueryHandle;
  };
  const query = language.query(QUERY_SOURCES[lang]);
  queryCache.set(lang, query);
  return query;
}

const CAPTURE_TO_KIND: Record<string, SymbolKind> = {
  function: "function",
  class: "class",
  method: "method",
  interface: "interface",
  type: "type",
  const: "const",
};

function isExportedTsJs(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.type === "export_statement" || cur.type === "export_default_declaration") {
      return true;
    }
    if (cur.type === "program" || cur.type === "source_file") return false;
    cur = cur.parent;
  }
  return false;
}

function isExportedPython(name: string, isTopLevel: boolean): boolean {
  return isTopLevel && !name.startsWith("_");
}

function isTopLevel(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return true;
  return parent.type === "program" || parent.type === "module" || parent.type === "source_file";
}

export async function extractSymbolsFromText(
  filePath: string,
  source: string,
  lang: CodeLanguage,
): Promise<ExtractedSymbol[]> {
  const parser = (await getParser(lang)) as unknown as {
    parse: (s: string) => TreeHandle | null;
  };
  const tree = parser.parse(source);
  if (!tree) return [];
  const query = await getQuery(lang);
  const matches = query.matches(tree.rootNode);

  const out: ExtractedSymbol[] = [];
  for (const m of matches) {
    let nameCap: SyntaxNode | null = null;
    let nodeCap: SyntaxNode | null = null;
    let kindCap: SymbolKind | null = null;
    for (const c of m.captures) {
      if (c.name === "name") {
        nameCap = c.node;
      } else if (CAPTURE_TO_KIND[c.name]) {
        nodeCap = c.node;
        kindCap = CAPTURE_TO_KIND[c.name] ?? null;
      }
    }
    if (!nameCap || !nodeCap || !kindCap) continue;

    const symbol = nameCap.text;
    if (!symbol) continue;

    let exported = false;
    if (lang === "py") {
      exported = isExportedPython(symbol, isTopLevel(nodeCap));
    } else {
      exported = isExportedTsJs(nodeCap);
    }

    out.push({
      symbol,
      kind: kindCap,
      file: filePath,
      line: nodeCap.startPosition.row + 1,
      end_line: nodeCap.endPosition.row + 1,
      exported,
      language: lang,
    });
  }

  tree.delete();
  return dedupe(out);
}

function dedupe(items: ExtractedSymbol[]): ExtractedSymbol[] {
  const seen = new Set<string>();
  const out: ExtractedSymbol[] = [];
  for (const s of items) {
    const key = `${s.kind}:${s.symbol}:${s.line}:${s.end_line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
