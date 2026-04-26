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
