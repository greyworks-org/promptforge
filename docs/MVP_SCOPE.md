# MVP Scope — PromptForge Local

Derived from spec §16, with ambiguities resolved. The MVP definition of done
is at the bottom; every phase in `IMPLEMENTATION_PLAN.md` traces back to an
item here.

## 1. In scope (must ship)

### Application & projects
- Local desktop app (Tauri 2), macOS .dmg dev build (signing/notarization not
  required for MVP).
- Multiple isolated projects; project folder selection; per-project settings.
- Project onboarding wizard: scan README/config files, choose documents,
  draft the project profile with the compiler model, user approval, generate
  AGENTS.md / QWEN.md / CLAUDE.md **suggestions**, write only with consent.
- Markdown context documents in `.promptforge/context/` (the 10 canonical
  files, DATA_MODEL.md §3.1).

### Compilation
- Provider settings: baseUrl, modelId, API key (keychain), connection test.
- Task types (12) and depths Quick / Standard / Deep / Review / Plan with
  Auto resolution (TASKSPEC.md §3).
- Two-contract TaskSpec generation: compiler-output schema (model) →
  bounded repair → enrichment → canonical schema validation (TASKSPEC.md §1);
  JSON mode with fallback; loud failure otherwise.
- Deep mode: compiler + critic (two calls).
- Blocking-question flow (max 3 questions, max 2 rounds).
- Context selection: task-type heuristics, per-doc hashes, summaries (cached
  by hash), tags, SQLite FTS5 (with verified fallback), context budgets.
- Secret redaction (blocked files + patterns) and the "Context sent" preview.
- Renderers: Qwen, Codex, Claude — deterministic, snapshot-tested.
- Result screen: provider tabs, TaskSpec tab, Raw vs Compiled, Context sent,
  verification checklist (no fake quality scores), Copy Prompt, Save Task,
  Write Task File, Edit, Recompile, Mark as Used.

### Measurement
- Prompt history (compilations table) with raw/compiled/provider/tokens.
- DeepSeek token accounting from API `usage` when present, labeled local
  estimates otherwise.
- Manual task outcome recording: completion result, revision count, scope
  violation, tests passed, completion time, user note.
- Per-project and per-provider usage/success aggregates.

### Project memory & agent handoff
- Project registry: stable ids, unique canonical paths,
  `.promptforge/project.json` anchor re-linking moved folders.
- Central per-project memory record (provider-neutral): stack, phase, task
  chain (last validated / current / next), confirmed decisions, blockers &
  risks, relevant files, last test commands & results, task & provider
  history. Automatically maintained from validated work; never hand-edited.
- Read-only git state inspection: latest checkpoint + uncommitted-change
  summary, derived live. Git and project files remain the execution source
  of truth; memory never overrides them.
- Agent handoff for every registered project: deterministic Qwen / Codex /
  Claude continuation prompts from shared memory + live git snapshot +
  current task — zero model calls. Includes interrupted-work recovery
  guidance (uncommitted changes), anti-repetition of completed work, and
  verbatim preservation of scope, decisions and acceptance criteria.
- Works for arbitrary project folders (no hardcoded names, paths, phases or
  technologies).

### Storage & safety
- All data local: SQLite app DB + per-project `.promptforge/`.
- API key in OS keychain only.
- Consent system for every write/launch operation (SECURITY.md §4).
- One-click copy of rendered prompts.

## 2. Out of scope (explicitly not built)

Per spec §16 — these are product-level non-goals, not "later" items:

- Automatic code modification, automatic git commits, automatic deployment.
- Model-driven terminal control of any kind.
- Multi-user systems, accounts, cloud sync, subscriptions/payments.
- GitHub integration.
- Vector database / embeddings.
- Context updates without user approval.
- Running all three target models simultaneously.
- Any git write operation by PromptForge (commit/stash/revert/checkout) —
  git is inspected read-only; the work tree belongs to the user and their
  coding agent.
- Project memory overriding repository reality, or provider-specific
  (Qwen/Codex/Claude) state structures alongside the shared memory record.

## 3. Postponed beyond MVP (backlog, reasons recorded)

| Item | Spec ref | Why postponed |
| --- | --- | --- |
| Image/screenshot attachments | §12 | Requires asset storage in `.promptforge/assets/` + attachment UI; the compile flow already works filename-free. Folder reserved in DATA_MODEL.md §3. |
| Project memory update suggestions ("Suggested context update") | §15 | Needs outcome-driven extra model call + suggestion review UI; high value but not on the critical path of compiling prompts. |
| Qwen Code `/stats` import | §14 | Depends on external export format; manual outcome recording covers MVP measurement. |
| Quick mode with **0** model calls (template-only) | §6 | MVP Quick uses exactly 1 call; zero-call templating adds a second code path for small token savings. |
| Provider comparison analytics screen | §17/Phase 4 | The three result tabs are the MVP comparison surface; dedicated analytics come with measurement maturity. |
| `templates/` folder functionality | §4 | Folder reserved; no MVP behavior defined in the spec. |
| Entropy-based secret blocking (flag-only in MVP) | §13 | False-positive management first; hard blocking of high-entropy strings later. |
| Windows / Linux packaging | §2 | macOS-first per .dmg decision; Tauri keeps the door open. |
| Code signing & notarization | — | Distribution concern, post-MVP. |
| Multiple simultaneous provider profiles in UI | — | Data model already supports N profiles; MVP exposes one active. |

## 4. Definition of done (MVP)

A user can, on macOS, without any network service except their own
DeepSeek-compatible endpoint:

1. configure their provider (baseUrl, modelId, key → keychain) and pass the
   connection test;
2. onboard two separate projects from local folders, with generated context
   docs and AGENTS/QWEN/CLAUDE files written **only after approval**;
3. compile a real informal request in Standard and Deep modes, seeing the
   redacted "Context sent" payload before it is transmitted;
4. receive a schema-valid TaskSpec and three provider prompts, with the
   verification checklist;
5. copy/save the prompt, later record the task outcome, and see per-project
   usage/success aggregates;
6. hand off an in-flight (including interrupted, uncommitted) task to Qwen,
   Codex or Claude via a deterministic continuation prompt built from shared
   memory + live git state — with no model call and no repeated completed
   work;
7. verify: zero cross-project data mixing; zero secrets from the redaction
   corpus transmitted; zero writes to user files without consent; memory
   records match repository reality.

All phase completion conditions in `IMPLEMENTATION_PLAN.md` satisfied, all
unit/snapshot tests green, manual E2E checklist executed.

## 5. Success criteria (spec §18)

Measured after the first 50 real tasks post-release (product analytics, not
features — MVP only has to *record* the underlying data):

| Metric | Target |
| --- | --- |
| First-try correct completion | ≥ +15% |
| Follow-up correction prompts | ≥ −25% |
| Total Qwen credit spend | ≥ −15% |
| Unrelated file changes | ≥ −50% |
| User prompt rewrites | ≥ −30% |
| Cross-project context mixing | 0 |
| Secret transmission | 0 |
