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
- **Stack:** Tauri 2 · React · TypeScript · Vite · Tailwind · shadcn/ui · SQLite · Zod · pnpm (assumed)

## Progress

- **Current phase:** Phase 0 complete (planning foundation). Phase 1 not started — awaiting explicit instruction.
- **Last validated task:** Phase 0.1 — two-contract TaskSpec split + multi-project memory & handoff architecture. Validation: AJV fixture suite green (15/15), doc references resolve.
- **Current task:** none.
- **Next task:** Phase 1 — Tauri skeleton, secure settings, provider connection test (`docs/IMPLEMENTATION_PLAN.md`).

## Decisions (confirmed)

- Drizzle ORM dropped; tauri-plugin-sql + repositories + SQL migrations.
- Provider HTTP runs in Rust (`provider_chat`); API key never enters the webview.
- No hardcoded model names — baseUrl/modelId/key fully configurable.
- One `.promptforge/project.json` anchor per project (id + portable metadata only); no provider-specific state structures.
- Two contracts: `schemas/compiler-output.schema.json` (model output) → enrichment → `schemas/taskspec.schema.json` (canonical); repair bounded to one call.
- Git is inspected read-only; memory never overrides repository reality.
- Handoff rendering is deterministic and requires no model call.

## Blockers & risks

- U1 (blocking for live testing only): DeepSeek endpoint contract unconfirmed (OpenAI-compatible? JSON mode? usage object?) — Phase 1 connection test resolves it.
- U2–U4 assumptions open: English UI, pnpm, macOS-first MVP.
- R3: FTS5 availability in bundled SQLite (fallback ready). R5: tauri-plugin-fs runtime scopes (fallback ready). R11: git binary availability.

## Relevant files

- docs/IMPLEMENTATION_PLAN.md · docs/ARCHITECTURE.md · docs/DATA_MODEL.md · docs/TASKSPEC.md · docs/MVP_SCOPE.md · docs/DEEPSEEK_INTEGRATION.md · docs/SECURITY.md
- schemas/taskspec.schema.json · schemas/compiler-output.schema.json · schemas/fixtures/ · tools/validate-schemas.mjs

## Last tests & results

- `npx ajv-cli` (draft 2020-12) over `schemas/fixtures/`: 15/15 fixtures behave as specified (2026-08-05, Phase 0.1).

## Git checkpoint

- **Latest commit:** Phase 0.1 closing commit `docs: finalize multi-project memory and handoff architecture` (this file is part of it; record its hash on the next state update).
- **Uncommitted changes:** none after the phase-closing commit.

## Recent history

- 2026-08-05 · Phase 0 — planning foundation (spec conversion, docs, TaskSpec schema, repo init).
- 2026-08-05 · Phase 0.1 — TaskSpec contract split; Project Memory + Agent Handoff architecture; fixtures validated with AJV.
