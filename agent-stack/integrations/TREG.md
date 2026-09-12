# Treg Integration

Purpose: make Treg the first structured external-tool registry for Codex/Grok/OpenCode-style agents before adding separate SaaS subscriptions or one-off API integrations.

## Policy

When an agent needs external structured data or an action API:
1. Search current installed MCP/CLI/tool capabilities.
2. Search Treg by task intent, not vendor name.
3. Inspect endpoint price, provider, input/output schema and data sensitivity.
4. Use the bounded endpoint if it is suitable.
5. If unavailable, continue with NoSignups/open-source discovery or propose a new integration.

## Credential rules

- Prefer server-side/provider-side credential injection.
- Never place provider keys in prompts, repo files, AGENTS.md, logs or generated reports.
- Use a separate Treg credential/profile for experimentation vs production where supported.
- Do not send customer PII, WASK secrets or unreleased film media through a new provider without reviewing that provider first.

## Agent-facing instruction

Treat Treg as a tool registry, not as a truth source. Verify high-impact commercial/research claims against primary sources when the endpoint data can be stale or inferred.

## Grok Bot

Expose the same discovery order in Grok Bot instructions. If Treg is available through an HTTP/API bridge or MCP wrapper, prefer that shared path rather than duplicating provider credentials inside Grok bots.
