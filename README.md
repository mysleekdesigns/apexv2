# Smoke

## Code-symbol index (opt-in)

APEX ships an optional Tier 3 retrieval backend that builds a tree-sitter
symbol index over your source code. It complements the always-on FTS5
knowledge index (Tier 1) and the optional vector store (Tier 2): instead
of searching natural-language knowledge, it lets Claude jump from a
phrase like "the auth handler" to a precise file/line by name or path
hint, no grep guessing required.

The index is local-only, rebuildable, and stored alongside the other
APEX state at `.apex/index/symbols.sqlite`. No native compilation —
parsing runs through `web-tree-sitter` (WASM) so it works on macOS,
Linux and Windows on Node 20+ without a build step.

### Languages supported

- TypeScript (`.ts`, `.mts`, `.cts`)
- TSX (`.tsx`)
- JavaScript (`.js`, `.mjs`, `.cjs`, `.jsx`)
- Python (`.py`)

Grammars are loaded from the bundled `tree-sitter-wasms` package — no
native build required.

### Symbol kinds

Each indexed symbol records `name`, `kind`, `file`, `line`, `end_line`,
`exported`, `language`. Supported kinds:

- `function`
- `class`
- `method`
- `type` (TS type aliases)
- `interface` (TS interfaces)
- `const` (top-level `const`/`let`/`var` bindings)

`exported` is true for TS/JS symbols whose declaration is wrapped in
`export ...` and for top-level Python names that don't start with `_`.

### Enabling it

Add a `[codeindex]` block to `.apex/config.toml`:

```toml
[codeindex]
enabled = true
# Optional: restrict to a subset.
# languages = ["ts", "tsx", "js", "py"]
# Skip files larger than this many KB (default 2000).
max_file_kb = 2000
```

### CLI

```bash
apex codeindex sync           # walk repo, refresh symbols.sqlite
apex codeindex find Service   # search the index
apex codeindex find run --kind method --exported
apex codeindex find handler --path auth   # path-substring bias
apex codeindex stats          # totals + per-language counts
```

`apex codeindex sync` walks the repo respecting `.gitignore` (via the
`ignore` package) and always skips `node_modules`, `dist`, `build`,
`.git`, `.apex`, `.next`, `.turbo`, `.cache`, `coverage`, `out`, plus
any file larger than `max_file_kb`. Mtime-driven incremental sync means
re-runs only re-parse changed files.

### Programmatic API

```ts
import { CodeIndex } from "apex-cc/codeindex";

const index = new CodeIndex(process.cwd());
await index.sync();
const hits = await index.findSymbol("authHandler", { k: 5 });
const byPath = await index.findByPathHint("auth handler", { k: 5 });
index.close();
```

### MCP exposure

`src/codeindex/mcp-tools.ts` exports `apexFindSymbol(ctx, args)` plus a
zod input schema (`findSymbolInputSchema`) ready for registration in
`apex-mcp`. The tool combines a direct symbol-name search with an
optional `path_hint` substring bias and returns ranked `SymbolHit`
records — wire it into the MCP server when ready.
