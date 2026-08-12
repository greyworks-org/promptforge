# TaskSpec — the canonical contract

PromptForge has **two machine-readable contracts** (both JSON Schema,
draft 2020-12):

| Schema | Role | Produced by | Client-owned ids |
| --- | --- | --- | --- |
| `schemas/compiler-output.schema.json` | what the compiler model must return | the model | **absent — rejected** |
| `schemas/taskspec.schema.json` | the canonical (enriched) TaskSpec | the client, by enrichment | **required** |

The compiler model never assigns `task_id`, `project_id`, or
`schema_version`; the client does, after validation. Deterministic renderers
consume only canonical TaskSpecs. This document defines the semantics around
both contracts.

## 1. Lifecycle

```
raw provider response (text)
  1. extract & normalize   locate JSON (strip code fences / surrounding prose);
                           parse; strip exactly the three client-owned keys
                           (task_id, project_id, schema_version) if present;
                           default a missing requirements object to empty arrays
  2. validate              against compiler-output.schema.json (Zod mirror, strict;
                           unknown fields REJECTED, not stripped)
     └─ invalid → bounded repair: ONE repair call, then validate again
                  (DEEPSEEK_INTEGRATION.md §4); still invalid → loud failure
  3. enrich                client assigns task_id, project_id, schema_version;
                           recomputes the local token estimate
  4. canonical validate    against taskspec.schema.json — enrichment is
                           deterministic, so this must always pass (assert;
                           a failure is a client bug, not a model error)
  5. render                profile-aware renderers (pure functions: TaskSpec + ExecutionProfile → prompt)
  6. persist               compilations.taskspec_json; on "Save Task":
                           .promptforge/tasks/; project memory task-chain updated
```

Only canonical (enriched) TaskSpecs are stored, rendered, or exported. Raw
model JSON is never treated as a TaskSpec.

## 2. Field reference

Ownership: **model** = produced by the compiler (compiler-output contract);
**client** = assigned by PromptForge during enrichment, must never appear in
compiler output; **shared** = model proposes, client may override.

