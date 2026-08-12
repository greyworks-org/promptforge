# Architecture — PromptForge Local

Status: **planning foundation** (no implementation yet). This document is the
authoritative engineering interpretation of `PRODUCT_SPEC.md`. Where this
document and the spec disagree, the disagreement is intentional and listed in
§8 "Corrections and deviations from the product spec".

## 1. Design principles

1. **One neutral contract, profile-adapted rendering.** The model produces exactly
   one TaskSpec JSON per compilation. Runtime-specific prompts are deterministic
   renderings shaped by a declarative execution profile — the profile adapts
   working style (planning depth, exploration, test strategy) but never task
   meaning. The same TaskSpec with different profiles produces different HOW,
   identical WHAT.
2. **Local-first.** Everything the product knows lives in two places: the app
   SQLite database (app data dir) and each project's `.promptforge/` folder.
   The only network traffic is the provider API call.
3. **Security gate before the wire.** Nothing reaches the provider API without
   passing the redaction layer. The user can always inspect exactly what will
   be sent ("Context sent" view).
4. **Minimal Rust.** Business logic is TypeScript. Rust provides only the
   capabilities the webview cannot: keychain, authenticated HTTP, native
   shell/terminal, file dialogs.
5. **No silent failures.** Invalid model output → one repair attempt → loud,
   user-visible error. The system never fabricates a TaskSpec.
6. **Consent at every write boundary.** PromptForge writes into user
   repositories only after explicit confirmation, and never overwrites
   existing files without showing what would change.

## 2. Layer overview

PromptForge is organized around **three product capabilities**, all operating
on the same per-project state:

1. **Prompt Compiler** — transforms an informal request into a concise,
   scoped, verifiable task (canonical TaskSpec) using only the relevant
   project context. Pipeline: §3.
2. **Project Memory** — maintains the latest state of every registered
   development project locally, in one central SQLite database: identity,
   stack, phase, task chain, decisions, blockers, relevant files, test
   results, git checkpoint references. Git and the project files remain the
   execution source of truth; memory observes, never overrides. Design: §11.
3. **Agent Handoff** — lets any registered project continue through any
   supported agent runtime (Claude Code, Qwen Code, Codex) from the same
   shared state: deterministic, model-free continuation prompts built from
   memory + live git snapshot + current task. Design: §11.

