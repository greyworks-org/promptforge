# Data Model — PromptForge Local

Two storage realms, strictly separated:

1. **Central app database** — one SQLite file in the Tauri app data dir
   (`$APPDATA/promptforge/promptforge.db` on macOS:
   `~/Library/Application Support/promptforge/`). This is the **project
   registry and the central project memory**: project records, per-project
   memory records, context-doc metadata, compilation history, outcomes,
   settings. Never contains API keys.
2. **Project folders** — each target project carries a `.promptforge/`
   directory plus `AGENTS.md` / `QWEN.md` / `CLAUDE.md`. This is the
   user-visible, git-able project knowledge. The app DB caches derivable
   metadata about it.

**Provider-neutral state.** There is exactly one project state structure per
project (the memory record below) — shared by Qwen Code, Codex and Claude
Code handoffs alike. QWEN.md/CLAUDE.md in target projects are static
*instruction* files, not state. No provider-specific state files exist
anywhere (invariant §2).

**Source of truth.** Git and the project's actual files are the execution
source of truth. The memory record observes and references repository
reality (checkpoints, changed paths) — it never overrides it (invariant §2).

The task contracts are defined in `schemas/compiler-output.schema.json` and
`schemas/taskspec.schema.json`; semantics in `docs/TASKSPEC.md`.

## 1. App SQLite schema (v1)

Migration files live in `src/db/migrations/` and run in order at startup
(`0001_init.sql`, ...). DDL below is the target of migration `0001`.

### 1.1 `projects`

```sql
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,            -- 'project-<slug>' (client-generated, stable)
  name          TEXT NOT NULL,
  repo_path     TEXT NOT NULL UNIQUE,        -- absolute path to the project root
  current_milestone TEXT,                    -- mirrors .promptforge/context/BACKLOG.md head
  settings_json TEXT NOT NULL DEFAULT '{}',  -- per-project overrides (depth default, etc.)
  created_at    TEXT NOT NULL,               -- ISO-8601
  updated_at    TEXT NOT NULL
);
```

### 1.2 `context_docs`

```sql
CREATE TABLE context_docs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path        TEXT NOT NULL,             -- e.g. '.promptforge/context/DESIGN.md'
  title           TEXT NOT NULL,
  summary         TEXT,                      -- 200–500 token summary (provider-generated)
  tags_json       TEXT NOT NULL DEFAULT '[]',
  task_types_json TEXT NOT NULL DEFAULT '[]',-- task types this doc is relevant to
  content_hash    TEXT NOT NULL,             -- SHA-256 of file content (hex)
  est_tokens      INTEGER NOT NULL,          -- local estimate, clearly labeled as such
  last_scanned_at TEXT NOT NULL,
  UNIQUE (project_id, rel_path)
);
```

Search (Phase 3; availability of FTS5 verified first — fallback is LIKE):

```sql
CREATE VIRTUAL TABLE context_docs_fts USING fts5(
  title, tags, summary, content='context_docs', content_rowid='rowid'
);
```

### 1.3 `compilations`

One row per compile attempt chain (re-runs after blocking-question answers
update the same row until a TaskSpec is produced; "Recompile" creates a new
row linked via `recompile_of`).

