# Smoke

## Vector retrieval (opt-in)

APEX ships a Tier 1 SQLite FTS5 keyword index by default. Tier 2 adds a local
LanceDB vector index with on-device embeddings — no network calls, no API
keys. Enable it when you want semantic recall (e.g. "the auth handler" matches
a knowledge entry titled "JWT refresh-token rotation").

### Enable

```
apex enable vector
```

This:

1. Flips `[vector].enabled = true` in `.apex/config.toml`.
2. Creates `.apex/index/vectors.lance/` (gitignored).
3. Downloads the default embedding model (`Xenova/all-MiniLM-L6-v2`, ~25MB,
   384-dim) on first use via `@xenova/transformers`. Cached under your user
   transformers directory; subsequent runs are offline.
4. Runs an mtime-incremental sync of the existing knowledge base into the
   vector index.

### Disable

```
apex disable vector
```

Flips the config flag and stops vector lookups. Index files at
`.apex/index/vectors.lance/` are left in place so re-enabling is instant.

### Search by tier

```
apex search "auth handler" --tier hybrid    # default when vector is enabled
apex search "auth handler" --tier vector    # vector-only
apex search "auth handler" --tier fts       # FTS5-only (always available)
```

`hybrid` runs both tiers in parallel and fuses the rankings via Reciprocal
Rank Fusion (RRF, k=60). Hits that surface in both tiers are tagged
`tier: "hybrid"`; otherwise the originating tier sticks.

### Where data lives

| Path | Purpose | Committed |
|---|---|---|
| `.apex/knowledge/` | Knowledge entries (markdown + frontmatter) | yes |
| `.apex/index/fts.sqlite` | Tier 1 FTS5 index | no (gitignored) |
| `.apex/index/vectors.lance/` | Tier 2 vector index | no (gitignored) |
| `.apex/config.toml` | `[vector] enabled = true|false` | yes |

### Testing without the model download

The vector store and embedder honour `APEX_VECTOR_FAKE=1`, which substitutes
deterministic 384-dim hash-based vectors for the real model. Used by the unit
tests and useful for CI runs where you don't want to download model weights.