```
┌─────────────────────────────────────────────────────────────────────┐
│ UI (React + TS)                                                     │
│  Projects · Onboarding · Compiler · Result · History · Handoff ·    │
│  Settings                                                           │
├─────────────────────────────────────────────────────────────────────┤
│ Application services (TypeScript, src/)                             │
│  compilePipeline · contextService · redaction · renderers ·         │
│  historyService · settingsService · memoryService · gitState ·      │
│  handoffService (+ handoff renderers)                               │
├─────────────────────────────────────────────────────────────────────┤
│ Data layer                                                          │
│  Central SQLite via tauri-plugin-sql (registry + project memory +   │
│  history) · repository modules · SQL migrations                     │
│  .promptforge/ project folders (markdown + TaskSpec files + anchor) │
├─────────────────────────────────────────────────────────────────────┤
│ Rust bridge (src-tauri/, minimal)                                   │
│  keychain commands · provider_http command · git_inspect command ·  │
│  shell/terminal · dialog wrappers                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 UI layer

Screens map 1:1 to spec §9: **Projects**, **Project onboarding wizard**,
**Compiler**, **Result**, **History**, **Settings**. React components with
shadcn/ui primitives, Tailwind styling. No business logic in components —
they call application services.

### 2.2 Application services (TypeScript)

| Service | Responsibility |
| --- | --- |
| `compilePipeline` | Orchestrates: context assembly → redaction → provider call → parse → validate → repair → enrich → render. Implements the retry state machine from spec §6. |
| `contextService` | Document registry (hash, estimated tokens, summaries, tags), context auto-suggestion by task type, budget enforcement (spec §11). |
| `redaction` | Pure, unit-tested redaction engine: blocked-file filter + secret pattern detection + redaction report (spec §13). See `docs/SECURITY.md`. |
| `renderers` | `renderClaudeCode`, `renderQwenCode`, `renderCodex`: pure functions (TaskSpec, ExecutionProfile) → markdown prompt. Profiles adapt working style only (§5). |
| `historyService` | Records compilations and outcomes, aggregates usage (spec §14). |
| `settingsService` | Non-secret app settings in SQLite; provider credentials routed to keychain via Rust. |
| `checklist` | Derives the Result-screen verification checklist **from the TaskSpec itself** — never a model-issued score (spec §9). |
| `memoryService` | Reads/updates the per-project memory record (§11): phase, task chain, decisions, blockers, relevant files, last tests. Strictly project-scoped. |
| `gitState` | Assembles live `GitSnapshot`s through the Rust `git_inspect` command; never caches git truth, never writes to the repo. |
| `handoffService` | Builds a `HandoffSnapshot` (memory + git snapshot + current TaskSpec) and runs the deterministic handoff renderers (§11). Zero provider calls. |

### 2.3 Rust bridge — exact surface

The Rust side exposes only these Tauri commands; anything else is TypeScript:

| Command | Purpose | Why Rust |
| --- | --- | --- |
| `keychain_set(account, secret)` | Store provider API key | OS keychain APIs |
| `keychain_get(account)` | Retrieve key for HTTP auth | Key must never enter webview JS memory |
| `keychain_delete(account)` | Remove key | Symmetry |
| `provider_chat(request)` | Perform the provider HTTP call (see `DEEPSEEK_INTEGRATION.md`), return raw body + status + timing | Reads the key in Rust, attaches `Authorization` there; avoids CORS limits of the webview; keeps the key out of the frontend entirely |
| `git_inspect(repo_path)` | Run the allowlisted read-only git commands (`log -1`, `status --porcelain=v1`, `diff --stat`, `rev-parse`) and return a structured `GitSnapshot` (DATA_MODEL.md §1.7) | Keeps process spawn out of the webview; allowlist guarantees read-only, metadata-only inspection |
| `open_terminal(path)` | Open a terminal at a project folder | Native shell |
| `launch_cli(command_id, args)` | Launch a configured CLI binary (with consent) | Native process spawn, allowlist-controlled |

Filesystem access (reading/writing `.promptforge/`, AGENTS/QWEN/CLAUDE.md)
uses `tauri-plugin-fs` with runtime directory scopes granted per project, so
the app can only touch folders the user explicitly selected. This choice is
verified in Phase 3 (risk register, §7).

### 2.4 Data layer

SQLite through `tauri-plugin-sql` with numbered SQL migration files executed
at startup. Access is wrapped in small repository modules
(`projects`, `contextDocs`, `compilations`, `outcomes`, `settings`).
Repositories accept a `QueryRunner` interface so unit tests can run against
an in-process SQLite (better-sqlite3) while production uses the plugin —
same SQL dialect, no webview needed in tests. Full schema in
`docs/DATA_MODEL.md`.

Project knowledge (markdown context docs, saved TaskSpecs) lives in each
project's `.promptforge/` folder, so it is portable and version-controllable
by the user. The app DB caches metadata (hashes, summaries, history) and is
re-derivable from the files where marked as such.

## 3. Compile pipeline (sequence)

```
User request + selected context docs
  → budget check (est. tokens ≤ mode budget)
  → redaction (blocklist + patterns) ── user inspects "Context sent"
  → payload assembly (system prompt embeds the COMPILER-OUTPUT schema + user content)
  → provider_chat (Rust) ── Deep mode: 2 calls (compiler, then critic)
  → JSON extraction & normalization (fences/prose; strip the 3 client-owned
     keys; default missing requirements)
  → Zod-validate against compiler-output schema (unknown fields REJECTED)
      ├─ valid   → continue
      └─ invalid → BOUNDED repair: exactly ONE repair call → validate again
            ├─ valid   → continue
            └─ invalid → user-visible error, nothing stored as a result
  → enrich (task_id, project_id, schema_version, local token estimate)
  → canonical TaskSpec validation (must pass; assert — client bug otherwise)
  → profile-aware renderers produce runtime-specific prompts
  → Result screen (tabs + checklist) → save compilation record
  → project memory task-chain updated (current task pointer)
