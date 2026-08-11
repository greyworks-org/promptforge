# Implementation Plan — PromptForge Local

Small, testable phases. Each phase is independently demoable and has:
**objective · files/components · dependencies · acceptance criteria · tests ·
risks · completion condition**.

**Ordering note:** the spec's §17 sequence (base → compiler → context →
renderers → measurement → CLI) is adjusted here: the context pipeline and
redaction land **before** the compiler core, because no real content may
reach the provider API before the redaction gate exists, and the compiler
consumes assembled context. Nothing from the spec is dropped; only the order
changes. Phase 0.1 additionally introduced Project Memory and Agent Handoff
(ARCHITECTURE.md §11), implemented as Phases 9–10 before CLI delivery.

**Ground rules for every phase**

- TypeScript strict; new logic ships with unit tests in the same change.
- No phase may introduce a secret-handling path that bypasses keychain or
  redaction (SECURITY.md).
- UI-visible strings in English.
- Phase is done only when its completion condition is met — "works on my
  machine" without tests does not count.

```
Phase 0/0.1 (done) → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11
                     (redaction gate before first real API use)
                     9 = project memory + git state · 10 = agent handoff ·
                     11 = CLI delivery
```

---

## Phase 0 — Planning foundation ✅ (complete)

**Objective.** Convert the product spec into an implementation-ready
foundation.

**Deliverables (done).** `README.md`, `AGENTS.md`, `QWEN.md`, `CLAUDE.md`,
`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/SECURITY.md`,
`docs/DEEPSEEK_INTEGRATION.md`, `docs/TASKSPEC.md`, `docs/MVP_SCOPE.md`,
this plan, `.gitignore`, standalone git repo, Markdown conversion of the RTF
spec (original preserved as `PRODUCT_SPEC.original.rtf`).

**Verification performed.** Schema parses; spec's example TaskSpec validates
with ajv (draft 2020-12); a document with 4 blocking questions is rejected.

## Phase 0.1 — Contract split, project memory & handoff architecture ✅ (complete)

**Objective.** Resolve the TaskSpec ownership inconsistency and make
project-memory + agent-handoff first-class, reusable for every managed
project.

**Deliverables (done).** `schemas/compiler-output.schema.json` (model
output; client-owned ids absent & rejected; unknown fields rejected;
≤ 3 blocking questions), `schemas/taskspec.schema.json` tightened (canonical
contract; `task_id`/`project_id`/`schema_version` required), 15 fixtures in
`schemas/fixtures/`, `tools/validate-schemas.mjs`, Project Memory design
(central registry + `project_memory` record + `.promptforge/project.json`
anchor, DATA_MODEL.md §1.6–§1.7/§3.3), Agent Handoff design
(ARCHITECTURE.md §11: live git snapshot, deterministic continuation prompts,
interrupted-work recovery, zero model calls), `docs/PROJECT_STATE.md`
auto-maintained state file for this repository, all affected docs updated.

**Verification performed.** AJV (draft 2020-12): all 15 fixtures behave as
specified (valid pass, invalid fail) — including rejection of client-owned
ids in compiler output, unknown fields, 4 blocking questions, empty
acceptance criteria, missing client ids in canonical TaskSpecs. Doc
cross-references resolve. No commits before the phase-closing checkpoint.

---

## Phase 1 — App skeleton, secure settings, connection test

**Objective.** Bootable Tauri 2 app; provider configuration with keychain-
backed API key; connection test against the configured endpoint.

**Files & components.**
- `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`,
  `tailwind.config.ts`, `index.html`
- `src/main.tsx`, `src/App.tsx`, `src/screens/SettingsScreen.tsx`
- `src/services/settingsService.ts` (Zod-validated settings in SQLite stub /
  in-memory until Phase 2), `src/services/providerService.ts` (profile
  config, keychain IPC wrapper, connection test)
- `src/ipc/` typed wrappers for Tauri commands
- `src-tauri/` — Tauri 2 project: `Cargo.toml`, `tauri.conf.json`,
  `src/main.rs`, `src/lib.rs`, `src/commands/keychain.rs`
  (`keychain_set/get/delete` via `keyring`), `src/commands/provider.rs`
  (`provider_chat` via `reqwest`)
