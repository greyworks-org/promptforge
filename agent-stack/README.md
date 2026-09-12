# Shared Agent Stack

This folder defines the external capability layer used by Codex, OpenCode/WrongStack-compatible agents, and Grok Bot workflows. It intentionally does not add execution capabilities to PromptForge itself.

## Architecture

PromptForge remains the provider-neutral compiler, project-memory and handoff layer. Execution-capable agents use this stack beside PromptForge.

Shared capabilities:
- Addy Osmani Agent Skills: engineering workflows and quality gates.
- Graphify: codebase/dependency graph intelligence.
- Treg: external tool/API registry and credential-injection layer.
- NoSignups: discovery source for lightweight no-account/open tools.

Film profile:
- video-use: transcript-driven rough cut and automated video editing.
- DaVinci Resolve MCP: professional NLE control from an MCP-capable agent.

WASK Labs profile:
- WASK Project Council: staged multi-agent research, validation, product, technical, GTM and red-team process.

## Install

Run from macOS terminal:

```bash
cd /Users/utku/Desktop/PromptForge
bash agent-stack/install.sh
```

The installer is additive and idempotent. It never writes API keys. Where a tool requires login or an API key, it stops at configuration and prints the next action.

## Runtime policy

Agents should follow `policies/TOOL_DISCOVERY.md` before introducing a new subscription, dependency or manual workaround.

For film work, load `profiles/FILM.md`.
For new WASK product work, load `profiles/WASK_LABS.md`.

## Important boundary

PromptForge must not execute these tools itself. It may hand off tasks to an execution runtime that has them installed, but its existing security boundary remains unchanged.
