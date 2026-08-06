# Project State — PromptForge Local

> **AUTO-MAINTAINED.** Coding agents update this file after validated work
> (acceptance criteria met + tests green). Users do not edit it by hand.
> Provider-neutral: the same file serves Qwen Code, Codex and Claude Code.
> This is the dogfood instance of the product's Project Memory record
> (`docs/ARCHITECTURE.md` §11); the shipping app keeps this record in its
> central SQLite database instead.

## Identity

- **Project ID:** promptforge-local
- **Canonical path:** /Users/utku/Desktop/PromptForge
- **Stack:** Tauri 2 · React 18 · TypeScript · Vite 6 · Tailwind v4 · SQLite (Phase 2) · Zod 3 · pnpm via corepack

## Progress

- **Current phase:** Phase 2 complete (automated battery green, uncommitted — awaiting user review/commit + manual pass) — SQLite migrations, project registry + CRUD, settings persistence on SQLite. Startup ACL blocker found and fixed (see Blockers).
- **Last validated task:** Phase 2 startup fix (2026-08-06) — `sql:allow-execute` added to the main-window capability; live dev run applied migration 0001 in the real app DB (all six tables + schema_migrations row), terminal-verified via sqlite3 dump. Manual UI verification still pending.
- **Current task:** none (awaiting manual Phase 2 checks).
- **Next task:** Manual Phase 2 verification in the running app; then Phase 3 — project onboarding & `.promptforge` bootstrap (`docs/IMPLEMENTATION_PLAN.md`).

## Decisions (confirmed)

- Drizzle ORM dropped; tauri-plugin-sql + repositories + SQL migrations.
- Provider HTTP runs in Rust (`provider_chat`); API key never enters the webview.
- No hardcoded model names — baseUrl/modelId/key fully configurable.
- One `.promptforge/project.json` anchor per project; no provider-specific state structures.
- Two contracts: `schemas/compiler-output.schema.json` → enrichment → `schemas/taskspec.schema.json`; repair bounded to one call.
- Git is inspected read-only; memory never overrides repository reality.
- Handoff rendering is deterministic and requires no model call.
- Phase 1 additions: `keychain_get` stays Rust-internal; the webview boundary exposes only `keychain_has` (presence) — stricter than the Phase 0 command table, same security intent. Tailwind v4 via `@tailwindcss/vite`. Placeholder app icon (`src-tauri/icons/icon.png`) until branding. Rust toolchain installed via Homebrew; pnpm runs through corepack (`corepack pnpm …`, or `corepack enable pnpm` for plain `pnpm`).
- Phase 2 additions: one `QueryRunner` seam with two adapters — `tauri-plugin-sql` (production, DB file `sqlite:promptforge.db` in app data dir, `PRAGMA foreign_keys = ON`) and better-sqlite3 (dev dependency, tests only). Numbered SQL migrations in `src/db/migrations/` run from TypeScript (`src/db/migrate.ts`) inside transactions, tracked by a `schema_migrations` table with a newer-DB downgrade guard. Folder selection uses `tauri-plugin-dialog`; folder validation/canonicalization uses a read-only Rust `fs_metadata` command (keeps the R5 fs-scope spike in Phase 3). Settings live under the `provider.profiles` settings key (DATA_MODEL.md §1.5 shape); the Phase 1 localStorage stub is imported once, then removed. Removing a project deletes only app-DB rows (cascade); on-disk folders are never touched. pnpm build approval: `pnpm.onlyBuiltDependencies: ["better-sqlite3"]` in package.json.

## Blockers & risks

- U1 (blocking for live testing only): DeepSeek endpoint contract unconfirmed — connection test resolves it once a key is configured.
- U2–U4 assumptions open: English UI, pnpm, macOS-first MVP.
- R3/R5/R11 unchanged (FTS5, fs scopes, git binary) — later phases.
- Dev-environment keychain note (resolved 2026-08-06, kept for reference): each unsigned `tauri dev` rebuild changes the binary's code identity, so a keychain item created by an earlier build can fail re-authorization ("Keychain state unavailable." in Settings) until the key is re-saved from the current build. The fixture key was re-saved through the UI during manual verification. Optional remaining manual pass: replace/delete a key through the UI.
- Phase 2 startup blocker (resolved 2026-08-06): tauri-plugin-sql's `sql:default` set grants only close/load/select — every migration `execute` was ACL-rejected at runtime, leaving an empty DB and "The project library could not be opened." Fix: explicit `sql:allow-execute` in `src-tauri/capabilities/default.json`; regression test in `tests/capabilities/sqlCapability.test.ts` guards the effective permission set. Unit tests could not catch this (better-sqlite3 bypasses the Tauri ACL); live app verification is the authoritative check for DB init.

## Relevant files

- src/App.tsx · src/screens/{ProjectsScreen,SettingsScreen}.tsx · src/components/ProjectList.tsx
- src/services/{settingsService,providerService,projectsService}.ts · src/schemas/providerProfile.ts · src/ipc/index.ts
- src/db/{runner,migrate,appDb,pluginSqlRunner,betterSqliteRunner}.ts · src/db/migrations/0001_init.sql · src/db/repos/{projects,settingsRepo}.ts
- src-tauri/src/{lib,keychain,provider}.rs · src-tauri/src/commands/{keychain,provider,fs}.rs · src-tauri/{tauri.conf.json,Cargo.toml} · src-tauri/capabilities/default.json
- tools/mock-provider/server.mjs · docs/* · schemas/* · tests colocated (`src/**/*.test.ts*`, `tests/isolation/`, Rust `#[cfg(test)]`)