- Mock provider fixture server (`tools/mock-provider/`) for dev & tests.

**Dependencies.** None.

**Acceptance criteria.**
1. `pnpm dev` opens the app window on macOS.
2. Settings form validates baseUrl/modelId (modelId free text, never a
   hardcoded default); API key is saved via keychain and never appears in any
   file, DB, log, or subsequent UI state (masked placeholder only).
3. Connection test reports: reachable / auth ok / model answered / JSON
   parseable / usage present / latency — against the mock provider; shows the
   correct error classes (auth, network, http_api) for broken configs.
4. No secret in any request log (header scrubbing verified).

**Tests.** Rust: `cargo test` for command argument handling & error mapping
(keyring mocked). TS: settings Zod schema tests; provider service tests
against the mock provider. Manual checklist: save key → quit → relaunch →
test connection still passes without re-entering key.

**Risks.** Tauri 2 plugin/version friction; `keyring` prompts on macOS
(mitigation: document first-run behavior); reqwest TLS config.

**Completion condition.** All tests green; manual checklist passed; a reviewer
confirms no key material in `~/Library/Application Support/promptforge/`,
repo files, or dev logs.

---

## Phase 2 — SQLite layer, project registry & project CRUD

**Objective.** Migration runner + repositories; the central **project
registry** (stable ids, unique canonical paths); Projects screen with
create/rename/delete; project records persist across restarts.

**Files & components.**
- `src/db/migrations/0001_init.sql` (DATA_MODEL.md §1), `src/db/migrate.ts`
- `src/db/runner.ts` (`QueryRunner` interface; plugin adapter)
- `src/db/repos/projects.ts`, `settingsRepo.ts` (settings moves from stub to
  SQLite here)
- `src/screens/ProjectsScreen.tsx`, `src/components/ProjectList.tsx`
- `tests/isolation/` — project isolation suite seed (cross-project query
  attempts must throw)
- Settings persists provider profiles (non-secret parts) via `settings` table.

**Dependencies.** Phase 1.

**Acceptance criteria.**
1. Migrations run idempotently at startup; schema version tracked.
2. Project CRUD persists across restarts; `repo_path` uniqueness enforced
   with a friendly error; ids are stable (never regenerated for the same
   folder).
3. Repositories reject calls without a `projectId` where applicable
   (isolation invariant); deleting a project cascades.
4. Settings survive migration from Phase 1 stub without losing the provider
   profile.
5. Isolation suite: with two seeded projects, no repository call can read
   or write the other project's rows without explicitly passing its id
   (attempts throw).

**Tests.** Repository tests against in-memory SQLite (better-sqlite3 dev
dependency) covering CRUD, cascade, uniqueness, migration idempotency, and
the isolation suite.

**Risks.** SQL dialect drift between plugin and test driver (mitigation:
keep SQL simple, both are SQLite); tauri-plugin-sql init errors on first run.

**Completion condition.** Tests green (incl. isolation suite); manual: create
2 projects, restart, data intact; delete one, related rows gone.

---

## Phase 3 — Project onboarding & `.promptforge` bootstrap

**Objective.** Full onboarding wizard: pick folder → scan → choose docs →
model-drafted project profile → consented writes of `.promptforge/` and
AGENTS/QWEN/CLAUDE.md.

**Files & components.**
- `src/screens/OnboardingWizard.tsx` (steps per spec §9 Screen 1)
- `src/services/projectFs.ts` (scoped fs: read/write under granted dirs),
  `src/services/repoScan.ts` (README + config discovery; depth/size limits)
- `src/services/profileDraft.ts` (provider call to draft context docs)
- `src/templates/` (AGENTS.md, QWEN.md, CLAUDE.md, 10 context doc skeletons)
- `src/services/anchor.ts` (`.promptforge/project.json` creation & re-link:
  matching `projectId` found at a different registry path → offer
  re-association instead of a duplicate project; DATA_MODEL.md §3.3)
- `src/services/consent.ts` (confirmation dialog flows; diff preview for
  overwrites)
