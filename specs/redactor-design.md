# Redactor Design

> Phase 0 spec. Phase 1 implements. Source of truth: PRD §6.0, §6.5 (privacy), §9. Sibling specs: [`threat-model.md`](./threat-model.md), [`knowledge-schema.md`](./knowledge-schema.md), `episode-schema.md`, `install.md`.

The redactor is a **shared component** that runs on every write into `.apex/episodes/` and `.apex/knowledge/`. It is the single chokepoint enforcing §4 of the threat model. There is no global "off" switch (TA2).

All timestamps in this document are ISO 8601.

---

## 1. Where it runs — integration contract

### 1.1 Interface

The redactor is a **stdin → stdout filter**, exit code 0 on success, non-zero on `block`-tier match.

```
$ <writer>  |  apex-redact [--mode={enforce|audit}] [--source={episode|knowledge}]  >  <target-file>
```

- **stdin**: arbitrary bytes (UTF-8 expected; binary input is rejected with exit 2).
- **stdout**: redacted bytes. In `mask`/`warn` matches, output ≠ input. In `block` matches, output is empty and exit code = 10.
- **stderr**: human-readable diagnostic in `enforce` mode; structured JSON one-line summary in `--mode=audit`.
- **side effect**: appends one line to `.apex/audit.log` per match (block, mask, warn) — see §7.

### 1.2 Wiring points

Every hook that writes into `.apex/` MUST pipe through the redactor. Phase 1 hook templates (`install.md`) wire it as follows:

```bash
# .claude/hooks/on-post-tool.sh — referenced from episode-schema.md §JSONL writes
jq -c '<event projection>' \
  | "$CLAUDE_PROJECT_DIR/.apex/bin/apex-redact" --source=episode \
  >> ".apex/episodes/${APEX_EPISODE_ID}/events.jsonl"
```

```bash
# Reflector / curator knowledge writes — referenced from knowledge-schema.md §writes
cat "$staged_entry" \
  | "$CLAUDE_PROJECT_DIR/.apex/bin/apex-redact" --source=knowledge \
  > ".apex/proposed/${entry_id}.md" \
  || { echo "Refusing to write: secret detected"; exit 10; }
```

The MCP server `apex_propose` and `apex_record_correction` tools (PRD §7.4) MUST invoke the same binary (or its in-process library form) before persisting.

### 1.3 No bypass

- No `--disable`, no `APEX_REDACT=off`, no `redactor.enabled` config key.
- Allowlists (`§5`) are per-pattern, file-pinned, and audited.
- The binary's path is recorded by `apex install`; `apex audit` verifies the SHA-256 of the on-disk binary against the install manifest at `.apex/install.lock`.

---

## 2. Pattern catalog

Every detector is `(name, regex, severity, examples_true_positive[], known_false_positives[])`. Severity is the **default**; per-project config can promote `warn → mask → block` but never demote below `warn` for any catalog entry.