```sql
CREATE TABLE compilations (
  id                       TEXT PRIMARY KEY,
  project_id               TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at               TEXT NOT NULL,
  raw_request              TEXT NOT NULL,
  task_type                TEXT NOT NULL,          -- enum, see TASKSPEC.md
  execution_mode           TEXT NOT NULL,          -- quick|standard|deep|review|plan
  target_model             TEXT NOT NULL,          -- model identity (e.g. deepseek-v4-pro)
  agent_runtime            TEXT NOT NULL,          -- claude-code|qwen-code|codex
  execution_profile        TEXT NOT NULL,          -- profile key (e.g. deepseek-v4-pro-claude-code)
  profile_version          TEXT NOT NULL DEFAULT '1.0.0',  -- version of the profile used
  provider_label           TEXT NOT NULL,          -- user-given name of the compiler provider config
  model_id                 TEXT NOT NULL,          -- compiler model used (auditability; not a secret)
  context_doc_ids_json     TEXT NOT NULL DEFAULT '[]',
  context_sent             TEXT NOT NULL,          -- exact redacted text sent (audit trail)
  blocking_rounds          INTEGER NOT NULL DEFAULT 0,
  taskspec_json            TEXT,                   -- NULL until validation succeeds
  prompt_qwen              TEXT,
  prompt_codex             TEXT,
  prompt_claude            TEXT,
  compiler_prompt_tokens   INTEGER,                -- from API usage if provided, else NULL
  compiler_completion_tokens INTEGER,
  compiler_tokens_estimated INTEGER NOT NULL DEFAULT 0, -- 1 if numbers above are estimates
  final_prompt_tokens_est  INTEGER,                -- local estimate of rendered prompts
  duration_ms              INTEGER,
  status                   TEXT NOT NULL,          -- running|awaiting_answers|done|failed
  error                    TEXT,                   -- user-safe message when failed
  recompile_of             TEXT REFERENCES compilations(id)
);
```

### 1.4 `task_outcomes`

Manual success measurement (spec §14). Recorded when the user marks a task
used / rates the result; editable later.

```sql
CREATE TABLE task_outcomes (
  compilation_id    TEXT PRIMARY KEY REFERENCES compilations(id) ON DELETE CASCADE,
  completion_result TEXT NOT NULL,            -- success|partial|failure
  revision_count    INTEGER NOT NULL DEFAULT 0,
  scope_violation   INTEGER,                  -- 0/1/NULL(unknown)
  tests_passed      INTEGER,                  -- 0/1/NULL(unknown)
  completion_time_min INTEGER,
  used_runtime      TEXT,                     -- claude-code|qwen-code|codex (which one actually ran)
  user_note         TEXT,
  recorded_at       TEXT NOT NULL
);
```

