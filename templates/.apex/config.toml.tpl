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

[graph]
# Opt-in property graph at .apex/index/graph.sqlite.
# Build with: apex graph sync. Query with: apex graph deps|dependents|blast|stats.
enabled = false
