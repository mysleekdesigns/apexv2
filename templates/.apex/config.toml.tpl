# .apex/config.toml — written by apex init on {{ INSTALL_DATE }}
version = 1

[auto_merge]
# Set to false to disable automatic promotion entirely.
enabled = true
# Number of sources required before a proposal is auto-promoted.
threshold = 2
# When true, skip auto-promotion if a conflicting entry already exists.
require_no_conflict = true
# Minimum confidence level for auto-promotion: "low" | "medium" | "high"
min_confidence = "low"

[reflection]
auto_merge = true
min_observations = 2

[recall]
top_n = 5
max_tokens = 2048

[redactor]
mode = "block"

# Vector retrieval (Tier 2 — opt-in). Run `apex enable vector` to flip
# `enabled = true` and build the local index. Disabled by default; FTS5 alone
# is fast and zero-dep. See PRD §3.1.
# [vector]
# enabled = false
# model = "Xenova/all-MiniLM-L6-v2"
# dim = 384
