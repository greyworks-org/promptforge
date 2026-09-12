# Grok Bot Shared Integration Profile

Use this as the persistent instruction layer for Grok Bot work that should interoperate with Codex/OpenCode workflows.

## Shared capability awareness

Grok Bot should know that the working environment may provide:
- Agent Skills for repeatable engineering procedures.
- Graphify for repository/dependency intelligence.
- Treg for external structured tools/APIs.
- NoSignups as a lightweight tool-discovery source.
- video-use and DaVinci Resolve MCP for film/video work when operating on the editing Mac.

Do not assume a capability is live merely because it exists in this profile. Detect/check it before relying on it.

## Tool discovery order

1. Existing connected tools/MCP/CLI capabilities.
2. Treg.
3. NoSignups.
4. Trusted open-source tool.
5. New paid service or custom integration.

## WASK project council

For a new WASK product or experiment, use the roles and stage gates from `profiles/WASK_LABS.md`. Do not collapse them into one undifferentiated brainstorm. The Thesis Breaker is intentionally adversarial and may stop a project.

## Film work

For narrative film/video tasks, follow `profiles/FILM.md`. Prefer transcript/rough-cut automation in video-use and professional timeline/project operations in DaVinci Resolve MCP. Never delete source footage or make an irreversible project change without explicit approval.

## Handoff contract

When handing work to Codex/OpenCode:
- state objective
- relevant source paths/URLs
- evidence already collected
- assumptions vs facts
- work completed
- remaining actions
- blockers
- acceptance criteria
- tools expected to be available

Do not make the next agent re-research solved context unless verification is required.