## Last tests & results

- 2026-08-06 · Phase 2 startup-fix battery: capability regression test 2/2 ✓ · `corepack pnpm typecheck` ✓ · `corepack pnpm test` 91/91 ✓ · `cargo test` 21/21 ✓ · `cargo build` 0 warnings ✓ · `corepack pnpm build` ✓ · live verification: `tauri dev` (fixed binary) applied migration 0001 in `~/Library/Application Support/com.promptforge.local/promptforge.db` within ~3 s of launch (schema_migrations row + all six tables, sqlite3-verified, in-place upgrade of the previously empty file); dev log clean, no Rust-side errors.
- 2026-08-06 · Phase 2 battery: `corepack pnpm typecheck` ✓ (now covers `src` + `tests`) · `corepack pnpm test` 89/89 ✓ (migration idempotency/rollback/schema-version guard, statement splitter, projects/settings repositories, settings stub→SQLite migration, no-key-material-in-SQLite, registry dedupe/canonical paths/CRUD/active selection, isolation suite with cascade, Projects + Settings UI states) · `cargo test` 21/21 ✓ (+4 fs_metadata tests: existing dir, missing path, file-not-dir, dot-segment resolution) · `cargo build` 0 warnings ✓ · `corepack pnpm build` ✓. Migration `0001_init.sql` verified against better-sqlite3; the identical SQL runs through tauri-plugin-sql in the app (manual run pending).
- 2026-08-06 · Phase 1 manual verification PASSED (user-run): mock key re-saved in Keychain; connection test through the running Tauri app reported endpoint reachable · authentication accepted · model answered · valid JSON response · JSON mode requested and honored · usage data present · latency displayed. Also removed the temporary `src/devDiag.ts` diagnostics (and its `main.tsx` call) before commit; typecheck + 34 tests + build re-run green after removal.
- 2026-08-05 · Provider-connection fix battery: `corepack pnpm typecheck` ✓ · `corepack pnpm test` 34/34 ✓ · `cargo test` 17/17 ✓ (adds 2 command-level tests: empty model id, missing stored key → config class) · `cargo build` 0 warnings ✓ · `corepack pnpm build` ✓. Manual verification in the running app (mock provider, pid-verified windows): pre-fix reproduction showed ✗ reachable / ✗ model answered / Error class: unknown; post-fix shows "Connection successful." with all ✓ (auth accepted, content is JSON, JSON mode requested and honored, usage present, latency 2 ms) and mock-server log confirms `POST /v1/chat/completions` with `jsonMode=requested`; auth-failure path (mock started with a different expected key) renders ✗ Authentication rejected + Error class: auth. No secrets logged anywhere.
- 2026-08-05 · Phase 1 battery: `corepack pnpm typecheck` ✓ · `corepack pnpm test` 34/34 ✓ (profile validation, key persistence/no-leak, mock connection success/auth-fail/invalid-JSON/timeout/unreachable, settings-screen states) · `cargo test` 15/15 ✓ (keychain, URL policy, body shape, status classes, key-leak guard, live HTTP: success/401/timeout/unreachable) · `cargo build` 0 warnings ✓ · `corepack pnpm build` ✓ · app launch: window "PromptForge Local" 1080×760 confirmed via System Events.
- Secret-leak scan: no logging statements in Rust; mock server never logs the Authorization header; only fixture/test key literals in repo; no app data persisted yet.

## Git checkpoint

- **Latest commit:** `51f1b3d` — Phase 1 closing commit `feat: complete provider settings foundation`.
- **Uncommitted changes:** Phase 2 implementation (SQLite foundation, project registry, settings persistence, Projects UI, tests) — awaiting user review and commit.

## Recent history

- 2026-08-05 · Phase 0 — planning foundation (spec conversion, docs, TaskSpec schema, repo init).
- 2026-08-05 · Phase 0.1 — TaskSpec contract split; Project Memory + Agent Handoff architecture; fixtures validated with AJV.
- 2026-08-05 · Phase 1 — macOS app foundation: keychain commands, provider transport, Settings screen, mock provider; all tests green; awaiting review.
- 2026-08-05 · Phase 1 bugfix — `provider_chat` accepted a single snake_case `request` struct while the frontend sends flat camelCase args, so Tauri rejected every invoke before the transport ran (UI: Error class unknown). Fix: flatten the command to top-level snake_case parameters (Tauri maps camelCase→snake_case for parameter names), extract `run_chat` helper for testability, +2 Rust tests. Verified live: success + auth-failure paths.
- 2026-08-06 · Phase 1 closed — manual verification passed in the running app (all seven connection-test indicators green); temporary `src/devDiag.ts` diagnostics removed; Phase 1 committed as `feat: complete provider settings foundation`.
- 2026-08-06 · Phase 2 startup hotfix — `sql:allow-execute` capability gap (plugin `sql:default` omits execute) fixed + capability regression test; live-verified DB initialization in the running app.
- 2026-08-06 · Phase 2 implemented — migration runner + `0001_init.sql` (full DATA_MODEL §1 base schema incl. `settings`), `QueryRunner` seam with plugin/better-sqlite3 adapters, projects + settings repositories, settings service moved from localStorage stub to SQLite (one-time stub migration), project registry service (normalize → Rust `fs_metadata` canonicalization → dedupe → slug ids), Projects screen with loading/empty/error/success states, edit/remove-with-consent/active selection, `tests/isolation/` suite. New Tauri plugins: sql (sqlite) + dialog; capabilities extended. Phase 1 settings behavior preserved (profile shape, keychain-only keys).