```

The two-contract split (TASKSPEC.md §1) is what keeps model output and
client-owned identity strictly separate: the model can never mint task or
project identifiers.

Blocking questions returned by the model are shown to the user; answers are
appended to the request and the pipeline re-runs (counts as the same
compilation attempt chain, capped to avoid loops — max 2 question rounds).

## 4. Provider abstraction

```ts
interface ProviderConfig {
  baseUrl: string;      // e.g. https://api.example.com/v1  (user-set)
  modelId: string;      // never hardcoded; validated non-empty
  // apiKey intentionally absent here — it lives only in the keychain
  capabilities: { jsonMode: 'auto' | 'on' | 'off' };
  params: {
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'maximum';
  };
}
```

A single concrete provider transport is implemented for the MVP. It preserves
the legacy compatible request shape for existing endpoints and selects the
modern Chat Completions fields for the official OpenAI endpoint (`api.openai.com`):
`max_completion_tokens`, optional `reasoning_effort`, and no non-default
temperature. When reasoning is requested, the transport reserves an equal
bounded completion allowance because OpenAI counts hidden reasoning tokens in
that field. This is a request-shape compatibility branch, not a second
provider subsystem. Model names, URLs and auth are configuration, never code
constants (spec: "Model adı kodda sabitlenmemeli"). Details and all
assumptions about the endpoint contract are in `docs/DEEPSEEK_INTEGRATION.md`.

## 5. Renderer design

Renderers are pure functions over a validated TaskSpec and an execution profile:

```ts
type Renderer = (task: TaskSpec, profile: ExecutionProfile) => string;
```

The `agent_runtime` field selects the renderer family; the `execution_profile`
field selects the working-style parameters. Both are part of the TaskSpec
(schemas § target_model / agent_runtime / execution_profile).

### Runtime-specific renderer families

- **claude-code** renderer: plan-first, risk and edge-case emphasis, stop
  conditions, reads CLAUDE.md + AGENTS.md, `@AGENTS.md` in CLAUDE.md.
- **qwen-code** renderer: explicit step structure, `Read first` section with
  `.promptforge/context/...` paths, targeted-test execution rules, reads
  QWEN.md + AGENTS.md.
- **codex** renderer: outcome-first, constraints, report list, reads
  AGENTS.md.

### Execution profiles

Profiles are declarative records that adapt **how** the agent works —
never what the task means. The same TaskSpec rendered with different
profiles produces different working instructions, identical scope.

Every profile is versioned (`profile_version`). Historical compilation
records include the profile version so past runs remain reproducible even
when profile defaults change.

| Parameter | Type | Description |
| --- | --- | --- |
| `planning_depth` | `"minimal" \| "standard" \| "thorough"` | Pre-execution planning depth |
| `exploration_budget` | `"low" \| "medium" \| "high"` | Codebase exploration before acting |
| `context_reuse` | `"conservative" \| "balanced" \| "aggressive"` | Context retention between turns |
| `reasoning_effort` | `"low" \| "medium" \| "high" \| "maximum"` | Model reasoning depth |
| `test_strategy` | `"none" \| "targeted" \| "full-suite"` | Tests to run during implementation (each change) |
| `final_validation` | `"none" \| "quick" \| "full-gate"` | Validation to run once at completion |
| `retry_budget` | `integer` | Max retries before escalating |
| `progress_verbosity` | `"minimal" \| "normal" \| "detailed"` | Progress output level |
| `autonomy` | `"low" \| "medium" \| "high"` | Independent action level |
| `guardrail_strength` | `"relaxed" \| "standard" \| "strict"` | Stop-before-risk aggressiveness |

`test_strategy` governs what the agent runs after each change during
implementation (none / targeted unit tests / the full suite). `final_validation`
governs the one-time gate at completion (none / a quick smoke check / the
full typecheck + lint + test + build gauntlet). They are separate because a
profile that runs targeted tests while iterating may still demand a full
gate before declaring the task done.

### Profile registry & compatibility

Each profile definition binds a `target_model` + `agent_runtime` pair.
The profile registry (a typed constant map in `src/profiles/`, Phase 6)
validates at compile time that the model, runtime, and profile are
compatible. Custom profiles can be added to the registry; the only
constraint is that every profile must declare its model and runtime.

```ts
// Illustrative shape — implementation in Phase 6.
interface ExecutionProfile {
  profile_id: string;
  profile_version: string;
  target_model: string;
  agent_runtime: 'claude-code' | 'qwen-code' | 'codex';
  planning_depth: 'minimal' | 'standard' | 'thorough';
  exploration_budget: 'low' | 'medium' | 'high';
  context_reuse: 'conservative' | 'balanced' | 'aggressive';
  reasoning_effort: 'low' | 'medium' | 'high' | 'maximum';
  test_strategy: 'none' | 'targeted' | 'full-suite';
  final_validation: 'none' | 'quick' | 'full-gate';
  retry_budget: number;
  progress_verbosity: 'minimal' | 'normal' | 'detailed';
  autonomy: 'low' | 'medium' | 'high';
  guardrail_strength: 'relaxed' | 'standard' | 'strict';
}
```

### Canonical profiles (v1)

| Profile ID | target_model | agent_runtime | Style (planning / exploration / context / reasoning / test / final / retry / verbosity / autonomy / guardrail) |
| --- | --- | --- | --- |
| `deepseek-v4-pro-claude-code` | deepseek-v4-pro | claude-code | standard / low / aggressive / high / targeted / full-gate / 2 / minimal / high / strict |
| `qwen-3.8-max-qwen-code` | qwen-3.8-max | qwen-code | standard / medium / balanced / high / targeted / quick / 2 / normal / medium / standard |
| `gpt-5.6-sol-high-codex` | gpt-5.6-sol | codex | minimal / low / conservative / medium / targeted / quick / 1 / normal / medium / standard |
| `opus-5-high-claude-code` | opus-5 | claude-code | thorough / high / aggressive / high / full-suite / full-gate / 3 / detailed / high / strict |

Profile definitions live in `src/profiles/` as typed constants (Phase 6).
The compiler model selects `target_model`, `agent_runtime`, and
`execution_profile` during compilation. The client validates the triple
against the profile registry before accepting the model output. The
renderer reads the profile and adapts prompt structure, not content.

### Rendering rules

- Shared helper for requirement/context sections; each runtime family keeps
  its own section order and wording.
- Snapshot tests (golden files) lock the output per (TaskSpec, profile) pair;
  changes to templates are deliberate diffs.
- Every compilation row records `profile_version` alongside
  `execution_profile` so historical runs remain reproducible even when the
  canonical profile definition is updated.

### Handoff renderers

A second renderer family produces **continuation prompts** from a
`HandoffSnapshot` (§11): `renderHandoffClaudeCode`, `renderHandoffQwenCode`,
`renderHandoffCodex`. Same rules as above — pure, deterministic,
snapshot-tested, profile-aware — with two additions: they must stay short
(hard token budget) and they must never require a model call: continuation
is assembled entirely from local state.

## 6. Capability matrix (required features → where they live)

| Requirement | Component(s) |
| --- | --- |
| Multiple isolated projects | `projects` registry + per-project `.promptforge/` + project-scoped queries only + isolation test suite |
| Local-first storage | Central SQLite DB + project markdown files; network = provider calls only |
| Configurable model ID / base URL / API key | Settings UI → SQLite (non-secret) + keychain (secret) + `ProviderConfig` |
| Runtime-specific renderers | `src/renderers/*` (pure functions parameterized by execution profiles, snapshot-tested per profile) |
| Secret redaction | `src/redaction/*` + "Context sent" view (`docs/SECURITY.md`) |
| Context selection | `contextService` (hashes, tags, FTS5, task-type heuristics, budgets) |
| Prompt history | `compilations` + `outcomes` tables, History screen |
| Usage & success measurement | Token capture from responses (+ local estimates), manual outcome recording, per-project/provider aggregates |
| Future provider additions | `ProviderConfig` + transport/renderer extension point (§4) |
| Project registry | `projects` table (unique path, stable id) + `.promptforge/project.json` anchor re-linking (DATA_MODEL.md §3.3) |
| Central project memory | `project_memory` record per project (DATA_MODEL.md §1.6) + `memoryService` (§11) |
| Git state inspection | Rust `git_inspect` (read-only allowlist) + live `GitSnapshot` (DATA_MODEL.md §1.7) |
| Interrupted-task recovery | Handoff recovery section from uncommitted-change evidence (§11.4) |
| Qwen / Codex / Claude handoff | `handoffService` + handoff renderers (§11) — deterministic, zero model calls |
| Design tool integration | `DesignToolProfile` + scope registry + billing guard (contract only — `docs/DESIGN_TOOL.md`) |

## 7. Stack confirmation, challenges and risk register

Confirmed as proposed in the spec: **Tauri 2, React, TypeScript, Vite,
Tailwind CSS, shadcn/ui, SQLite, Zod + JSON Schema, macOS Keychain,
.dmg packaging, configurable DeepSeek-compatible provider.**

| # | Item | Decision / finding | Type |
| --- | --- | --- | --- |
| R1 | **Drizzle ORM** (spec: "Drizzle veya Tauri SQL plugin") | **Challenged → dropped for MVP.** Drizzle needs a Node driver; the webview has none — `tauri-plugin-sql` is not a Drizzle driver. Using both would split the stack. Decision: `tauri-plugin-sql` + hand-written SQL migrations + repository modules + Zod row validation. Revisit only if schema complexity grows. | Correction |
| R2 | API calls "Rust üzerinden reqwest" | Confirmed, sharpened: the call happens inside a dedicated `provider_chat` Tauri command so the API key never enters webview memory (spec's Keychain requirement implies this boundary). | Decision |
| R3 | **FTS5 availability** in the SQLite bundled with `tauri-plugin-sql` | Unverified assumption. Phase 3 starts with a spike test; fallback is LIKE-based search behind the same interface. | Risk |
| R4 | Token counting | No reliable DeepSeek tokenizer for JS is assumed available. MVP uses a character-based estimator (≈ chars/4), clearly labeled as estimate everywhere. Spec allows "yaklaşık sayaç". | Decision |
| R5 | `tauri-plugin-fs` runtime scopes | Adding per-project directory scopes at runtime must be verified (Phase 3). Fallback: proxied fs through Rust commands. | Risk |
| R6 | JSON mode can return empty content | Accepted (officially documented behavior). Mitigation: strip→validate→one repair call→loud error. | Risk (mitigated) |
| R7 | Deep mode latency (2 sequential calls) | Acceptable; UI shows per-call status. No streaming in MVP (keeps transport simple). | Decision |
| R8 | macOS-only packaging (.dmg) | MVP is developed and tested on macOS; Tauri keeps Windows/Linux possible later. | Assumption |
| R9 | Clipboard/terminal/CLI | `tauri-plugin-clipboard-manager`, `tauri-plugin-shell`; CLI paths are user-configured, binaries are never assumed to exist or accept flags. Prompt handoff = clipboard + launched CLI, not stdin injection. | Decision |
| R10 | Nested git repo | PromptForge lives inside an unrelated parent git repo; it is now its own repository (`git init` performed during planning). | Fact |
| R11 | **git binary availability** for `git_inspect` | User machines assumed to have `git` on PATH. Detect at first use; degrade gracefully (memory works, git section shows "not available"). Never bundle or wrap git writes. | Risk |
| R12 | Handoff progress heuristics can mislabel work | Completed/partial/remaining is evidence derived from git diffs vs scope — heuristics, not proof. Mitigation: every claim is labeled as evidence, and continuation prompts instruct the agent to verify before acting (§11.3). | Risk (mitigated) |
| R13 | Large repos slow down `git status` | `git_inspect` is bounded (timeouts; path lists truncated with a "+N more" marker). | Risk (mitigated) |

## 8. Corrections and deviations from the product spec

1. **Spec file format:** `PRODUCT_SPEC.md` was an RTF file. Original preserved
   as `PRODUCT_SPEC.original.rtf`; a faithful Markdown conversion is now
   `PRODUCT_SPEC.md`.
2. **Drizzle ORM** replaced (R1).
3. **Mode/depth inconsistency:** spec §6 lists 5 modes (Quick, Standard, Deep,
   Review, Plan) but §8's depth selector only offers Auto/Quick/Standard/Deep.
   Resolution: `execution_mode` enum has all five values; the UI depth
   selector offers Auto/Quick/Standard/Deep, and task types "Kod inceleme"
   and "Planlama" resolve (via Auto) to `review` / `plan` modes. `auto` is a
   UI-level resolution and never appears in a TaskSpec.
4. **§3 (14 fields) vs §4 (10 context files):** the 14 project fields do not
   map 1:1 onto the 10 markdown files. The mapping is defined in
   `docs/DATA_MODEL.md` §3.2 (Users → PRODUCT.md, Tech Stack/Architecture →
   ARCHITECTURE.md, Constraints/Decisions → DECISIONS.md, Deployment →
   TESTING.md "Environments & deployment" section, Current Milestone →
   BACKLOG.md, identity fields → `.promptforge/project.json` anchor).
5. **`project.yaml` / `promptforge.json`** replaced by a single app-managed
   `.promptforge/project.json` anchor (DATA_MODEL.md §3.3): stable project ID
   + portable metadata only. The doc registry (hashes/summaries) lives solely
   in the central DB, avoiding duplicated state in project folders.
6. **`estimated_prompt_tokens` and `confidence`** are model self-reports:
   treated as advisory; the client recomputes token estimates locally and the
   UI never shows confidence as a quality score (consistent with spec §9's
   anti-fake-score rule).
7. **Quick mode "0 calls"** is postponed; MVP Quick always uses exactly 1
   compile call (predictable behavior, simpler budgeting).
8. **Empty `acceptance_criteria`** in the spec's own TaskSpec example
   contradicts the §9 checklist ("Acceptance criteria exist"). The schema
   enforces ≥ 1 acceptance criterion.
9. **Image attachments (§12), memory-update suggestions (§15) and Qwen `/stats`
   import (§14)** are postponed beyond MVP — see `docs/MVP_SCOPE.md`.
10. **TaskSpec contract split (Phase 0.1):** the single schema was divided
    into `schemas/compiler-output.schema.json` (model output; client-owned
    identifiers absent and rejected) and `schemas/taskspec.schema.json`
    (canonical enriched contract; `task_id`, `project_id`, `schema_version`
    required). Lifecycle in `docs/TASKSPEC.md` §1.
11. **Project Memory + Agent Handoff (Phase 0.1):** architecture extended
    beyond the spec's compile-only flow with a central per-project memory
    record, read-only git inspection, and deterministic provider handoff
    (§11). These stay within all product constraints: local-only, consented
    writes, no autonomous git operations, no model calls in handoff
    rendering.

## 9. Unresolved decisions (need input)

| # | Question | Impact if unanswered |
| --- | --- | --- |
| U1 | Exact contract of the user's DeepSeek Flash endpoint (OpenAI-compatible `/chat/completions`? Bearer auth? JSON-mode support? `usage` object present?) | Designed around an adapter + connection test; wrong assumption surfaces at first live test |
| U2 | UI language (assumed English; spec is Turkish) | Cosmetic; changeable later |
| U3 | pnpm as package manager (assumed) | Trivial |
| U4 | macOS-only MVP (assumed yes, per .dmg packaging) | Packaging scope only |

## 10. Testing strategy

- **Unit (Vitest):** redaction patterns, renderers (golden snapshots),
  TaskSpec Zod schema (fixture-driven incl. the spec example), context
  selection/budget, checklist derivation, repositories (in-memory SQLite).
- **Contract fixtures:** `schemas/fixtures/` — valid + invalid documents for
  both contracts, checked by `tools/validate-schemas.mjs` (AJV) and mirrored
  by the Zod fixture suite.
- **Project isolation suite:** explicit tests that no repository, service,
  or renderer can read or write another project's registry row, memory
  record, context, or history without explicitly passing that project's id
  (cross-project attempts must throw).
- **Deterministic handoff suite:** golden snapshots proving same snapshot →
  byte-identical continuation prompt per provider, plus a zero-provider-call
  assertion (mock transport call count stays 0 during any handoff).
- **Rust (cargo test):** keychain command logic (mocked), provider transport
  request shaping/error mapping, `git_inspect` allowlist enforcement.
- **Mock provider:** a local fixture server (or msw) replaying canned
  responses — valid JSON, invalid JSON, empty content, slow responses — so
  the retry state machine is testable without burning real tokens.
- **Fixture git repos:** throwaway repositories built in temp dirs (clean,
  in-progress, interrupted states; varied names/structures) for gitState,
  memory, and handoff tests — nothing hardcoded to PromptForge itself.
- **Manual E2E checklists** per phase (recorded in `IMPLEMENTATION_PLAN.md`).
- **Secret-leak corpus:** a fixture set of secret-bearing documents that the
  redaction layer must catch 100% (regression suite from Phase 5 onward).

## 11. Project Memory & Agent Handoff

### 11.1 Project Memory

**Purpose.** Maintain the latest state of every registered development
project locally, so any compilation or handoff starts from reality instead
of re-asking the user.

**Shape.** One provider-neutral memory record per project
(`project_memory`, DATA_MODEL.md §1.6) covering: identity + canonical path
(registry), name + stack, current phase, last validated task, current +
next task, confirmed decisions, unresolved blockers & risks, relevant files,
last test commands & results, task & provider history (references into
`compilations`/`task_outcomes`). Git checkpoint and uncommitted-change
summary are **derived live** (DATA_MODEL.md §1.7), never stored.

**Rules.**

- Memory is maintained by PromptForge automatically from validated events:
  successful compile advances `current_task_id`; a task marked done advances
  `last_validated_task_id` and clears current; decisions/blockers are
  appended from user-confirmed actions only. The user never edits memory by
  hand.
- Git and the project's files are the execution source of truth. Memory may
  inform prompts but never overrides repository reality; PromptForge
  performs no git write operations (no commit/stash/revert), consistent with
  the consent system (SECURITY.md §4).
- Every memory read/write is project-scoped (`projectId` mandatory); the
  isolation test suite (§10) guards this.
- Works for arbitrary project folders: no assumptions about stack, layout,
  branch names, or phase vocabulary — fields are free text or repo-relative
  paths, and non-git folders are supported (git section degrades).

**Portable identity.** The optional `.promptforge/project.json` anchor
(DATA_MODEL.md §3.3) carries only the stable project ID + portable metadata,
so a moved/re-cloned folder re-links to its memory instead of forking it.

### 11.2 Agent Handoff — inputs

```
HandoffSnapshot = memory record (stored)
                + GitSnapshot (live: HEAD, status, diff stat)
                + current canonical TaskSpec (if a task is in flight)
                + execution_profile (from TaskSpec, determines runtime + style)
```

Assembly is local-only. Building or rendering a handoff issues **zero
provider calls** (asserted in tests).

### 11.3 Progress determination (deterministic, evidence-labeled)

Given `base_commit` (captured when the current task started) and the live
`GitSnapshot`:

- **Committed since base** — `git log base_commit..HEAD` subjects/name-status
  mapped against scope items.
- **Completed (evidence):** scope items whose related files were committed
  since base.
- **Partial (evidence):** uncommitted changes touching files related to a
  scope item — this is the interrupted-work signal.
- **Remaining:** scope items with no commit or diff evidence.
- **No current task / no base_commit:** fall back to memory-only summary
  (phase, last validated task, decisions, blockers) — still a valid handoff.

All classifications are heuristics over git evidence; rendered prompts label
them as evidence and instruct the receiving agent to verify before acting
(R12). Same inputs → same classification → same prompt (pure functions).

### 11.4 Continuation prompt contract

Each provider renderer emits a **short** prompt (hard budget ≈ compile Quick
budget) containing exactly:

1. **Resume header** — project name, phase, target task id.
2. **Instruction to inspect first** — run `git status` / `git diff`, read
   AGENTS.md + the provider instruction file of the target project.
3. **Progress evidence** — completed / partial / remaining lists (§11.3).
4. **Recovery section (only when uncommitted changes exist)** — changed
   paths + diff stat + "review the uncommitted work with the user before
   keeping, completing, or discarding it; no destructive git operation
   without explicit user confirmation". PromptForge itself never touches the
   work tree.
5. **Preserved context** — scope, out-of-scope, confirmed decisions,
   acceptance criteria, stop conditions quoted verbatim from the canonical
   TaskSpec and memory.
6. **Anti-repetition rule** — "do not redo items listed as completed".
7. **Report requirement** — same `final_report` items as the original task.

Provider tone follows §5 (Qwen: explicit steps + targeted reads; Codex:
outcome + constraints; Claude: plan-first + risk emphasis).

### 11.5 Invariants

- Handoff rendering never calls a model; it is template + local state only.
- One shared state feeds all three providers — no provider-specific memory
  or handoff structures (DATA_MODEL.md §2).
- A handoff for project A cannot be assembled from project B's records
  (snapshot assembly validates id consistency and throws otherwise).
- Memory and handoff prompts never contain secrets: they are built from
  memory fields, TaskSpec text, and git *metadata* (paths/stats) only.

### 11.6 Session Core

`src/sessions/types.ts` defines the canonical `ExecutionSession` state and
append-only event kinds. `src/db/repos/executionSessions.ts` persists them
in the central SQLite database; no runtime-specific transcript files are
written into target repositories. `src/sessions/adapters.ts` contains the
Claude Code, Codex, Qwen Code and OpenCode adapters. Adapters differ only in the
instruction-file preamble and continuation wording; they consume the same
session state and recent local events.

`executionSessionService` creates or reuses a session when a canonical
TaskSpec is persisted, records local checkpoints, switches runtimes, and
reconciles active sessions on app startup using live Git evidence. A
recovered external session is explicitly marked `external` and carries a
reason; it never claims that an unavailable transcript was recovered. The
Sessions screen exposes the state, continuation prompt, local checkpoint
events, runtime switch and read-only Rules/Skills inventory. OpenCode is
launched through fixed Rust runtime commands with optional `--continue`,
`--session` and opaque `--model` routing metadata; task text is not injected
into a process argument. `getExecutionSessionView` is the stable read model
for a future VS Code panel: it exposes status, runtime/model binding, task and
progress state, live changed files, events, and completion/failure state. The
existing handoff fallback remains model-free when there is no session
transcript.

### 11.7 VS Code visual integration

The VS Code panel consumes `getExecutionSessionView`, which remains the sole
producer of panel data. `src/services/vscodeIntegration.ts` publishes that
derived view to an in-memory, loopback-only Rust bridge. The bridge stores no
canonical state, accepts read-only `GET` requests plus a fixed session-action
`POST` queue, requires a per-launch bearer token, and exposes only selected
project/session routes. It is transport code, not a second session or runtime
implementation.

`vscode-extension/` contributes a small VS Code Tree View. Its extension host
polls the bridge and validates the returned JSON before displaying status,
runtime/version, opaque model binding, task/progress, changed files, recent
events, and eligible controls. Start, resume, and checkpoint actions require a
VS Code confirmation, then enter the bridge queue. The PromptForge webview
claims the action and calls the existing OpenCode/session services; the
extension never launches OpenCode, writes SQLite, calls providers, or owns
independent project state. PromptForge publishes the resulting view and an
explicit success/failure result.

### 11.8 OpenCode shared Qwen-MM Core capability

OpenCode's native project MCP configuration (`opencode.json`) registers the
upstream `qwen-mm-plugins-core` server through `uvx`; `.opencode/skills/`
contains only the capability instructions needed for the agent to discover
its tools. This is OpenCode infrastructure, not a PromptForge plugin registry
or compiler/provider dependency. The core profile is local-only and requires
no API key.

The capability is available to any model in the OpenCode session, but its tools
are called only when visual understanding is needed. `read_image` returns the
Qwen-MM structured image summary plus an image attachment through MCP, so the
requesting model receives the result without PromptForge transporting image
bytes, injecting context, or creating a second session state. Normal text-only
sessions and the Claude Code, Codex and Qwen Code paths are unchanged. Cloud
Qwen visual APIs remain separate capabilities and are not configured here.

### 11.9 OpenCode provider/model orchestration

`src/services/opencodeModels.ts` defines the canonical OpenCode capability
read model: runtime, provider ID, model ID, opaque `provider/model` reference,
display name, availability and configured state. The Rust `opencode_models`
command runs OpenCode's own `models` catalog command from the registered
project root and returns only sanitized model metadata. It never returns
OpenCode configuration contents or credentials.

When OpenCode's external catalog cannot be queried, the command reads only the
configured model reference from OpenCode's project/global configuration and
returns it as `configured` rather than claiming catalog availability. A
persisted PromptForge selection remains visible as `unknown` during that
fallback. This is an explicit read-model fallback, not a PromptForge provider
registry.

An OpenCode session stores the selected provider/model in the existing opaque
`runtime_metadata_json` binding. Start and resume pass only its `modelRef` to
the existing structured OpenCode launcher. Luna, DeepSeek, Qwen and other
models therefore remain OpenCode model choices; they do not receive separate
PromptForge runtime adapters. Direct Claude Code, Codex and Qwen Code paths
remain unchanged.