| Name | Regex (PCRE) | Sev | True-positive examples | Known false-positives |
|---|---|---|---|---|
| `aws-access-key` | `\bAKIA[0-9A-Z]{16}\b` | block | `AKIA1234567890ABCDEF` (20 chars total: `AKIA` + 16) | None significant; prefix is reserved by AWS |
| `aws-secret-key` | `(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40}(?![A-Za-z0-9+/=])` *only when within 4 lines of `aws_secret_access_key` or `AWS_SECRET_ACCESS_KEY` token* | block | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` adjacent to an `aws_secret_access_key=` line | Many 40-char base64 strings (commit SHAs are 40 hex, but hex ⊂ b64 — covered by the proximity guard); SRI hashes |
| `gh-pat` | `\bgh[pousr]_[A-Za-z0-9]{36,255}\b` | block | `ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789`; `ghs_…`, `gho_…`, `ghu_…`, `ghr_…` | None |
| `gitlab-pat` | `\bglpat-[A-Za-z0-9_\-]{20,}\b` | block | `glpat-xxxxxxxxxxxxxxxxxxxx` | None |
| `slack-token` | `\bxox[baprs]-[A-Za-z0-9-]{10,}\b` | block | `xoxb-1234-5678-AbCdEfGhIj` | None |
| `slack-webhook` | `https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+` | block | `https://hooks.slack.com/services/T01.../B01.../abc...` | None |
| `discord-webhook` | `https://(?:ptb\.\|canary\.)?discord(?:app)?\.com/api/webhooks/\d+/[A-Za-z0-9_\-]+` | block | `https://discord.com/api/webhooks/123/abc-_` | None |
| `jwt` | `\beyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b` | block | `eyJhbGciOi…J9.eyJzdWIi…J9.SflKxw…` | A literal three-segment dot-separated b64url string that *isn't* a JWT is theoretically possible but vanishingly rare in dev artifacts |
| `pem-private-key` | `-----BEGIN (?:RSA \| DSA \| EC \| OPENSSH \| ENCRYPTED \| PGP )?PRIVATE KEY-----` *(start match; redactor masks until matching END line)* | block | All `BEGIN ... PRIVATE KEY` PEM blocks | None |
| `openssh-private-key` | (covered by `pem-private-key` via `OPENSSH`) | block | `-----BEGIN OPENSSH PRIVATE KEY-----` | None |
| `openai-key` | `\bsk-(?!ant-)[A-Za-z0-9]{20,}\b` | block | `sk-AbCdEf…` | None |
| `anthropic-key` | `\bsk-ant-[A-Za-z0-9_\-]{80,}\b` | block | `sk-ant-api03-…` | None |
| `stripe-key` | `\b(?:sk\|pk\|rk)_(?:live\|test)_[A-Za-z0-9]{20,}\b` | block (live) / mask (test) | `sk_live_…`, `pk_test_…` | None |
| `google-api-key` | `\bAIza[0-9A-Za-z\-_]{35}\b` | block | `AIza…` (39 chars total) | None |
| `db-url-with-creds` | `\b(?:postgres\|postgresql\|mysql\|mongodb(?:\+srv)?\|redis\|amqp\|amqps)://[^:\s/@]+:[^@\s]+@` | block | `postgres://user:pass@db:5432/app` | None — userinfo in DB URLs is always sensitive |
| `env-assignment` | `(?im)^[\t ]*(?:export[\t ]+)?[A-Z][A-Z0-9_]*(?:SECRET\|TOKEN\|KEY\|PASSWORD\|PASSWD\|API_?KEY\|AUTH\|CREDS?\|CREDENTIAL)[A-Z0-9_]*[\t ]*=[\t ]*['"]?(\S{8,})` | block | `API_KEY=sk_abc123def456`; `export DB_PASSWORD="hunter2!!"`; `MY_GITHUB_TOKEN=ghp_…` | Placeholder values like `API_KEY=changeme` (≥ 8 chars) are flagged; allowlist them per project (§5) |
| `high-entropy-token` | `\b[A-Za-z0-9+/_\-]{32,}\b` *(flagged only when Shannon entropy ≥ 4.5 bits/char AND not matched by a more specific rule above AND not on commit-SHA / SRI / known-format allowlist)* | warn (mask after 2 occurrences in same file) | A 64-char hex blob inside an episode that doesn't match any specific rule | Long base64-encoded test fixtures, commit SHAs (entropy ~4.0), Tailwind class strings (entropy < 4.5), SRI hashes (allowlisted by `sha256-`/`sha384-` prefix) |
| `pii-email` | `\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b` *(except the `noreply@`, `no-reply@`, `*@example.com`, `*@example.org`, `*@test`, the user's own email from `git config user.email`, and project domain allowlist)* | mask | `customer@bigcorp.com` in a stack trace | `noreply@github.com`, the project's own commit-author addresses |
| `pii-phone` | `\b\+?\d[\d \-().]{8,18}\d\b` (with stricter contextual heuristic — see §3) | warn | `+1 415 555 0199` | Version strings, ISBNs, package versions — many false positives, hence `warn` not `mask` |

### 2.1 Detection ordering

Detectors run in the order listed above. The first matching detector wins for a given byte range; subsequent detectors do not re-flag the redacted output. This guarantees `<REDACTED:type>` markers reflect the most-specific category.

### 2.2 PEM block handling

For `pem-private-key`, when a BEGIN line is matched, the redactor consumes input through the matching `-----END … PRIVATE KEY-----` line and replaces the entire block with `<REDACTED:pem-private-key>` (single line). If no END line is found before EOF, the redactor returns exit 10 (`block`) — never emit a partial PEM.

### 2.3 Adversarial split-line case

If `aws-access-key` matches across a logical line that has been wrapped (e.g. JSON pretty-print inserts `\n` mid-token), input is normalised: the redactor folds CR/LF/whitespace within candidate match windows of length up to 256 chars before applying the regex. This is required for the test fixture in §8 case T9.

---

## 3. Modes

| Mode | Behaviour | Exit code | Audit log |
|---|---|---|---|
| `block` | Refuse the write entirely. Output empty. Caller MUST not retry without user intervention. | 10 | One line per match: `{ts, severity:"block", detector, source, offset_range, byte_count}` — value never logged |
| `mask` | Replace each match with `<REDACTED:detector-name>`. Pass through the rest of the input. | 0 | One line per match: `{ts, severity:"mask", detector, source, offset_range, byte_count}` |
| `warn` | Pass through unchanged. Do NOT modify output. Flag in `apex audit`. | 0 | One line per match: `{ts, severity:"warn", detector, source, offset_range, byte_count}` |

`block` is fatal: if any detector matches at `block` severity, the entire write is rejected — even if 99 other matches were `mask`/`warn`. The exit-10 convention lets shell pipelines `set -o pipefail` cleanly.

### 3.1 Mode promotion

A project may set, in `.apex/redactor.toml`:

```toml
[promote]
"pii-email"  = "block"   # we ship customer dumps; treat any email as block
"pii-phone"  = "mask"
```

Demotion below the catalog default is forbidden. The config loader rejects e.g. `"aws-access-key" = "warn"` with a non-zero exit at startup; `apex audit` reports any rejected promotions.

### 3.2 Phone heuristic

`pii-phone` regex matches greedily. To suppress version-string false positives, the detector consults a 24-char window around the match and de-flags if the surrounding text contains `version`, `v\d`, `package`, `npm`, `pip`, `cargo`, `go.mod`, `release`, `tag`, or matches `^v?\d+\.\d+\.\d+`. Documented to keep behaviour deterministic.

---

## 4. False-positive policy & allowlist

### 4.1 Allowlist file

`.apex/redactor-allow.toml` (committed; reviewable):

```toml
# A specific known-safe substring. Most precise form.
[[allow]]
detector = "high-entropy-token"
literal  = "abc123def456abc123def456abc123def456"  # the SHA of a vendored test asset
note     = "Test fixture in apps/api/test/fixtures/golden.json"
added_by = "alice@example.com"
added_on = "2026-04-22"

# A glob of file paths whose contents are exempt from a detector.
[[allow]]
detector = "env-assignment"
path_glob = ".apex/proposed/installer-defaults.md"
note     = "Documents example placeholder env vars; values are intentionally fake."
added_on = "2026-04-22"

# A regex narrower than the detector itself — must be a strict subset.
[[allow]]
detector = "pii-email"
regex    = "^.+@example\\.(com|org)$"
note     = "Synthetic test fixtures only."
added_on = "2026-04-22"
```

Allowlist semantics:

- `literal`: exact string match in the redacted byte range. Highest precision.
- `path_glob`: per-file exemption. Matched against the `--source` write target path.
- `regex`: anchored regex; redactor refuses to load an allowlist entry whose regex is broader than the detector itself (overlap test runs at config load).
- An allowlist entry MUST have `note` and `added_on` (ISO 8601 date). Linter rejects undated/unannotated entries.

### 4.2 Allowlist auditing

- `apex audit --allowlist` lists every active entry with file SHA-256, line number, `added_on`, and the count of times each entry suppressed a match in the last 30 days.
- CI lint (§9) does NOT honour `redactor-allow.toml`. Allowlist is redactor-side only. A committed secret fails CI regardless.
- Allowlist changes are visible in `git diff` like any other file. PRs touching `redactor-allow.toml` SHOULD require a security reviewer (documented in `install.md`).

### 4.3 Block-tier exemption — restricted

Allowlist entries for `block`-tier detectors require a `block_override = true` flag and an `expires` ISO date ≤ 30 days from `added_on`. After expiry, the entry is ignored. This prevents permanent block bypasses.

---

## 5. Performance budget

Phase 1 implementation MUST meet these on a typical dev laptop (2024-era M-class or x86_64, single core):

| Metric | Budget | Measurement |
|---|---|---|
| Per-write latency | p99 < 50ms for inputs ≤ 64 KiB | Bench harness in `tests/redactor/bench.{rs,go,ts}` |
| Memory peak | < 5 MiB resident for a single invocation | `/usr/bin/time -l` on macOS, `/usr/bin/time -v` on Linux |
| Cold start | < 30ms (excludes process spawn) | First-call overhead |
| Throughput | ≥ 50 MiB/s for streaming `mask`-tier | Pipe a 100 MiB log through |

The redactor is invoked on every hook write; PRD §6.1.3 budgets all hot-path hooks to < 1s. The redactor must not consume more than 5% of that.

Implementations: a single Go/Rust binary is the reference target. A pure-Node fallback is permitted for the `npx apex init` path on systems without the binary, with a documented 2x latency budget.

---

## 6. Determinism

- Same input bytes + same catalog version + same allowlist → identical output bytes and identical `audit.log` lines (modulo timestamp).
- No locale-dependent regex behaviour (`(?i)` is explicit; `\w` is not used — patterns spell out `[A-Za-z0-9_]`).
- No Unicode normalisation surprises: input is treated as bytes; UTF-8 is required but not normalised.
- The order of audit-log lines MUST be deterministic: byte-offset ascending.
- Timestamps in audit log are UTC ISO 8601 with millisecond precision (`2026-04-26T14:23:11.412Z`); for replay determinism, `--mode=audit` accepts `--ts-fixture=<iso>` to override.

This determinism guarantees that redacted episodes diff cleanly across runs (PRD §5.3 — `git diff` over `.apex/` must be meaningful).

---

## 7. `.apex/audit.log` format

JSONL, one record per match, gitignored. Schema:

```json
{
  "ts": "2026-04-26T14:23:11.412Z",
  "severity": "block",
  "detector": "aws-access-key",
  "source": "episode",
  "target_path": ".apex/episodes/2026-04-26-1422/events.jsonl",
  "offset_range": [1042, 1062],
  "byte_count": 20,
  "catalog_version": "1.3.0",
  "allowlist_suppressed": false
}
```

The audit log NEVER contains the matched value, only its position and length. This prevents the audit log from itself becoming a leak vector (asset A8).

---

## 8. Test fixture corpus (Phase 1 unit tests MUST cover)

| # | Input fixture | Expected detector | Expected severity | Expected output |
|---|---|---|---|---|
| T1 | `My access key is AKIA1234567890ABCDEF and that's it.` | `aws-access-key` | block | empty + exit 10 |
| T2 | `aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` | `aws-secret-key` | block | empty + exit 10 |
| T3 | `Token: ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` (`gh` PAT, 36 b64url chars after `ghp_`) | `gh-pat` | block | empty + exit 10 |
| T4 | `Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4f` | `jwt` | block | empty + exit 10 |
| T5 | A complete 27-line `-----BEGIN OPENSSH PRIVATE KEY-----`…`-----END OPENSSH PRIVATE KEY-----` block embedded in an error message | `pem-private-key` | block | empty + exit 10 |
| T6 | `OPENAI_API_KEY=sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789` | `env-assignment` AND `openai-key` (env-assignment wins by §2.1 ordering) | block | empty + exit 10 |
| T7 | `Connect string: postgres://app:hunter2@db.internal:5432/prod` | `db-url-with-creds` | block | empty + exit 10 |
| T8 | Error message embedding the key: `RuntimeError: invalid signature for AKIA1234567890ABCDEF at line 47` (key inside an error string we want to keep otherwise) | `aws-access-key` | block | empty + exit 10 — entire write rejected (per §3, block is fatal even when context is "interesting") |
| T9 | Two-line split: `{"key": "AKIA12345`\n`67890ABCDEF"}` (an `AKIA…` token wrapped across `\n` mid-string after `AKIA12345`) | `aws-access-key` | block (after line-folding per §2.3) | empty + exit 10 |
| T10 | A 64-char hex commit SHA in a normal log line (`commit abcdef0123…`, entropy ~4.0) | none | none | passthrough unchanged |
| T11 | A 64-char base64url high-entropy token unrelated to any specific format: `Cache-tag: 7f9aQ-_zXyP3kLm4nVbR8sT2uW6oY0iE-jHcD1xZpFgBhMv5lNqUaSrCt9wKeJxA` | `high-entropy-token` | warn (1st occurrence); mask (2nd in same file) | passthrough; on second occurrence in same file replaced with `<REDACTED:high-entropy-token>` |
| T12 | `customer email is alice@bigcorp.com — was bouncing` | `pii-email` | mask | `customer email is <REDACTED:pii-email> — was bouncing` |
| T13 | `version 18.2.0` and `package v1.0.0-beta.1` | (phone heuristic suppression — §3.2) | none | passthrough |
| T14 | Allowlisted literal: input contains `abc123def456abc123def456abc123def456` (matches `high-entropy-token` but is in `redactor-allow.toml`) | none | none (suppressed) | passthrough; audit log records `allowlist_suppressed: true` |
| T15 | Empty input | none | none | empty output, exit 0, no audit-log lines |

Phase 1 MUST also include a property-based test that random non-secret strings of length ≤ 1 KiB never match `block` patterns above a defined false-positive ceiling (target: < 1e-6).

---

## 9. `apex audit` CLI

Spec for the command. Phase 1 implements; Phase 5.5 surfaces in user docs.

### 9.1 Subcommands

```
apex audit                     # default: summary report
apex audit --since=YYYY-MM-DD  # filter audit.log
apex audit --allowlist         # list active allowlist rules and recent suppressions
apex audit --network           # report external network calls (default: zero)
apex audit --redactions        # counts by detector
apex audit --warn              # show every warn-level match for review
apex audit --json              # machine-readable
```

### 9.2 Default human output (mocked sample)

```
APEX audit — 2026-04-26T14:31:22Z
Project: /Users/alice/code/example-app

External network calls (last 30 days):  0
Redactor binary SHA-256:                 OK (matches install.lock)
Catalog version:                         1.3.0

Redactions (last 30 days):
  block   aws-access-key            2   (writes rejected)
  block   gh-pat                    1   (writes rejected)
  mask    pii-email                47
  mask    high-entropy-token        4
  warn    pii-phone                12
  warn    high-entropy-token        9   (1st occurrences)

Warn-level matches awaiting review:     21
  Run `apex audit --warn` to inspect.

Allowlist rules active:                  3
  Run `apex audit --allowlist` to list.

No drift detected since last audit.
```

### 9.3 `--network` output

Lists every outbound network call APEX made (HTTP, DNS for non-localhost, MCP remote). Default install MUST report zero. If the user `apex enable mcp-remote` (Phase 3.3) or hosted sync (Phase 6), those calls appear here, with destination host and call count.

### 9.4 Exit codes

- `0`: clean
- `1`: warn-level matches present that haven't been reviewed
- `2`: block-tier write attempts in window (always exit non-zero — the user should know)
- `3`: redactor binary SHA mismatch (tampering or upgrade — user investigates)

---

## 10. CI lint hook

A separate, *stricter* enforcement at the repo boundary (B3/B4 in threat-model). Phase 1 ships a reference GitHub Actions workflow; the lint logic is identical for any CI.

### 10.1 What it scans

- Every file under `.apex/knowledge/` and `.apex/proposed/` on the diff being pushed.
- Optionally, full repo scan via `apex lint --full` for nightly jobs.

### 10.2 Pattern set

- Same regex catalog as the redactor's `block` tier (§2).
- `mask` and `warn` tiers are NOT enforced by CI lint (they're advisory; CI is binary pass/fail).
- `redactor-allow.toml` IS NOT honoured. CI is stricter than redactor by design.

### 10.3 Behaviour

- On any block-tier match: exit non-zero, fail the build, surface the file path and detector name (NOT the matched value) in the action log.
- The CI step name is stable (`apex-secret-lint`) so branch-protection rules can require it.

### 10.4 Reference workflow snippet

```yaml
# .github/workflows/apex-secret-lint.yml
name: apex-secret-lint
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx apex lint --strict   # exits non-zero on any block-tier match
```

`apex lint` is the same binary as the redactor in catalog-only mode (no allowlist, no audit log writes).

---

## 11. Update path — pattern catalog versioning

The catalog is versioned semver inside the redactor binary and recorded in audit-log entries (§7).

### 11.1 Compatibility rules

- **Patch** (`1.3.0 → 1.3.1`): regex tightened to reduce false positives. Does NOT add new block-tier matches that would have been silent before (i.e. existing knowledge files won't suddenly fail CI on patch upgrade).
- **Minor** (`1.3.0 → 1.4.0`): new detectors added, new severities, allowlist schema additions. May surface new warn/mask matches in existing knowledge — `apex audit` highlights them.
- **Major** (`1.x → 2.0`): block-tier additions that may invalidate existing knowledge files. Phase 1 MUST not ship a major bump without:
  1. A `apex scrub --catalog=2.0 --dry-run` to preview rewrites.
  2. A migration note in the changelog.
  3. CI lint runs against the new catalog only after the user opts in via `.apex/redactor.toml: catalog_version = "2.0"`.

### 11.2 Pinning

`.apex/redactor.toml` MAY pin a catalog version:

```toml
catalog_version = "1.3"   # accept any 1.3.x; reject 1.4.x without explicit upgrade
```

Default (no pin) tracks the installed binary's catalog. `apex upgrade` flags catalog-version changes during plugin upgrades.

### 11.3 Adding a detector

Phase 1 process:
1. Add the detector to the catalog with proposed severity.
2. Add ≥ 3 true-positive fixtures and ≥ 2 known-false-positive fixtures to the test corpus.
3. Run the property-based false-positive test (§8) — must stay under the FP ceiling.
4. Document the detector in this file.
5. Bump catalog version per §11.1 rules.

---

## 12. Cross-references

- Threat model: `threat-model.md` (this is the implementation of §6 mitigations).
- Knowledge linter rule list: `knowledge-schema.md` §11 — overlaps intentionally; the linter and redactor enforce the same `block` set on knowledge writes.
- Episode JSONL writes: `episode-schema.md` (sibling) — every JSONL write is the canonical redactor invocation point.
- Install steps wire the redactor binary, set the pre-commit hook, and write OS-sync exclusion guidance: `install.md` (sibling).
- PRD anchors: §6.0 (phase-0 redactor skill), §6.1.3 (hook latency budget), §6.5 (privacy/redactor scope), §8 (risk register row "secrets leak"), §9 (privacy/security/trust).
