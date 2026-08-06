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

- **Current phase:** Phase 1 complete and committed — provider settings foundation with the `provider_chat` IPC fix, manually verified end-to-end. Phase 2 not started.
- **Last validated task:** Phase 1 manual verification (2026-08-06) — user re-saved the mock key in Keychain and ran the connection test in the running app: endpoint reachable, authentication accepted, model answered, valid JSON response, JSON mode requested and honored, usage data present, latency displayed.
- **Current task:** none (awaiting next instruction).
- **Next task:** Phase 2 — SQLite migrations + project registry + project CRUD (`docs/IMPLEMENTATION_PLAN.md`).

## Decisions (confirmed)

- Drizzle ORM dropped; tauri-plugin-sql + repositories + SQL migrations.
- Provider HTTP runs in Rust (`provider_chat`); API key never enters the webview.
- No hardcoded model names — baseUrl/modelId/key fully configurable.
- One `.promptforge/project.json` anchor per project; no provider-specific state structures.
- Two contracts: `schemas/compiler-output.schema.json` → enrichment → `schemas/taskspec.schema.json`; repair bounded to one call.
- Git is inspected read-only; memory never overrides repository reality.
- Handoff rendering is deterministic and requires no model call.
- Phase 1 additions: `keychain_get` stays Rust-internal; the webview boundary exposes only `keychain_has` (presence) — stricter than the Phase 0 command table, same security intent. Settings persistence is a localStorage stub behind `settingsService` (SQLite in Phase 2). Tailwind v4 via `@tailwindcss/vite`. Placeholder app icon (`src-tauri/icons/icon.png`) until branding. Rust toolchain installed via Homebrew; pnpm runs through corepack (`corepack pnpm …`, or `corepack enable pnpm` for plain `pnpm`).

## Blockers & risks

- U1 (blocking for live testing only): DeepSeek endpoint contract unconfirmed — connection test resolves it once a key is configured.
- U2–U4 assumptions open: English UI, pnpm, macOS-first MVP.
- R3/R5/R11 unchanged (FTS5, fs scopes, git binary) — later phases.
- Dev-environment keychain note (resolved 2026-08-06, kept for reference): each unsigned `tauri dev` rebuild changes the binary's code identity, so a keychain item created by an earlier build can fail re-authorization ("Keychain state unavailable." in Settings) until the key is re-saved from the current build. The fixture key was re-saved through the UI during manual verification. Optional remaining manual pass: replace/delete a key through the UI.

## Relevant files

- src/screens/SettingsScreen.tsx · src/services/{settingsService,providerService}.ts · src/schemas/providerProfile.ts · src/ipc/index.ts
- src-tauri/src/{lib,keychain,provider}.rs · src-tauri/src/commands/{keychain,provider}.rs · src-tauri/tauri.conf.json
- tools/mock-provider/server.mjs · docs/* · schemas/* · tests colocated (`src/**/*.test.ts*`, Rust `#[cfg(test)]`)

## Last tests & results

- 2026-08-06 · Phase 1 manual verification PASSED (user-run): mock key re-saved in Keychain; connection test through the running Tauri app reported endpoint reachable · authentication accepted · model answered · valid JSON response · JSON mode requested and honored · usage data present · latency displayed. Also removed the temporary `src/devDiag.ts` diagnostics (and its `main.tsx` call) before commit; typecheck + 34 tests + build re-run green after removal.
- 2026-08-05 · Provider-connection fix battery: `corepack pnpm typecheck` ✓ · `corepack pnpm test` 34/34 ✓ · `cargo test` 17/17 ✓ (adds 2 command-level tests: empty model id, missing stored key → config class) · `cargo build` 0 warnings ✓ · `corepack pnpm build` ✓. Manual verification in the running app (mock provider, pid-verified windows): pre-fix reproduction showed ✗ reachable / ✗ model answered / Error class: unknown; post-fix shows "Connection successful." with all ✓ (auth accepted, content is JSON, JSON mode requested and honored, usage present, latency 2 ms) and mock-server log confirms `POST /v1/chat/completions` with `jsonMode=requested`; auth-failure path (mock started with a different expected key) renders ✗ Authentication rejected + Error class: auth. No secrets logged anywhere.
- 2026-08-05 · Phase 1 battery: `corepack pnpm typecheck` ✓ · `corepack pnpm test` 34/34 ✓ (profile validation, key persistence/no-leak, mock connection success/auth-fail/invalid-JSON/timeout/unreachable, settings-screen states) · `cargo test` 15/15 ✓ (keychain, URL policy, body shape, status classes, key-leak guard, live HTTP: success/401/timeout/unreachable) · `cargo build` 0 warnings ✓ · `corepack pnpm build` ✓ · app launch: window "PromptForge Local" 1080×760 confirmed via System Events.
- Secret-leak scan: no logging statements in Rust; mock server never logs the Authorization header; only fixture/test key literals in repo; no app data persisted yet.

## Git checkpoint

- **Latest commit:** Phase 1 closing commit `feat: complete provider settings foundation` (this file is part of it; record its hash on the next state update).
- **Uncommitted changes:** none after the phase-closing commit.

## Recent history

- 2026-08-05 · Phase 0 — planning foundation (spec conversion, docs, TaskSpec schema, repo init).
- 2026-08-05 · Phase 0.1 — TaskSpec contract split; Project Memory + Agent Handoff architecture; fixtures validated with AJV.
- 2026-08-05 · Phase 1 — macOS app foundation: keychain commands, provider transport, Settings screen, mock provider; all tests green; awaiting review.
- 2026-08-05 · Phase 1 bugfix — `provider_chat` accepted a single snake_case `request` struct while the frontend sends flat camelCase args, so Tauri rejected every invoke before the transport ran (UI: Error class unknown). Fix: flatten the command to top-level snake_case parameters (Tauri maps camelCase→snake_case for parameter names), extract `run_chat` helper for testability, +2 Rust tests. Verified live: success + auth-failure paths.
- 2026-08-06 · Phase 1 closed — manual verification passed in the running app (all seven connection-test indicators green); temporary `src/devDiag.ts` diagnostics removed; Phase 1 committed as `feat: complete provider settings foundation`.
