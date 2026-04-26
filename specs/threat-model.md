# Threat Model — APEX

> Phase 0 spec. Source of truth: PRD §6.0, §6.5, §9. Sibling: [`redactor-design.md`](./redactor-design.md), [`knowledge-schema.md`](./knowledge-schema.md), `episode-schema.md`, `install.md`.

This document enumerates what APEX protects, who/what it protects against, what must never enter persisted artifacts, and what is explicitly out of scope. It is the contract that the redactor (Phase 1) and CI lint (Phase 1+) implement.

All dates here are ISO 8601 (`YYYY-MM-DD` / `YYYY-MM-DDTHH:MM:SSZ`).

---

## 1. Assets — what APEX protects

| # | Asset | Where it lives | Why it matters |
|---|---|---|---|
| A1 | Project source code | repo working tree | Contains proprietary logic; APEX writes references (paths, symbols, snippets) into knowledge/episodes |
| A2 | Secrets | `.env`, CI vault, shell env, occasionally pasted into Claude prompts | Catastrophic on leak (cloud takeover, repo compromise, billing abuse) |
| A3 | Proprietary external IP | vendor SDK source, embargoed product names, customer-specific schemas | Contractual / NDA exposure if leaked into committed knowledge |
| A4 | User PII in chat logs | `.apex/episodes/*.jsonl` (gitignored) and reflected proposals | Regulatory (GDPR/CCPA) and trust |
| A5 | Customer data in dev fixtures | test seeds, replay traces, staging dumps | Same as A4 plus contractual |
| A6 | The user's broader system | files outside the repo, ~/.ssh, ~/.aws, env vars | APEX runs locally with the user's permissions; misuse could exfiltrate beyond the repo |
| A7 | Knowledge integrity | `.apex/knowledge/**` | A poisoned entry mis-steers Claude on every future session — this is a code-execution-equivalent risk |
| A8 | Audit trail | `.apex/audit.log` (gitignored) | Detects past leaks; itself must not contain the secrets it detected |

A1, A3, A4, A5 are confidentiality assets. A7 is integrity. A2 and A6 are both. A8 is integrity + confidentiality (it must record *that* a secret was caught without re-leaking the secret).

---

## 2. Trust boundaries

Data crosses these zones; the redactor and gitignore policy enforce each crossing.

```
┌─ Local FS (repo) ──────────────────────────────────────────────────┐
│                                                                    │
│  source code, .env  ──[APEX hooks]──►  .apex/episodes/  (gitignored│
│        (B1)                                  (B2)        — local)  │
│                                                │                   │
│                                          [reflector]               │
│                                                ▼                   │
│                                          .apex/knowledge/  ────────┼──► git remote ──► teammates
│                                                (B3)                │       (B4)         (B5)
└────────────────────────────────────────────────────────────────────┘
                                                                  │
                                                            [Backup/sync]
                                                                  ▼
                                                            iCloud / Dropbox / Time Machine (B6)
```

| ID | Boundary | Crossing artifact | Control |
|---|---|---|---|
| B1 | source code, env, chat → episodes | every `PostToolUse`, `UserPromptSubmit`, etc. write | **redactor** (mandatory, stdin→stdout filter) |
| B2 | episodes → knowledge | reflector subagent proposes entries | **redactor** runs again on write; reflector MUST cite evidence (PRD §6.2.1); proposals land in `.apex/proposed/` for review |
| B3 | knowledge → working tree commit | `git add .apex/knowledge/` | **CI lint** (Phase 1) blocks commits containing block-tier patterns |
| B4 | working tree → git remote | `git push` | **CI lint on remote** (server-side workflow); secret-scanning on platform side as defense-in-depth |
| B5 | remote → teammate clone | `git pull` | The teammate is a trusted peer (see §7); they inherit whatever shipped through B3+B4 |
| B6 | repo dir → backup/sync | OS-level | **gitignore policy** keeps episodes/index out of commits, but does NOT stop Dropbox/Time Machine from copying them. Documented limitation; mitigation in §5 |

The redactor sits at B1 and B2. CI lint is the second wall at B3/B4. There is no in-process control at B5 or B6 — these rely on policy and prior boundaries holding.

---

## 3. Threat actors

Concrete scenarios, not abstract categories. Each has a referenced control in §6.

