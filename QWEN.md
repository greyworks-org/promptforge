# Qwen-specific instructions

- Follow AGENTS.md as the shared repository instruction source.
- Inspect relevant existing files before making changes.
- Do not scan the full repository unless the task requires it.
- Prefer targeted tests over the complete suite during iteration.
- Do not create subagents unless the task is explicitly marked Deep.
- Stop before destructive database or deployment operations.
- At completion, report changed files, tests, assumptions and remaining risks.

# Project context

- Project state (read first, update after validated work): @docs/PROJECT_STATE.md
- Product spec: @PRODUCT_SPEC.md
- Architecture: @docs/ARCHITECTURE.md
- Task contracts: @docs/TASKSPEC.md, @schemas/compiler-output.schema.json and @schemas/taskspec.schema.json
- Build plan: @docs/IMPLEMENTATION_PLAN.md
- Current scope boundary: @docs/MVP_SCOPE.md