### 1.5 `settings`

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,   -- 'provider.active', 'provider.profiles', 'ui.*'
  value TEXT NOT NULL       -- JSON
);
```

Provider profile shape (stored under `provider.profiles`):

```json
{
  "active": "default",
  "profiles": {
    "default": {
      "label": "DeepSeek Flash",
      "baseUrl": "https://…",
      "modelId": "…",
      "keychainAccount": "promptforge/default",
      "capabilities": { "jsonMode": "auto" },
      "params": { "temperature": 0.2, "maxTokens": 4096, "timeoutMs": 60000 }
    }
  }
}
```

The keychain account name is stored; the secret itself never is. Multiple
profiles are structurally supported now (UI may expose only one in MVP);
this is the extension seam for future providers.

### 1.7 `execution_sessions` and `session_events` — Session Core

Migration `0006_execution_sessions.sql` adds the persistent local execution
layer. `execution_sessions` is one provider-neutral session record per task
run; `runtime` selects the current adapter, but `state_json` contains only
canonical task knowledge (objective, completed/pending work, decisions,
blockers, relevant files and checkpoints). `session_events` is append-only
local transcript/checkpoint knowledge. Both tables carry `project_id` and
are deleted with their project; every repository read and write is scoped by
project ID.

Runtime adapters for Claude Code, Codex, Qwen Code and OpenCode render the same
canonical state and recent events into runtime-specific continuation prompts.
Switching runtime updates the session and records a `runtime_switch` event;
it never creates provider-specific state. On startup, active sessions are
reconciled against a live Git snapshot. Repository changes become an
`interrupted` session with a recovery event; unchanged sessions become
`reconciled`. If project memory contains a current persisted TaskSpec but no
session row (for example, work began before Session Core), PromptForge
creates an `external` recovery session without an AI call or filesystem
write. The existing deterministic handoff remains the fallback when no
transcript is available.

Migration `0007_runtime_metadata.sql` adds `runtime_metadata_json` to each
session. It stores an opaque binding (`providerId`, `modelId`, `modelRef`,
`variant`, external runtime session id, detected version and capability names).
PromptForge uses this for display and launch routing; it does not interpret or
replace the canonical TaskSpec/project memory with OpenCode's own session
database.

### 1.6 `project_memory` — the central per-project memory record

One row per registered project (created at onboarding). Provider-neutral:
Qwen, Codex and Claude handoffs all read this same record. Introduced by
migration `0004_project_memory.sql` (Phase 9).

```sql
CREATE TABLE project_memory (
  project_id             TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  stack_json             TEXT NOT NULL DEFAULT '[]',  -- languages/frameworks/services
  current_phase          TEXT,                        -- free text, project-defined
  last_validated_task_id TEXT REFERENCES compilations(id), -- newest task whose validation passed
  current_task_id        TEXT REFERENCES compilations(id), -- task in flight (NULL = idle)
  next_task_json         TEXT,                        -- planned next step (client-authored)
  decisions_json         TEXT NOT NULL DEFAULT '[]',  -- confirmed decisions [{text, at, taskId?}]
  blockers_json          TEXT NOT NULL DEFAULT '[]',  -- unresolved blockers & risks [{text, kind, at}]
  relevant_files_json    TEXT NOT NULL DEFAULT '[]',  -- repo-relative paths in play
  last_test_json         TEXT,                        -- {commands[], results, at}
  base_commit            TEXT,                        -- git checkpoint captured when current task started
  updated_at             TEXT NOT NULL
);
```

Field coverage against the product requirement:

| Required memory content | Where it lives |
| --- | --- |
| Project ID + canonical folder path | `projects.id` + `projects.repo_path` (registry) |
| Name + stack | `projects.name` + `project_memory.stack_json` |
| Current phase | `project_memory.current_phase` |
| Last validated task | `project_memory.last_validated_task_id` → `compilations.taskspec_json` |
| Current + next task | `current_task_id` + `next_task_json` |
| Confirmed decisions | `decisions_json` |
| Unresolved blockers & risks | `blockers_json` |
| Relevant files | `relevant_files_json` |
| Last test commands & results | `last_test_json` |
| Latest git checkpoint | **derived live** (never stored) — §1.7 |
| Uncommitted change summary | **derived live** (never stored) — §1.7 |
| Task & provider history | `compilations` + `task_outcomes` filtered by `project_id` |

### 1.7 Live git state (derived, never stored)

Git is the execution source of truth, so volatile repository state is computed
on every read via the read-only `git_inspect` Rust command (ARCHITECTURE.md
§2.3) and is never cached as truth in any table:

```ts
interface GitSnapshot {
  isRepo: boolean;
  head: { hash: string; subject: string; committedAt: string } | null;
  uncommitted: {
    staged: string[];      // changed paths (names only — never file contents)
    unstaged: string[];
    untracked: string[];
    diffStat: string;      // e.g. "4 files changed, 118 insertions(+), 9 deletions(-)"
  };
  branch: string | null;
}
```

Only allowlisted git commands run (`log -1`, `status --porcelain=v1`,
`diff --stat`, `rev-parse`); metadata only, never blob contents. The memory
record's `base_commit` plus this snapshot let the handoff layer classify
completed / partial / remaining work deterministically (ARCHITECTURE.md §11).

### 1.8 Design tool data (contract — Phase TBD)

Design tool configuration is split into two layers (`docs/DESIGN_TOOL.md` §1):

- **Workspace configuration** — installation-level, stored under a
  `design.workspaces` settings key (same JSON pattern as `provider.profiles`
  in §1.5). Contains connection config, security boundary (`team_id`,
  `folder_id`), action policy, and usage policy. One entry per provider.
- **Project bindings** — per-project table below. Contains only the
  workspace reference and project-specific `approvedFileKeys`.

```sql
CREATE TABLE design_tool_bindings (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL,
  provider        TEXT NOT NULL,
  approved_file_keys_json TEXT NOT NULL DEFAULT '[]',
  scope_verified  INTEGER NOT NULL DEFAULT 0,
  last_scope_verified_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (project_id, provider)
);