### TA1 — Curious teammate browsing committed `.apex/knowledge/`
A teammate clones the repo and `grep`s `.apex/knowledge/` for "password", "key", "AKIA". They have legitimate repo access; the question is whether knowledge should ever surface a secret to them. **No.** Even though they could `git log -p` to find anything, knowledge files are read by Claude into model context and pasted into PRs — they reach a wider audience than raw code. Treat as zero-tolerance for block-tier patterns.

### TA2 — Malicious dependency / supply-chain
An installed package (or a future APEX plugin pack) ships a CLI flag, env var, or config option that quietly disables redaction (e.g. `APEX_REDACT=off`, `--no-redact`, `redactor.enabled = false`). **The redactor MUST NOT have a global off switch.** Allowlisting specific patterns per-project is permitted (§5 of redactor-design); turning the redactor off entirely is not.

### TA3 — Compromised Claude Code session writing through APEX hooks
A prompt-injection attack convinces Claude to write a secret it has in context (e.g. a token from `.env` it `Read` earlier) into `.apex/knowledge/notes.md` via the `Write` tool. The hook chain still runs the redactor on the write; redactor catches it. If redactor misses, CI lint catches at B3. If both miss, post-hoc `apex audit` + `apex scrub` is the recovery path (§5).

### TA4 — Backup/sync tool silently exfiltrating gitignored episodes
Dropbox, Google Drive, iCloud Drive, or Time Machine indexes the user's repo dir. `.apex/episodes/` is gitignored but NOT excluded from these tools. A leaked episode could contain redactor-missed secrets. Mitigation: redactor runs on write (so the on-disk file is already redacted), AND the install docs (`install.md`) recommend adding `.apex/episodes/` and `.apex/index/` to OS-level sync exclusions on Dropbox/iCloud paths.

### TA5 — Future maintainer / new team member with broad fs access
Someone joins the team six months in, runs `apex search "auth"`, and sees a knowledge entry that quotes a stale token from a long-rotated key. The token was rotated, but it should never have been on disk in the first place. Same control as TA1: redactor at write time + CI lint + `apex scrub` for retroactive cleanup.

### TA6 — Accidental commit by the user themselves
The most likely actor. User runs `git add .` after a session where the redactor missed a pattern. Pre-commit hook (optional, recommended in `install.md`) runs the same lint as CI. Backstop is CI lint blocking the PR. If it slips to `main`: documented secret-rotation runbook (§5).

### TA7 — Replay/eval traces leaking
The eval harness (Phase 4) replays recorded sessions. Recorded prompts may contain secrets the user typed. Eval recordings live under `.apex/episodes/replay/`, are gitignored, AND must pass the redactor on capture.

---

## 4. Data classification — what may, must not, may-with-caveats enter knowledge / episodes

### 4.1 MUST NEVER enter (block tier)

The redactor's `block` mode refuses the write entirely. Categories with examples:

| Category | Concrete examples |
|---|---|
| AWS credentials | `AKIA[0-9A-Z]{16}` access keys; 40-char base64 secret keys; session tokens; `aws_access_key_id =` lines from `~/.aws/credentials` |
| Cloud provider keys | GCP service-account JSON blobs; Azure SAS tokens; DigitalOcean PATs |
| GitHub / GitLab / Bitbucket tokens | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` (GitHub); `glpat-` (GitLab); `BBDC-`/`ATBB` Bitbucket app passwords |
| Chat / webhook tokens | Slack `xoxb-`/`xoxp-`/`xoxa-`/`xoxr-`/`xoxs-`; Discord bot tokens; Slack/Discord/Teams incoming-webhook URLs |
| LLM provider keys | OpenAI `sk-...`; Anthropic `sk-ant-...`; Cohere/Mistral/Together keys |
| JWTs | `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` (full three-segment form) |
| Private keys | PEM `-----BEGIN (RSA \| EC \| DSA \| OPENSSH \| PRIVATE) KEY-----` blocks; OpenSSH `-----BEGIN OPENSSH PRIVATE KEY-----`; PGP private blocks |
| `.env`-style assignments | Any line where the LHS matches `(?i)(secret\|token\|key\|password\|passwd\|api_?key\|auth)\b` and the RHS is ≥ 8 non-whitespace chars |
| Database URLs with creds | `postgres://user:pass@host/db`, `mongodb+srv://user:pass@…`, `redis://:pass@…` — any URL with userinfo |
| Stripe / payment keys | `sk_live_…`, `pk_live_…`, `rk_live_…`, `whsec_…` |
| Generic high-entropy strings | Any token-shaped string ≥ 32 chars with Shannon entropy ≥ 4.5 bits/char that does not match an allowlist (§5 of redactor) |