| Field | Type | Required | Owner | Semantics |
| --- | --- | --- | --- | --- |
| `schema_version` | `"1.0.0"` | canonical: **yes** · compiler output: must be absent | client | Contract version; stamped during enrichment. |
| `task_id` | string `TASK-YYYY-NNNN…` | canonical: **yes** · compiler output: must be absent | client | Sequential per project/year; assigned during enrichment. |
| `project_id` | string | canonical: **yes** · compiler output: must be absent | client | Isolation boundary; assigned from the active project during enrichment. |
| `task_type` | enum | **yes** | model | Classification of the work; drives context heuristics. |
| `execution_mode` | enum | **yes** | shared | Resolved depth. `auto` is a UI concept and never valid here. |
| `target_model` | string 1–128 | **yes** | shared | AI model that will execute (e.g. `deepseek-v4-pro`, `qwen-3.8-max`). Model identity, not runtime. |
| `agent_runtime` | enum | **yes** | shared | Coding agent/runtime: `claude-code`, `qwen-code`, `codex`. Determines renderer family and instruction files. |
| `execution_profile` | string 1–128 | **yes** | shared | Profile key (e.g. `deepseek-v4-pro-claude-code`) resolving to a versioned profile definition. Adapts working style only; never changes task meaning. The profile registry validates model+runtime+profile compatibility at compile time. |
| `objective` | string 10–500 | **yes** | model | One explicit outcome sentence. |
| `user_value` | string ≤500 | no | model | Why it matters. |
| `current_state` | string[] | no | model | Known facts only (spec rule 3: facts ≠ assumptions). |
| `relevant_context` | string[] ≤20 | no | model | Repo-relative paths the agent should read; must be a subset of context actually sent. |
| `assumptions` | string[] ≤20 | no | model | Decisions taken without asking; surfaced verbatim in prompts. |
| `blocking_questions` | string[] ≤3 | no | model | Only spec §10 "must ask" categories. >3 ⇒ invalid. |
| `scope` | string[] ≥1 | **yes** | model | Bounded work items. |
| `out_of_scope` | string[] | no | model | Explicit exclusions. |
| `requirements` | object of 7 string arrays | yes (object), arrays may be empty | model | Categories: functional, frontend, backend, data, security, accessibility, performance. Empty categories are legitimate — invented filler is a defect. |
| `edge_cases` | string[] | no | model | Failure states and boundaries. |
| `acceptance_criteria` | string[] ≥1 | **yes** | model | Verifiable completion conditions. (Spec example showed `[]`; this contradicts spec §9's checklist and is corrected here.) |
| `execution_plan` | string[] | no (expected for deep/plan) | model | Ordered steps. |
| `test_plan` | string[] | no | model | Targeted tests/validation commands. |
| `stop_conditions` | string[] ≤20 | no | model | When to stop and ask (destructive/irreversible ops). |
| `final_report` | string[] ≤20 | no | model | **Reporting requirements**: what the executing agent must report on completion (changed files, test results, assumptions, risks). Not a report itself — the task hasn't run yet. |
| `execution_contract` | object | no | model | Optional compact contract: `core_loop`, `invariants`, `preserve`, `verification`, and ordered `delivery_slices` (maximum 5). Omit unsupported categories. |
| `quality_profile` | object | no | model/client | Optional UI/copy quality context: product outcome, UX constraints, explicit preferences, compact anti-slop defaults, completion checks, and `visual_review`. Never emitted for backend-only work. |
| `risk_level` | `low\|medium\|high` | **yes** | model | Influences renderer emphasis. |
| `confidence` | number 0–1 | no | model | Informational only; never displayed as a quality score. |
| `estimated_prompt_tokens` | integer ≥0 | no | model | Advisory; client recomputes locally. |

## 3. Enums

```
task_type:       planning | feature | ui | backend | database | integration |
                 bugfix | refactor | review | security | testing | deployment
execution_mode:  quick | standard | deep | review | plan
agent_runtime:   claude-code | qwen-code | codex
risk_level:      low | medium | high
```

`task_type` maps 1:1 from the spec §8 list (Planlama, Yeni özellik, Arayüz,
Backend, Veritabanı, Entegrasyon, Hata düzeltme, Yeniden yapılandırma, Kod
inceleme, Güvenlik, Test, Yayına alma).

Mode resolution when the UI depth is `auto`:

| Task type | Resolved mode |
| --- | --- |
| review | `review` |
| planning | `plan` |
| ui (trivial, per request-length heuristic) | `quick` |
| database, security, deployment, integration | `deep` |
| everything else | `standard` |

The heuristic table is plain code (no model call) and intentionally simple.

## 4. Invariants

1. Canonical (stored/rendered) TaskSpecs always contain `task_id`,
   `project_id`, `schema_version` — all three are required by
   `taskspec.schema.json`.
2. Compiler output never contains client-owned identifiers. Normalization
   strips exactly those three keys; anything else unknown is **rejected** by
   `compiler-output.schema.json` (`additionalProperties: false`) and routed
   to the bounded repair path — a chatty model cannot smuggle content into
   the contract.
3. `blocking_questions` never exceeds 3 (spec §10).
4. `assumptions` and `blocking_questions` are mutually exclusive in intent:
   anything asked is not assumed, anything assumed is not asked.
5. Every `relevant_context` entry must correspond to a document included in
   the compile payload (renderer and checklist verify this).
6. `acceptance_criteria` is non-empty.
7. A TaskSpec belongs to exactly one project; no API copies them across.
   `project_id` comes from the client's active project, never from the model.
8. Canonical validation after enrichment must always succeed; a failure is a
   client bug (assert, do not retry the model).
9. Repair is bounded: at most one repair call per compile attempt
   (DEEPSEEK_INTEGRATION.md §4). The pipeline never loops.
10. `delivery_slices`, when present, contains at most five ordered slices;
    later slices are not automatically executed by PromptForge.
11. Generic quality defaults are limited to visual-surface tasks. Explicit
    project guidance and user preferences take precedence; backend-only tasks
    do not receive visual rules.

## 5. Blocking questions and assumptions (spec §10)

- Must ask: billing/payment provider unknown, data deletion or migration,
  architecture choices that change product behavior, unclear authorization
  rules, user intent that splits into two clearly different outcomes.
- Must not ask: cosmetic UI values, filename trivia, reversible visual
  choices, anything answerable from the provided design system.
- When the model returns blocking questions, the UI asks the user, appends
  answers to the payload, and re-runs compilation (max 2 rounds, then fail
  loudly — no infinite loops).
- Unasked assumptions must appear verbatim in the rendered prompt as:

  ```
  Assumption:
  <text>
  ```

## 6. Examples (conformance fixtures)

The spec's example, fixed to satisfy its own checklist (one acceptance
criterion added). The same task shown in both contract shapes — the
difference is exactly the three client-owned fields:

**Compiler output** — `schemas/fixtures/compiler-output/valid-full.json`
(no `task_id`, no `project_id`, no `schema_version`; identical otherwise):

```json
{
  "task_type": "feature",
  "execution_mode": "standard",
  "target_model": "deepseek-v4-pro",
  "agent_runtime": "claude-code",
  "execution_profile": "deepseek-v4-pro-claude-code",
  "objective": "Authenticated users can view their AI credit usage.",
  "user_value": "Users understand remaining usage before reaching the limit.",
  "current_state": [
    "Authentication already exists",
    "Stripe subscription records are stored in Supabase"
  ],
  "relevant_context": ["DESIGN.md", "DATA_MODEL.md", "INTEGRATIONS.md"],
  "assumptions": [],
  "blocking_questions": [],
  "scope": [
    "Create the usage page",
    "Show plan, consumed credits and renewal date",
    "Add loading, empty and error states"
  ],
  "out_of_scope": ["Creating new Stripe prices", "Admin reporting", "Email notifications"],
  "requirements": {
    "functional": [], "frontend": [], "backend": [], "data": [],
    "security": [], "accessibility": [], "performance": []
  },
  "edge_cases": [],
  "acceptance_criteria": [
    "Usage page renders plan, consumed credits and renewal date for a logged-in user"
  ],
  "execution_plan": [],
  "test_plan": [],
  "stop_conditions": [],
  "final_report": [],
  "risk_level": "medium",
  "confidence": 0.87,
  "estimated_prompt_tokens": 1450
}
```

**Canonical TaskSpec after enrichment** —
`schemas/fixtures/taskspec/valid-full.json` — the client prepends:

```json
{
  "schema_version": "1.0.0",
  "task_id": "TASK-2026-0042",
  "project_id": "project-ai-feedback",
  "…": "all compiler-output fields unchanged"
}
```

The full fixture suite lives in `schemas/fixtures/` (valid + invalid cases
for both contracts: client-owned ids present in compiler output, unknown
fields, > 3 blocking questions, empty acceptance criteria, missing required
fields, bad enums, malformed task ids). `tools/validate-schemas.mjs` checks
the whole suite with AJV.

## 7. Versioning policy

- `compiler-output.schema.json` and `taskspec.schema.json` share one contract
  version (`1.0.0` today) and change together in the same commit.
- Breaking contract changes bump the major in `schema_version`; additive
  optional fields bump minor and are backward-compatible.
- The Zod mirrors and both JSON Schemas change in the same commit; the
  fixture suite in `schemas/fixtures/` (checked by `tools/validate-schemas.mjs`)
  is the regression gate.

## 8. Renderer consumption rules

Renderers may use every field but must:

- render `assumptions` verbatim with the `Assumption:` prefix,
- render `blocking_questions` only in the "needs answers" UI state (a TaskSpec
  with open blocking questions is never rendered as a final prompt),
- include `stop_conditions` prominently in claude/qwen outputs and as
  constraints in codex outputs,
- never invent content absent from the TaskSpec.

The same rules bind the **handoff renderers** (ARCHITECTURE.md §11): a
continuation prompt quotes scope, decisions and acceptance criteria verbatim
from the canonical TaskSpec and project memory — and labels progress claims
as evidence, since they are derived from git state rather than asserted.
