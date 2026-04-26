import path from "node:path";
import { createRequire } from "node:module";

export type CodeLanguage = "ts" | "tsx" | "js" | "py";

const require = createRequire(import.meta.url);
type ParserCtor = new () => unknown;
const Parser: ParserCtor & {
  init: (opts?: Record<string, unknown>) => Promise<void>;
  Language: { load: (input: string | Uint8Array) => Promise<unknown> };
} = require("web-tree-sitter");

export type LanguageHandle = {
  query: (source: string) => unknown;
};

export type ParserHandle = {
  setLanguage: (lang: LanguageHandle) => void;
  parse: (input: string) => unknown;
};

const WASM_FILES: Record<CodeLanguage, string> = {
  ts: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  js: "tree-sitter-javascript.wasm",
  py: "tree-sitter-python.wasm",
};

const EXT_TO_LANG: Record<string, CodeLanguage> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "js",
  ".py": "py",
};

let initPromise: Promise<void> | null = null;
const languageCache = new Map<CodeLanguage, LanguageHandle>();
const parserCache = new Map<CodeLanguage, ParserHandle>();

function resolveWasm(file: string): string {
  const pkg = require.resolve("tree-sitter-wasms/package.json");
  return path.join(path.dirname(pkg), "out", file);
}

function locateWebTreeSitterWasm(): string {
  const entry = require.resolve("web-tree-sitter");
  return path.join(path.dirname(entry), "tree-sitter.wasm");
}

async function ensureInitialized(): Promise<void> {
  if (initPromise) return initPromise;
  const wasmPath = locateWebTreeSitterWasm();
  initPromise = Parser.init({
    locateFile: (name: string) => (name.endsWith(".wasm") ? wasmPath : name),
  });
  return initPromise;
}

export async function getLanguage(lang: CodeLanguage): Promise<LanguageHandle> {
  await ensureInitialized();
  const cached = languageCache.get(lang);
  if (cached) return cached;
  const wasmPath = resolveWasm(WASM_FILES[lang]);
  const language = (await Parser.Language.load(wasmPath)) as LanguageHandle;
  languageCache.set(lang, language);
  return language;
}

export async function getParser(lang: CodeLanguage): Promise<ParserHandle> {
  const cached = parserCache.get(lang);
  if (cached) return cached;
  const language = await getLanguage(lang);
  const parser = new Parser() as ParserHandle;
  parser.setLanguage(language);
  parserCache.set(lang, parser);
  return parser;
}

export function detectLanguage(filePath: string): CodeLanguage | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

export function supportedLanguages(): CodeLanguage[] {
  return ["ts", "tsx", "js", "py"];
}