- `src-tauri/src/commands/fs.rs` fallback (only if plugin scopes fail — see
  spike below)

**Dependencies.** Phases 1–2 (provider transport + project records).

**Acceptance criteria.**
1. Wizard completes on a sample repo; creates `.promptforge/` layout exactly
   as DATA_MODEL.md §3.
2. Existing AGENTS/QWEN/CLAUDE.md or context files are **never** overwritten
   without diff preview + explicit consent; declining leaves files untouched.
3. Repo scan is bounded (max depth/file count), skips §13 blocked patterns,
   and completes < 5 s on a medium repo.
4. Profile drafting works against the mock provider; drafts are editable in
   the wizard before any write.
5. Runtime fs scope grants access to the chosen folder only (spike result
   documented either way).
6. Onboarding writes the `project.json` anchor (id + portable metadata only)
   with consent; selecting a folder whose anchor matches an existing project
   at another path offers re-linking, never a duplicate registry row.

**Tests.** Unit: template rendering, overwrite-guard logic (exists/missing/
promptforge-owned cases), scan blocklist, anchor re-link logic. Integration
(mock provider): draft generation flow. Manual E2E: onboard a real repo
twice (second run exercises overwrite guards), then move the folder and
re-select it (exercises re-linking).

**Risks.** tauri-plugin-fs runtime scope capability (spike first; fallback:
Rust-proxied fs); draft quality variance (mitigation: everything editable
before write); scanning huge repos (limits).

**Completion condition.** Tests green; manual E2E passed on two sample repos;
overwrite guard verified for all three instruction files.

---

## Phase 4 — Context pipeline (registry, search, selection, budgets)

**Objective.** Docs registered with hash/summary/tags; FTS5 search (or
verified fallback); deterministic auto-suggestion by task type; token budget
enforcement per mode.

**Files & components.**
- `src/services/contextService.ts` (registry sync: scan `.promptforge/context`,
  hash, estimate tokens), `src/services/summarizer.ts` (provider summaries,
  cached by content hash — unchanged files never re-summarized)
- `src/services/contextSearch.ts` (FTS5 wrapper; LIKE fallback behind same
  interface), `src/services/contextSelector.ts` (task-type → doc heuristics,
  spec §11 examples as fixtures), `src/services/tokenBudget.ts`
- `src/db/repos/contextDocs.ts` + FTS migration `0002_fts.sql`
- Compiler screen context panel (checklist of suggested docs, manual
  overrides, budget meter "1,240 / 2,000")

**Dependencies.** Phase 3.

**Acceptance criteria.**
1. Registry reflects `.promptforge/context/` contents; editing a doc changes
   its hash and triggers re-summary; untouched docs are not re-summarized
   (asserted via call counts against mock provider).
2. Summaries are 200–500 tokens (estimated) and stored with tags + related
   task types.
3. Design-type task suggests PRODUCT/DESIGN/CURRENT_STATE; Stripe-like
   integration bugfix suggests INTEGRATIONS/DATA_MODEL/SECURITY/CURRENT_STATE
   (fixture tests from spec §11).
4. Budget enforcement: selection exceeding mode budget is flagged and must be
   resolved (drop docs) before compile enables.
5. FTS5 availability result documented (works, or fallback active — same UX).

**Tests.** Unit: hashing, budget math, selector heuristics, summarizer cache
keying; integration: registry sync against fixture `.promptforge/` folders;
FTS presence spike test.

**Risks.** FTS5 not compiled into bundled SQLite (fallback ready); summary
API cost on large doc sets (cache + on-demand summarization); heuristic
misses (user overrides always available).

**Completion condition.** Tests green; budget + suggestion demonstrated in
UI on a sample project; no re-summary of unchanged files observed.

---

## Phase 5 — Redaction & "Context sent" preview

**Objective.** The security gate: blocked files + secret patterns applied to
every outbound payload; user reviews the exact payload before transmission.

**Files & components.**
- `src/redaction/blocklist.ts`, `src/redaction/patterns.ts` (data-driven,
  SECURITY.md §3.2), `src/redaction/redact.ts`, `src/redaction/report.ts`