CREATE TABLE design_tool_allowlist_audit (
  id              TEXT PRIMARY KEY,
  binding_id      TEXT NOT NULL REFERENCES design_tool_bindings(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  file_key        TEXT NOT NULL,
  source          TEXT NOT NULL,
  reason          TEXT,
  recorded_at     TEXT NOT NULL
);
```

Rules:
- One binding row per project per provider.
- `workspace_id` references the installation-level workspace configuration
  stored in `settings.value` under `design.workspaces.<id>`.
- `approved_file_keys_json` is the **active** (mutable) allowlist. FileKeys
  may be added (via verified scope operations or user action) and revoked
  (user action only).
- `design_tool_allowlist_audit` is an **append-only** audit log. Every
  addition (`action: 'add'`) and revocation (`action: 'revoke'`) is
  recorded with source and timestamp. Rows are never deleted or modified.
- `scope_verified` is set to 1 only after a live API call positively proves
  the project's scope membership; operations are denied while this is 0.
- Security boundary (`team_id`, `folder_id`) is never stored in either
  table — it lives in the workspace configuration only.

See `docs/DESIGN_TOOL.md` §6 for full field semantics and §7 for the
runtime authorization chain.

## 2. Invariants

- Every `context_docs`, `compilations`, `task_outcomes`, `project_memory`,
  `design_tool_bindings`
  row carries (or is keyed by) a `project_id`; no query ever joins across
  projects. Isolation is enforced by construction (repositories take
  `projectId` as a mandatory argument) and covered by explicit isolation
  tests.
- No secret material in any table: keys live in the OS keychain only
  (`docs/SECURITY.md`). `context_sent` stores the **redacted** payload.
- `compiler_tokens_estimated = 1` whenever token numbers are local estimates;
  the UI must label estimates as estimates (spec §14).
- `taskspec_json` is stored only after compiler-output validation, client
  enrichment, and canonical Zod validation all succeed (TASKSPEC.md §1).
- **Provider-neutral state:** one memory record per project, shared by all
  target providers. No Qwen-, Codex- or Claude-specific state structures are
  ever created — in the DB, in `.promptforge/`, or anywhere else.
- **Memory never overrides reality:** git state is derived live (§1.7);
  memory fields that could conflict with the repository (progress, file
  state) are evidence for prompts, never commands over the repo. PromptForge
  performs no git write operations.

## 3. Project folder layout (`.promptforge/`)

```
product-root/
├── .promptforge/
│   ├── project.json          # app-managed anchor: stable project ID + portable metadata (§3.3)
│   ├── context/              # canonical context documents (§3.1)
│   │   ├── PRODUCT.md  ARCHITECTURE.md  DESIGN.md  DATA_MODEL.md
│   │   ├── INTEGRATIONS.md  SECURITY.md  TESTING.md  DECISIONS.md
│   │   ├── CURRENT_STATE.md  BACKLOG.md
│   ├── tasks/                # saved TaskSpecs: TASK-YYYY-NNNN.json
│   ├── assets/               # attachments (post-MVP; folder reserved)
│   └── templates/            # reserved (post-MVP)
├── AGENTS.md                 # shared agent rules
├── QWEN.md                   # Qwen-specific addendum
└── CLAUDE.md                 # Claude-specific addendum (@AGENTS.md)
```

Rules:

- Files under `context/`, plus AGENTS/QWEN/CLAUDE.md, are written **only**
  with user consent (spec §13 consent system). Overwrites require showing a
  diff/preview first.
- `project.json` is app-managed. It is created during consented onboarding
  and kept in sync automatically afterwards (its fields are PromptForge's
  own; it carries no user content).
- `tasks/` files are the exact enriched TaskSpec JSON (canonical-schema-valid).
- The per-folder document registry (hashes, summaries, tags) lives **only**
  in the central DB (`context_docs`); nothing in the project folder
  duplicates it. If the DB is lost, everything is re-derivable by scanning.

### 3.1 Canonical context documents (10)

| File | Content |
| --- | --- |
| PRODUCT.md | Product purpose, value proposition, target users |
| ARCHITECTURE.md | Tech stack, technical structure, architectural decisions |
| DESIGN.md | Visual language, component rules (design system) |
| DATA_MODEL.md | Tables, relations, permissions |
| INTEGRATIONS.md | Stripe, Supabase, email, external APIs |
| SECURITY.md | Security rules and sensitive areas |
| TESTING.md | Test/lint/typecheck commands; environments & deployment notes |
| DECISIONS.md | Taken decisions + hard constraints ("do not touch" areas) |
| CURRENT_STATE.md | What works, what's missing, active problems |
| BACKLOG.md | Planned tasks + current milestone |

### 3.2 Mapping of the spec's 14 project fields

Spec §3 lists 14 fields; §4 defines 10 files. Resolution:

| §3 field | Lives in |
| --- | --- |
| Product | PRODUCT.md |
| Users | PRODUCT.md ("Target users" section) |
| Current State | CURRENT_STATE.md |
| Tech Stack | ARCHITECTURE.md |
| Architecture | ARCHITECTURE.md |
| Design System | DESIGN.md |
| Data Model | DATA_MODEL.md |
| Integrations | INTEGRATIONS.md |
| Decisions | DECISIONS.md |
| Constraints | DECISIONS.md ("Hard constraints" section) |
| Testing | TESTING.md |
| Deployment | TESTING.md ("Environments & deployment" section) |
| Backlog | BACKLOG.md |
| Current Milestone | BACKLOG.md head + `projects.current_milestone` |

### 3.3 `project.json` (app-managed anchor)

Each project may have exactly one `.promptforge/project.json` anchor,
containing **only** the stable project ID and portable metadata — nothing
else:

```json
{
  "schema": "promptforge.anchor/1",
  "projectId": "project-ai-feedback",
  "name": "AI Feedback SaaS",
  "createdAt": "2026-08-05T07:00:00Z"
}
```

Purpose and rules:

- **Stable identity across moves.** If the folder is selected again (moved,
  renamed, re-cloned), PromptForge matches `projectId` against the registry
  and offers to re-associate instead of creating a duplicate project.
- **No state beyond identity.** Memory (decisions, blockers, task chain,
  tests) lives in the central DB (§1.6); doc metadata in `context_docs`.
  The anchor never grows extra fields without a schema bump.
- **One anchor per project, provider-neutral.** There is no QWEN.json,
  codex-state, or CLAUDE-state equivalent — handoffs for all providers key
  off the same `projectId`.
- Written only with onboarding consent; afterwards PromptForge keeps its own
  fields in sync automatically.

## 4. TaskSpec lifecycle states

```
raw provider response (text)
  → JSON extraction & normalization (fences/prose stripped; the 3 client-owned
    keys removed; missing requirements defaulted)
  → compiler-output validation (schemas/compiler-output.schema.json; unknown
    fields rejected; bounded repair ≤ 1 call)
  → client enrichment (task_id, project_id, schema_version, local token estimate)
  → canonical TaskSpec validation (schemas/taskspec.schema.json; must pass)
  → deterministic rendering (three provider prompts)
  → persistence (compilations.taskspec_json [+ tasks/TASK-*.json on save];
    project_memory task-chain pointers advanced)
```

Only canonical (enriched) TaskSpecs are ever stored or rendered. See
`docs/TASKSPEC.md` §1 for the authoritative version of this pipeline.

## 5. Retention & privacy

- All history stays local; there is no retention policy enforcement in MVP
  (data never leaves the machine except as the redacted compile payload).
- Deleting a project in the UI removes app-DB rows (cascade) and offers —
  with separate consent — to remove the `.promptforge/` folder and instruction
  files from the target repo.
