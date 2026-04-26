# Smoke

## Knowledge graph (opt-in)

APEX ships an opt-in property graph that links knowledge entries to each other and to files/symbols, enabling blast-radius queries like "what depends on the `auth-rotation` decision?".

Backing store: SQLite at `.apex/index/graph.sqlite`. Built from your existing `.apex/knowledge/` files — no extra files to maintain.

### Enable

```toml
# .apex/config.toml
[graph]
enabled = true
```

`apex graph sync` auto-creates the index, so the toggle is purely declarative.

### Build

```bash
apex graph sync
```

### Query

```bash
apex graph deps decision:auth-rotation        # outgoing edges
apex graph dependents decision:auth-rotation  # incoming edges (callers)
apex graph blast decision:auth-rotation --depth 2
apex graph stats
```

Add `--json` to any command for machine-readable output.

### Edge types

| Relation | Source → Target | Meaning |
|---|---|---|
| `supersedes` | `<entry>` → `<other-entry>` | Replaces an older entry (cross-type lookup; falls back to `unknown:<id>`) |
| `tagged` | `<entry>` → `tag:<name>` | Frontmatter tag |
| `affects` | `decision:<id>` → `file:<path>` | A decision binds a file/dir |
| `applies-to` | `gotcha:<id>` → `file:<path>` or `symbol:<file>:<line>` | Where the gotcha shows up |
| `references` | `pattern:<id>` → `<other-entry>` | `[[wiki-link]]` in body or explicit `references:` frontmatter |

### MCP exposure

The graph also exports MCP tool handlers (`apex_graph_dependents`, `apex_graph_dependencies`, `apex_graph_blast`) and zod input shapes at `src/graph/mcp-tools.ts`. The `apex-mcp` server registers them when `[graph].enabled = true`.