- `src/services/payloadAssembly.ts` (request + context + attachment
  descriptions → final payload; redaction built-in, no bypass path)
- `src/components/ContextSentView.tsx` (file list, per-file tokens, redaction
  markers, entropy warnings, Cancel/Send)
- `tests/fixtures/secrets/` — corpus with ≥ 3 samples per pattern class +
  negatives

**Dependencies.** Phase 4 (context assembly exists).

**Acceptance criteria.**
1. Blocked files (SECURITY.md §3.1) cannot enter a payload via any code path
   (unit-proven across all entry functions).
2. Secret corpus: 100% detection of all fixture secrets; redacted output
   keeps document readability (`[REDACTED:<class>]`).
3. RedactionReport lists file/line/class for every hit; never contains the
   secret itself (asserted in tests).
4. ContextSentView shows byte-exact outgoing user content; Cancel aborts
   without any network call (asserted against mock provider call counts).
5. `compilations.context_sent` equals exactly what was sent.

**Tests.** Pattern corpus suite (each class: positives + negatives); blocklist
tests; end-to-end payload assembly snapshot tests; report-never-leaks test.

**Risks.** False positives on legitimate content (mitigation: MVP flags
entropy cases instead of blocking; report explains every action); regex
maintenance (patterns are data + fixtures, so regressions are caught).

**Completion condition.** Corpus at 100% detection; preview verified manually;
no payload path exists that skips redaction (code review + tests).

---

## Phase 6 — Compiler core

**Objective.** End-to-end compilation: system prompt + compiler-output
schema embedding, provider calls, extract→normalize→validate→bounded-repair
state machine, deep-mode critic, blocking-question rounds, client
enrichment, canonical re-validation.

**Files & components.**
- `src/compiler/systemPrompt.ts` (spec §6 prompt + embedded
  `compiler-output.schema.json`), `src/compiler/parse.ts` (JSON extraction:
  fence/prose stripping; normalization strips exactly the 3 client-owned
  keys and defaults missing requirements), `src/compiler/pipeline.ts`
  (state machine per DEEPSEEK_INTEGRATION.md §4: compiler-output validation
  → bounded repair ≤ 1 → enrichment → canonical validation),
  `src/compiler/critic.ts`, `src/compiler/enrich.ts`
  (task_id/project_id/schema_version/token estimate)
- `src/schemas/compilerOutput.ts` + `src/schemas/taskspec.ts` (Zod mirrors
  of both JSON Schemas; drift-checked by the shared fixture suite in
  `schemas/fixtures/`)
- `src/screens/CompilerScreen.tsx` (raw request input, task type/depth/target
  selectors with defaults Qwen/Auto/Auto), `src/components/BlockingQuestionsDialog.tsx`

**Dependencies.** Phases 1 (transport), 4 (context), 5 (redaction gate).

**Acceptance criteria.**
1. Against mock provider scenarios: valid JSON → enriched TaskSpec; invalid
   JSON → exactly one repair call → success; still-invalid → loud failure UI,
   nothing stored/rendered; empty content treated as invalid.
2. Deep mode issues compiler then critic calls (call sequence asserted);
   critic changes are re-validated.
3. ≤ 3 blocking questions surfaced; answers re-run compilation; > 2 rounds
   fails loudly.
4. Zod mirrors behave exactly like the JSON Schemas (verified against every
   fixture in `schemas/fixtures/`): compiler-output accepts valid-full /
   valid-minimal and rejects client-owned ids, unknown fields, 4 blocking
   questions, empty acceptance_criteria, missing objective, bad enums;
   canonical accepts enriched fixtures and rejects missing client ids,
   malformed task ids, unknown fields.
5. Call budget respected: standard ≤ 2 calls, deep ≤ 3 (asserted). Repair is
   bounded to exactly one call (no retry loop).

**Tests.** Pipeline state-machine tests against scripted mock-provider
scenarios; Zod fixture suite (all `schemas/fixtures/` documents); enrichment
tests (id format TASK-YYYY-NNNN, project binding, canonical re-validation
always passes); system prompt snapshot (compiler-output schema embedded
verbatim).

