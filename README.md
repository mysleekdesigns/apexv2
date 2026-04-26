# Smoke

## MCP server

APEX ships a stdio MCP server (`apex-mcp`) exposing recall and capture tools. It
is auto-registered into the project's `.mcp.json` by `apex init`.

### Auto-registration

`apex init` calls `registerApexMcp` near the end of the install flow. The helper:

- Creates `.mcp.json` if missing, populated from `templates/.mcp.json.tpl`.
- Merges into an existing file by server name (`apex`); other entries and
  top-level keys are preserved.
- Is idempotent — re-running is a no-op when the entry already matches.
- Recovers from malformed JSON by renaming the file with a `.bak.<ts>` suffix
  and writing fresh; a warning is logged to stderr.

### Tools exposed

Six tools, registered through a single declarative array in `src/mcp/index.ts`:

| Tool | Purpose |
|---|---|
| `apex_search` | Hybrid keyword (Tier 1 FTS5) retrieval over the knowledge base |
| `apex_get` | Fetch a full knowledge entry by id (and optional type) |
| `apex_get_decision` | Typed convenience wrapper around `apex_get` filtered to `type: decision` |
| `apex_record_correction` | Append a user-driven correction to `.apex/proposed/_corrections.md` |
| `apex_propose` | Write a candidate knowledge entry to `.apex/proposed/` |
| `apex_stats` | Index counts, last sync time, drift warnings |

### Deferred / lazy loading

The `@modelcontextprotocol/sdk` v1 protocol requires tool input schemas at
registration time, so APEX cannot defer schema delivery itself. What APEX does
instead, per PRD §3.3 and `specs/compatibility.md`:

- The SQLite recall handle is opened lazily on the first tool invocation.
  `tools/list` does not touch disk and creates no DB file.
- The `tools.listChanged` capability is advertised so newer Claude Code clients
  refresh the tool list automatically.
- `serverInfo.instructions` advertises the supported tool set, the minimum
  Claude Code version (2.1.0), and a pointer to PRD §3.3.

### Inspecting the registration

```bash
cat .mcp.json | jq .mcpServers.apex
```

The entry is tagged with `"_apex_managed": true` so future APEX upgrades can
identify it.

### Disabling / removing

- Temporary disable: edit `.mcp.json` and remove or rename the `apex` entry.
  Claude Code re-reads `.mcp.json` between sessions.
- Permanent removal: `apex uninstall` calls `unregisterApexMcp`, which strips
  only the `apex` entry. If `.mcp.json` ends up with no servers and no other
  top-level keys, the file is deleted.

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