### 4.2 MUST NOT enter (policy tier — block by default, allowlistable)

| Category | Why fuzzy | Default action |
|---|---|---|
| **PII**: emails, full names, phone numbers, postal addresses, government IDs | Distinguishing "John Smith the contributor" (fine, in `git log`) from "John Smith the customer in test fixture" (not fine) requires context the regex doesn't have | `mask` by default for emails outside well-known no-reply patterns; `warn` for phone/name patterns; user can promote to `block` per project |
| **Proprietary external IP**: vendor SDK source pasted into chat, embargoed unreleased product names | Cannot detect without project-specific allow/deny list | `warn` only; rely on user-defined denylist in `.apex/redactor-deny.toml` |
| **Customer data in dev fixtures**: real names/emails/SSNs that snuck into seed files | Same as PII | Same as PII; covered by the broader PII rules |

### 4.3 MAY enter — with caveats

| Category | Caveat |
|---|---|
| File paths | Paths are public within the repo. Absolute paths leaking the user's home dir (`/Users/<name>/...`) should be normalised to repo-relative on episode write |
| Commit SHAs | Public within the repo |
| Function / class / symbol names | Public within the repo |
| Error messages | Allowed AFTER passing the redactor — many error messages embed secrets (e.g. `connection refused: postgres://user:pass@…`) |
| Test stack traces | Same as error messages |
| User prompts | Allowed after redaction; `UserPromptSubmit` hook MUST pipe through redactor before episode append |
| Tool exit codes / command lines | Allowed; redactor strips secrets from arg lists (e.g. `curl -H "Authorization: Bearer …"`) |
| Quoted snippets from project source | Allowed; the source is already in the repo. Snippets ≤ 40 lines per knowledge entry to keep entries focused (`knowledge-schema.md` enforces 16 KiB total file cap) |

---

## 5. Failure modes & recovery

### 5.1 Redactor misses a block-tier pattern at write time
- **Detection**: post-hoc `apex audit` scans existing `.apex/episodes/` and `.apex/knowledge/` against the *current* pattern catalog (which may have been updated since the file was written; see redactor §update-path).
- **Recovery**: `apex scrub` rewrites offending files in place, replacing matches with `<REDACTED:type>`. Logs every rewrite to `.apex/audit.log`. For knowledge entries, `apex scrub` also bumps `last_validated` and adds an audit-source entry.

### 5.2 Redactor + CI lint both miss; secret committed to `.apex/knowledge/`
1. **Rotate immediately.** Treat the secret as compromised — it is in git history forever, even if removed from HEAD.
2. **Rewrite history** (optional, advisory). Document the `git filter-repo` / `git filter-branch` recipe in `install.md` security section. History rewrite is destructive and team-coordinated; do not auto-run.
3. **File `apex audit` report** for the incident — captures pattern that should have caught it; feed back into pattern catalog updates.

### 5.3 Teammate's branch carries a leak that hasn't merged yet
- **CI lint fails the PR build** (block tier patterns; same set as redactor `block`, with a *stricter* allowlist policy — see redactor-design §CI lint).
- The PR can't merge until the secret is removed AND rotated.

### 5.4 Allowlist abuse (TA2 vector)
- Allowlist entries (`.apex/redactor-allow.toml`) are themselves auditable: `apex audit --allowlist` lists every active allowlist rule with the SHA of the file and last-modified date.
- CI lint refuses to honor allowlist for block-tier patterns — the allowlist is redactor-side only. A committed secret fails CI regardless of `redactor-allow.toml`.

### 5.5 Pattern catalog drift
- Catalog is versioned (semver). Knowledge entries record the catalog version at write time inside `.apex/audit.log` (not the entry itself). When catalog updates add patterns, `apex audit` re-scans against the new set.

### 5.6 Reflector poisons knowledge with a fabricated lesson (TA3 / integrity)
- Reflector outputs land in `.apex/proposed/`, never directly in `.apex/knowledge/` (PRD §6.2.1). Auto-merge requires ≥ 2 observations and no conflicting entry (PRD §6.2.2).
- Every entry's `sources[]` MUST cite at least one episode/PR/file ref (`knowledge-schema.md` §sources). Linter rejects empty sources.

---

## 6. Mitigations matrix