**Risks.** JSON-mode quirks of the real endpoint (capability toggle +
connection test); latency of deep mode (per-call progress UI); prompt/schema
drift (schema embedded from artifact, not hand-copied).

**Completion condition.** All scenario tests green; one successful live
compile against the user's real endpoint (or mock, if key not yet
configured) with the result inspected field-by-field.

---

## Phase 7 — Renderers & Result screen

**Objective.** Deterministic Qwen/Codex/Claude renderers; full Result screen
with checklist and actions.

**Files & components.**
- `src/renderers/renderClaudeCode.ts`, `renderQwenCode.ts`, `renderCodex.ts`,
  `shared.ts` (section formatting, assumption blocks, visual-reference block
  placeholder), `src/profiles/` (typed execution profile constants)
- `src/services/checklist.ts` (derives ✓/⚠ items from TaskSpec content —
  objective explicit, scope bounded, acceptance criteria exist, context
  included, destructive actions gated, assumptions flagged)
- `src/screens/ResultScreen.tsx` (tabs: Qwen/Codex/Claude/TaskSpec/Raw vs
  Compiled/Context sent), action bar (Copy Prompt, Save Task, Write Task
  File, Edit, Recompile, Mark as Used)
- Task file writer (`.promptforge/tasks/TASK-YYYY-NNNN.json`, consent flow)

**Dependencies.** Phase 6.

**Acceptance criteria.**
1. Renderers are profile-aware: runtime family (claude-code/qwen-code/codex) +
  execution profile parameters. Profiles adapt working style only.
2. Same TaskSpec → byte-identical output across runs (snapshot tests).
3. Assumptions rendered verbatim with `Assumption:` prefix; stop conditions
  present per renderer rules; no invented content (property checked against
  TaskSpec fields).
4. Checklist reflects TaskSpec facts only; no numeric quality score anywhere.
5. Copy uses clipboard plugin; Save Task / Write Task File only with consent
  and never overwrite silently.
6. Edit → adjust TaskSpec fields in UI → re-render without extra API calls;
  Recompile → new compilation row.

**Tests.** Golden-file snapshots per provider (seeded from spec §7 examples);
checklist derivation tests; consent-flow tests for file writes; copy action
test.

**Risks.** Template drift from spec examples (goldens reviewed against spec);
markdown escaping of model text (sanitize for heading injection: lines
starting with `#` inside items are indented/quoted).

**Completion condition.** Snapshots approved against spec examples; manual
result review on 3 task types (feature, bugfix, review).

---

## Phase 8 — History & measurement

**Objective.** Full recording and evaluation loop: history screen, outcome
recording, usage aggregates per project/provider.

**Files & components.**
- `src/db/repos/compilations.ts`, `outcomes.ts` (+ migration `0003_*` if
  needed), `src/services/historyService.ts`, `src/services/usageService.ts`
- `src/screens/HistoryScreen.tsx` (list + detail + filters),
  `src/components/OutcomeDialog.tsx` (spec §14 fields)
- Usage view: per-project and per-provider totals (compiler tokens,
  estimated final tokens, success/partial/failure counts, revision counts);
  estimates labeled as such
- Export: history as JSON/CSV (local file save with consent)

**Dependencies.** Phases 6–7 (compilations and rendered prompts exist).

**Acceptance criteria.**
1. Every compilation (success or failure) has a history row with
   raw/compiled/provider/tokens/status; failures show the user-safe error.
2. Outcomes are editable at any time; aggregates recompute consistently
   (property test against fixture datasets).
3. Token numbers from API usage vs estimates are visually distinguished.
4. Export contains no secrets (keys absent; payloads are the stored redacted
   text) — asserted in tests.

**Tests.** Repository tests; aggregation fixtures (mixed providers/projects);
export redaction test.

**Risks.** Metric honesty (labels enforced in UI components, not docs only);
history growth (pagination from day one).

**Completion condition.** Tests green; manual session: 5 recorded tasks with
outcomes; aggregates and export verified.

---

