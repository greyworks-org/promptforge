@AGENTS.md

# Claude-specific instructions

- Use planning mode before high-risk architectural, billing or database work.
- Do not over-engineer beyond the task scope.
- Explicitly inspect edge cases and failure states.
- Explain material architectural trade-offs before applying them.

# Project context

Read `docs/PROJECT_STATE.md` first; update it after validated work. The
product requirement is `PRODUCT_SPEC.md` (Turkish). Engineering truth lives
in `docs/`; the task contracts live in `schemas/compiler-output.schema.json`
(model output) and `schemas/taskspec.schema.json` (canonical). Implementation
is phased — see `docs/IMPLEMENTATION_PLAN.md` and do not jump ahead of the
current phase.