| Threat | Control(s) | Enforced by |
|---|---|---|
| TA1 curious teammate | Block-tier patterns never reach disk; CI lint catches if they did | redactor; CI lint |
| TA2 supply-chain redactor disable | No global off-switch; allowlist is per-pattern, audited | redactor design (no `enabled=false` config key); `apex audit --allowlist` |
| TA3 compromised session writes secret | Redactor runs on every `.apex/` write; stdin→stdout filter wired into every hook | hook templates (`install.md`); redactor binary |
| TA4 backup/sync exfil | Redactor runs at write time so on-disk files already redacted; install docs recommend OS-sync excludes | redactor; `install.md` |
| TA5 future maintainer access | Same as TA1 — files are already redacted | redactor; CI lint; `apex scrub` for retroactive cleanup |
| TA6 user accidental commit | Pre-commit hook (optional but recommended) runs same lint as CI | `install.md` (pre-commit) ; CI lint (mandatory backstop) |
| TA7 eval/replay leak | Replay capture pipes through redactor on record | eval harness (Phase 4) using shared redactor |
| Reflector hallucination poisoning knowledge (A7) | Two-call separation; mandatory `sources[]`; proposals routed to `.apex/proposed/` | reflector subagent (Phase 2.1); knowledge linter |
| Knowledge entry contradicts reality | Drift detector + `last_validated` + `verified` flag | curator subagent (Phase 4.3) |
| `apex audit` log itself leaking | `audit.log` records pattern-name + offset, NOT the matched value | redactor design §audit-log format |

---

## 7. Trust assumptions

These are the people/components APEX trusts at the same level the surrounding system already trusts them. APEX does not attempt to defend against insiders.

- **The user.** Has full read/write access to the repo and their machine. APEX inherits whatever permissions Claude Code was granted.
- **Claude Code itself.** APEX uses only documented Claude Code primitives (hooks, skills, subagents, MCP). If Claude Code is compromised, APEX cannot defend the repo.
- **Teammates with repo write access.** Trusted at the same level git already trusts them. If they can `git push` to a protected branch, they can poison knowledge through that path; branch protection + code review is the control, not APEX.
- **The local filesystem.** APEX reads and writes within the repo and the gitignored `.apex/` subtree only. Filesystem integrity is assumed.
- **The redactor binary itself.** Phase 1 ships a deterministic, tested, reviewable redactor. Tampering with the redactor source is an insider attack and is out of scope (§8).

---

## 8. Out of scope — what APEX explicitly does NOT defend against

Documented to prevent over-promising.

- **Compromised dev machine.** If an attacker has shell on the user's box, they can read `.env`, `~/.aws/`, `~/.ssh/`, and the source tree directly — APEX is not a sandbox.
- **Malicious user.** A user determined to leak secrets can paste them into a knowledge file and override the redactor's allowlist. APEX is not a DLP product against the operator.
- **Claude itself going rogue and writing through MCP.** APEX uses Claude's MCP/tool surface; if Claude (the model) is compromised, the redactor at write time is the last line of defense, but a determined adversary at the model layer is out of scope. We rely on the redactor catching obvious patterns, not on Claude being untrusted.
- **Network-level attackers.** Default mode is local-only. `apex audit` proves zero external calls. If/when a hosted sync option ships (PRD §6.6 / Phase 6), it is opt-in and out of this v1 threat model.
- **Hardware / supply-chain attacks below the OS.** Not a software-policy problem.
- **Information leakage through metadata.** File mtimes, commit timestamps, entry IDs revealing a teammate's working hours or feature timing — not protected. Repos already leak this.
- **Prompt-injection of the model into ignoring the redactor.** Prompt-injection that tricks Claude into pasting a secret into knowledge is in scope (§TA3) — redactor catches at write. Prompt-injection that tricks Claude into bypassing the hook chain entirely (e.g. shelling out to `cat > .apex/knowledge/foo.md` outside the hook framework) is out of scope: Claude Code's hook contract is assumed to be honored. Sandbox/permission policy on the user side is the control.

---

## 9. Cross-references

- Redactor implementation contract — `redactor-design.md`
- Knowledge entry validation rules (incl. the in-line redactor rule list duplicated for linter use) — `knowledge-schema.md` §11
- Episode JSONL write integration point — `episode-schema.md` (sibling)
- Install steps including pre-commit hook + OS-sync exclusion guidance — `install.md` (sibling)
- PRD references: §4 architecture, §6.0 phase 0 deliverables, §6.5 phase 5 privacy, §8 risk register, §9 privacy/security/trust principles.