## Phase 9 — Project memory & git state inspection

**Objective.** Central per-project memory (ARCHITECTURE.md §11.1) plus
read-only live git inspection. Memory never overrides repository reality.

**Files & components.**
- `src/db/migrations/0004_project_memory.sql` (DATA_MODEL.md §1.6),
  `src/db/repos/projectMemory.ts`
- `src/services/memoryService.ts` (project-scoped reads/updates: phase,
  task chain — last validated / current / next, decisions, blockers,
  relevant files, last test commands & results; advanced automatically by
  validated events: compile success, outcome recorded)
- `src-tauri/src/commands/git.rs` — `git_inspect`: allowlisted read-only
  commands only (`log -1`, `status --porcelain=v1`, `diff --stat`,
  `rev-parse`), metadata only, timeouts + path-list truncation
- `src/services/gitState.ts` (GitSnapshot assembly; never cached as truth;
  captures `base_commit` when a task starts)
- Projects screen memory panel (phase, decisions, blockers, git checkpoint,
  uncommitted summary)

**Dependencies.** Phases 2–3 (registry + anchor), 8 (history for the task
chain).

**Acceptance criteria.**
1. One memory row per project, created at onboarding; all reads/writes go
   through project-scoped repository methods.
2. Git checkpoint + uncommitted summary are computed live on every read —
   never served from a stale cache (fixture-repo staleness test: mutate the
   repo, re-read, values change).
3. `git_inspect` rejects anything outside the allowlist (unit tests on the
   Rust side); returns structured snapshots for arbitrary repos; non-git
   folders degrade to `isRepo: false` without errors.
4. Validated task completion advances `last_validated_task_id` and clears
   `current_task_id`; decisions/blockers only change through
   user-confirmed actions.
5. Isolation suite extension: cross-project memory access attempts throw.
6. No git write operation exists anywhere in the codebase (review + test
   asserting the command allowlist contains no mutating verbs).

**Tests.** Repository tests; gitState tests against throwaway fixture git
repos (clean / committed-progress / interrupted states, varied names &
structures); staleness test; isolation suite; Rust allowlist tests.

**Risks.** git binary availability/version variance (detect; degrade
gracefully — R11); large repos slowing status (bounded output — R13);
submodule/worktree edge cases (out of MVP scope; snapshot reports what the
plain commands report).

**Completion condition.** Tests green incl. isolation + staleness; manual:
two projects show correct memory panels; git snapshot matches `git log -1`
and `git status` output exactly.

---

## Phase 10 — Agent handoff & interrupted-task recovery

**Objective.** Deterministic, model-free handoff: any registered project can
continue through Qwen Code, Codex or Claude Code from the same shared state
(ARCHITECTURE.md §11).

**Files & components.**
- `src/handoff/snapshot.ts` (HandoffSnapshot assembly: memory + GitSnapshot
  + current canonical TaskSpec; validates project-id consistency)
- `src/handoff/progress.ts` (deterministic completed / partial / remaining
  classification: scope items vs commits since `base_commit` + uncommitted
  evidence; every claim labeled as evidence)
- `src/handoff/renderClaudeCode.ts`, `renderQwenCode.ts`, `renderCodex.ts` (short
  continuation prompts per the ARCHITECTURE.md §11.4 contract; pure,
  profile-aware functions)
- UI: Hand off action (provider picker) on Projects + Result screens;
  continuation-prompt preview before copy/launch

**Dependencies.** Phase 9; Phases 6–7 (canonical TaskSpecs + renderer
infrastructure).

**Acceptance criteria.**
1. Handoff rendering issues **zero** provider calls (mock transport call
   count asserted = 0 across the whole handoff flow).
2. Determinism: same HandoffSnapshot + same profile → byte-identical
   continuation prompt, across repeated runs (golden snapshots).
3. Preservation: the continuation prompt quotes scope, out-of-scope,
   confirmed decisions, acceptance criteria and stop conditions verbatim.
