# PromptForge Local

A local-first **AI Development Prompt Compiler** for coding agents.

PromptForge turns an informal, possibly incomplete user request into a precise,
verifiable development task — compiled against the selected project's real
context, sanitized of secrets, and rendered into provider-specific prompts for
**Qwen Code** (primary), **Codex** and **Claude Code** (secondary).

> **Status:** Planning foundation complete. Implementation has **not** started.
> See `docs/IMPLEMENTATION_PLAN.md` for the phased build plan and
> `docs/MVP_SCOPE.md` for what is in and out of the first release.

## The core idea

```
Raw request → context selection → secret redaction → DeepSeek compiler
  → one neutral TaskSpec JSON → validation → deterministic renderers
  → Qwen / Codex / Claude prompts → copy or write → record outcome & usage
```

The compiler model (a configurable DeepSeek Flash-compatible endpoint) never
writes three different prompts. It produces **one** provider-neutral
**TaskSpec** (`schemas/taskspec.schema.json`). Deterministic TypeScript
renderers turn that contract into provider prompts. Task meaning cannot drift
between providers, and the same task's success is comparable across Qwen,
Codex and Claude.

## Non-negotiable product rules

- Local-first: all data lives in SQLite + project files; nothing syncs anywhere.
- The API key is stored in the OS keychain, never in plain text, never in SQLite.
- No cloud auth, accounts, payments, teams, or sync.
- No vector database in the MVP (headings, tags, task type, FTS5 are enough).
- No autonomous code execution, git commits, or deployments — PromptForge
  prepares prompts; coding agents do the work, with user consent at every
  boundary.
- The model name is **never hardcoded** — `baseUrl`, `apiKey`, `modelId` are
  all user-configurable.

## Technology stack

| Layer | Choice |
| --- | --- |
| Desktop shell | Tauri 2 |
| UI | React + TypeScript + Vite |
| Components | Tailwind CSS + shadcn/ui |
| Local database | SQLite (via `tauri-plugin-sql`) |
| API transport | Rust (`reqwest` behind Tauri commands) |
| Secret storage | OS keychain (`keyring` crate) |
| Validation | Zod (runtime) + JSON Schema (contract artifact) |
| Search | SQLite FTS5 |

Full rationale and risk analysis: `docs/ARCHITECTURE.md`.

## Repository layout (current)

```
PromptForge/
├── PRODUCT_SPEC.md              # Product requirement (Markdown conversion)
├── PRODUCT_SPEC.original.rtf    # Original spec bytes (RTF), preserved verbatim
├── README.md                    # This file
├── AGENTS.md                    # Shared agent instructions (provider-neutral)
├── QWEN.md                      # Qwen Code-specific instructions
├── CLAUDE.md                    # Claude Code-specific instructions
├── docs/
│   ├── ARCHITECTURE.md          # Capabilities, layers, stack decisions & risks
│   ├── DATA_MODEL.md            # SQLite schema, project memory, .promptforge layout
│   ├── SECURITY.md              # Keychain, redaction, consent system
│   ├── DEEPSEEK_INTEGRATION.md  # Provider config, JSON mode, retry, usage
│   ├── TASKSPEC.md              # Task contract semantics & lifecycle
│   ├── MVP_SCOPE.md             # In / out / postponed for the first release
│   ├── IMPLEMENTATION_PLAN.md   # Phases with acceptance criteria & tests
│   └── PROJECT_STATE.md         # Auto-maintained development state (read first)
├── schemas/
│   ├── taskspec.schema.json     # Canonical (enriched) TaskSpec contract
│   ├── compiler-output.schema.json # Compiler model output contract
│   └── fixtures/                # Valid + invalid conformance fixtures
└── tools/
    └── validate-schemas.mjs     # AJV fixture validation script
```

Once implementation starts, `src/` (React app) and `src-tauri/` (Rust shell)
will be added per Phase 1 of the implementation plan.

## Documentation map

- **What to build** → `PRODUCT_SPEC.md` (product intent, Turkish)
- **How it fits together** → `docs/ARCHITECTURE.md`
- **The central contracts** → `docs/TASKSPEC.md` + `schemas/` (compiler
  output + canonical TaskSpec, with fixtures)
- **Where the project stands** → `docs/PROJECT_STATE.md`
- **What ships first** → `docs/MVP_SCOPE.md`
- **Build order** → `docs/IMPLEMENTATION_PLAN.md`
- **Provider API details** → `docs/DEEPSEEK_INTEGRATION.md`
- **Secrets & consent** → `docs/SECURITY.md`
- **Storage & files** → `docs/DATA_MODEL.md`

## Development

Implementation is deliberately phased. Do not start Phase 1 work without an
explicit instruction to do so; each phase in `docs/IMPLEMENTATION_PLAN.md`
has its own objective, acceptance criteria, tests, and completion condition.

For agent-specific working instructions see `AGENTS.md` (shared),
`QWEN.md` (Qwen Code) and `CLAUDE.md` (Claude Code).
