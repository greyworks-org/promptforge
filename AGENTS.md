# AGENTS.md — PromptForge Local

Shared, provider-neutral instructions for any coding agent working **on this
repository**. Provider-specific additions live in `QWEN.md` and `CLAUDE.md`;
do not duplicate these rules there.

## What this project is

PromptForge Local is a local-first desktop app (Tauri 2 + React + TypeScript)
built around three capabilities, all sharing one per-project state:

1. **Prompt Compiler** — compiles informal user requests into a validated,
   provider-neutral **TaskSpec JSON** using a configurable DeepSeek
   Flash-compatible API, with only the relevant project context.
2. **Project Memory** — keeps the latest state of every registered project
   locally (central SQLite). Git and the project files stay the execution
   source of truth; memory never overrides them.
3. **Agent Handoff** — deterministic, model-free continuation prompts so any
   project can continue through Qwen Code, Codex or Claude Code from the same
   shared state.

`PRODUCT_SPEC.md` is the product requirement (in Turkish). The `docs/` folder
is the authoritative engineering source. The contracts in `schemas/` are law.
Current development state: `docs/PROJECT_STATE.md`.

## Architecture rules

- Product logic lives in **TypeScript** (`src/`). The Rust side (`src-tauri/`)
  stays minimal: keychain access, provider HTTP transport, read-only git
  inspection, native shell/fs operations. Do not grow Rust business logic
  without a documented reason.
- Task contracts have exactly one source of truth per stage:
  `schemas/compiler-output.schema.json` (what the model may return — no
  client-owned identifiers) and `schemas/taskspec.schema.json` (canonical,
  enriched — `task_id`/`project_id`/`schema_version` required). The runtime
  Zod schemas must mirror them field for field; change both together and
  never let them drift. Fixtures in `schemas/fixtures/` are the regression
  gate (`tools/validate-schemas.mjs`).
- Provider API access goes **only** through the Rust transport command. The
  webview must never see the API key and must never call the provider
  directly.
- Renderers are pure, deterministic functions: same input → same output. No
  randomness, no model calls inside renderers. **Handoff rendering must
  never require an AI call** — it assembles local memory + git snapshot +
  TaskSpec only.
- Project state is provider-neutral: one shared memory record per project.
  Never create Qwen-, Codex- or Claude-specific state structures.
- Git is inspected read-only (allowlisted metadata commands). Never add git
  write operations (commit/stash/revert/checkout) to PromptForge.
- Every project is isolated. Never write a query, API, or utility that crosses
  project boundaries.
- Prefer simple, explicit code over abstractions. Three similar lines beat a
  premature helper. Do not introduce new libraries without checking they are
  actually used elsewhere in the project or approved in `docs/ARCHITECTURE.md`.

## Hard security rules

- API keys: OS keychain only (`keyring` via Rust). Never in SQLite, never in
  `.promptforge/` files, never in logs, never in error messages, never in git.
- All content sent to the provider API must pass the redaction layer first.
  Never add a code path that bypasses redaction, even for "internal" calls.
- Never overwrite a user's existing files (context docs, AGENTS/QWEN/CLAUDE.md
  in target repos) without an explicit consent step in the UI.
- PromptForge never executes code, never creates git commits, never deploys,
  and never lets the model control a terminal. Do not add such features.

## Coding standards

- TypeScript `strict` mode; no `any` unless unavoidable and commented.
- Validation at boundaries: model output (Zod), DB rows (Zod), user input.
  Internal code may trust validated types.
- Errors are surfaced to the user with clear messages. The system must never
  silently produce a broken or unvalidated prompt.
- Names in English; UI copy in English; comments only where "why" is not
  obvious from the code.
- Tests: Vitest for TypeScript logic, `cargo test` for Rust. Redaction,
  validation, and renderers are pure functions — keep them unit-testable.

## Test & validation commands

Planned (become valid as phases land):

```bash
pnpm install          # install frontend dependencies
pnpm dev              # run the app in dev mode
pnpm test             # Vitest unit tests
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
```

Until the corresponding phase is complete, a command may not exist yet —
check `docs/IMPLEMENTATION_PLAN.md` before assuming tooling.

## Working discipline

- Read the relevant docs (`docs/*.md`) and existing code before changing
  anything. Do not scan the whole repository when a targeted read suffices.
  Start from `docs/PROJECT_STATE.md` to know where the project stands.
- Do not modify unrelated files. Keep diffs focused on the requested task.
- Destructive or irreversible operations (deleting data, rewriting history,
  schema migrations that drop columns) require explicit user confirmation.
- Facts vs assumptions: when a task leaves something unresolved, say so in
  your completion report instead of inventing an answer.
- **After validated work** (acceptance criteria met, tests green), update
  `docs/PROJECT_STATE.md` in the same change: progress, decisions, blockers,
  relevant files, last test results, git checkpoint, history. Keep it
  concise. Never leave it stale.
- At completion report: files changed, commands run, test results,
  assumptions made, remaining risks.

## Package & folder map (once implemented)

```
src/                  # React + TypeScript app (all product logic)
src-tauri/            # Tauri 2 shell: commands, keychain, HTTP transport, git inspection
docs/                 # Authoritative engineering documents (+ PROJECT_STATE.md)
schemas/              # Contract artifacts: taskspec + compiler-output schemas, fixtures
tools/                # Maintenance scripts (validate-schemas.mjs)
```

Package manager: **pnpm**. Do not mix lockfiles from other managers.