4. Recovery: when uncommitted changes exist, the prompt contains the
   recovery section (changed paths + diff stat + "review with the user
   before keeping or discarding; no destructive git operation without
   confirmation"); when the tree is clean, no recovery section appears.
5. Anti-repetition: items classified completed appear marked as done with
   their evidence, and the prompt instructs the agent not to redo them.
6. Arbitrary-project generality: fixture suite covers ≥ 3 synthetic projects
   with different names, stacks, phases and structures — no PromptForge-
   specific paths, names, phases or technologies hardcoded.
7. Isolation: assembling a snapshot with mismatched project/task identifiers
   throws (test).

**Tests.** Deterministic handoff golden suite; progress classification
fixtures (clean, partially committed, interrupted/uncommitted); recovery
presence/absence tests; zero-call assertion; isolation test.

**Risks.** Progress heuristic mislabels (mitigation: evidence labeling +
verify-first instruction — R12); prompt bloat (hard token budget enforced
and tested).

**Completion condition.** All tests green; manual: interrupt a fixture task
(leave uncommitted changes), generate all three handoffs, verify recovery
section and zero model usage; hand one to a real CLI and confirm it resumes
without redoing committed work.

---

## Phase 11 — CLI integration & delivery

**Objective.** Deliver compiled or handoff prompts to real coding CLIs with
consent: clipboard, open terminal at project, launch configured CLIs.

**Files & components.**
- `src/services/cliService.ts` (binary registry: qwen/codex/claude commands
  user-configured in Settings; existence check), `src-tauri`
  `commands/shell.rs` (`open_terminal`, `launch_cli` via tauri-plugin-shell,
  allowlist limited to configured binaries)
- Settings section: CLI paths; Result screen actions: Open in Terminal,
  Launch <provider> CLI (with final confirmation showing binary + cwd);
  Handoff preview actions: Copy continuation prompt / Launch CLI

**Dependencies.** Phase 10.

**Acceptance criteria.**
1. Copy works for all runtime tabs — compile prompts and handoff
   continuation prompts alike.
2. Open in Terminal opens the project's repo directory.
3. Launching a CLI requires the confirm dialog (binary + working directory
  shown); unconfigured/missing binary → guidance, not an error crash.
4. No attempt to pipe or inject prompt text into the CLI (delivery =
  clipboard + launched session). Documented in UI copy.
5. No shell command ever constructed from model/TaskSpec/memory content.

**Tests.** Command construction unit tests (allowlist enforcement); manual
matrix: at least Qwen Code + one of Codex/Claude Code on this machine.

**Risks.** CLI binaries/flags differ across versions (mitigation: launch
only, zero assumptions about flags; paths user-set); terminal app choice on
macOS (use default terminal via `open`).

**Completion condition.** Manual matrix passed; allowlist review confirms no
arbitrary command path.

---

## OpenCode Runtime Integration Foundation

This phase keeps PromptForge as the canonical project/session intelligence
layer while adding OpenCode as a first-class runtime path. OpenCode is
detected and launched through fixed Rust commands; PromptForge persists the
runtime/model binding and its own transcript/checkpoints, while OpenCode's
session store remains external runtime state. `getExecutionSessionView` is
the runtime-independent read model reserved for the later VS Code panel.
Direct Claude Code, Codex and Qwen adapters remain supported.

The next phase is the VS Code Visual Integration Layer. It consumes the
session read model and does not move canonical state into the extension or
OpenCode.

## VS Code Visual Integration Layer

This first visual-integration slice keeps VS Code as the visual development
environment while PromptForge remains canonical and OpenCode remains the
primary runtime. The existing `getExecutionSessionView` is published through
a read-only, loopback-only, in-memory bridge with a per-launch bearer token.
PromptForge owns publication and refresh; the extension never reads or writes
the SQLite database directly.

The `vscode-extension/` package contributes a Session Status Tree View and
explicit Connect/Refresh commands. It displays the current session status,
runtime/version, opaque model binding, task progress, changed files, and recent
events. The Sessions screen copies a scoped connection URI for the selected
project/session and refreshes the published view while it is open.

Out of scope: live browser preview, visual element selection, autocomplete or
Cursor Tab behavior, autonomous/background execution, duplicated session state,
and optional worktrees.

**Completion condition.** Extension typecheck, connection/bridge unit tests,
frontend typecheck, full TypeScript tests, Rust tests, and production build
pass. Manual VS Code installation/connection remains a pre-release check.

**Phase handoff.** This was followed by the VS Code Session Control Layer,
which adds confirmation-gated actions while preserving the same canonical
PromptForge session and read-model boundaries.

## VS Code Session Control Layer

The extension now exposes only three explicit mutating controls: Start Session,
Resume Session when the canonical read model marks it eligible, and Add
Checkpoint Note. Each control requires a VS Code confirmation. The extension
POSTs a fixed, project/session-scoped action to the loopback bridge; it never
launches OpenCode or accesses the database directly.

PromptForge claims queued actions from the bridge and routes them through the
existing `launchExecutionSessionThroughOpenCode` and `appendSessionEvent`
services. It republishes the canonical `getExecutionSessionView` after success
or failure and returns a bounded success/failure message to the extension.
The action pump is serialized and performs no work without a queued user
action.

Out of scope: automatic execution, background autonomy, browser preview,
visual element selection, autocomplete/Cursor Tab, new runtimes/providers,
optional worktrees, and Computer Use.

**Completion condition.** Confirmed Start/Resume/Checkpoint actions are routed
through PromptForge, eligible controls and outcomes are visible in the Session
Status view, existing read-only integration and runtime adapters remain intact,
and all tests/typechecks/builds pass.

**Next recommended phase.** VS Code live session observability layer: resilient
reconnect plus event/progress refresh semantics for the existing canonical
session view, without adding visual editing or autonomous execution.

## OpenCode Shared Qwen-MM Core Capability

This bounded integration registers Qwen-MM Core through OpenCode's native
project MCP configuration and skill discovery. It adds no PromptForge
transport, provider profile, API-key path, compiler dependency, session field,
or custom capability registry. The local-only `read_image` tool is available
across OpenCode model sessions and is invoked only when the agent needs visual
understanding; its structured MCP result contains the resized image and a
resolution summary.

The targeted validation launches the upstream stdio server against a local PNG,
checks that `read_image` is advertised, and verifies the returned content has
both text and image parts. Cloud/API Qwen capabilities are intentionally out of
scope.

## OpenCode Provider & Model Orchestration Foundation

This phase adds the first model-aware OpenCode capability without creating
model-specific PromptForge runtimes. `src/services/opencodeModels.ts` owns the
validated read model for OpenCode provider/model capabilities. The Rust shell
boundary invokes OpenCode's native `models` command and sanitizes its output
to provider ID, model ID, model reference, display name, availability and
configured state.

OpenCode catalog access is allowed to be unavailable: the smallest explicit
fallback reads only the configured model reference from OpenCode config and
marks it configured-but-not-enumerated. PromptForge may retain a previously
selected model as unknown for display, but never copies provider credentials.
The selected model is persisted through the existing opaque session binding
and passed unchanged as OpenCode's `--model` value on start/resume. Direct
Claude Code, Codex and Qwen Code adapters remain compatibility paths.

**Completion condition.** A structured OpenCode model set can be obtained or
falls back explicitly; an OpenCode session can select and persist a model;
start/resume forwards that model; direct runtimes, VS Code session controls and
Qwen-MM remain unchanged; TypeScript, Rust, typecheck and build gates pass.

**Next recommended phase.** Cross-Model Handoff & Continuation Layer. This
phase must build on the canonical session binding and must not add model-
specific OpenCode adapters.

## After Phase 11 (MVP release gate)

- Execute `MVP_SCOPE.md` §4 definition-of-done end-to-end on two real
  projects; fix what fails.
- Package the .dmg dev build.
- Begin measuring spec §18 metrics across the first 50 real tasks.

## Post-MVP backlog entry points

Image attachments (assets/) → memory-update suggestions → Qwen `/stats`
import → zero-call Quick mode → comparison analytics → entropy hard-blocking
→ design tool integration (Figma — `docs/DESIGN_TOOL.md`) → Windows/Linux
packaging → signing/notarization. Each needs its own phase spec before
starting.
