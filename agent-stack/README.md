# Shared Agent Stack

This folder defines the external capability layer used by Codex, OpenCode/WrongStack-compatible agents, and Grok Bot workflows. It intentionally does not add execution capabilities to PromptForge itself.

## Architecture

PromptForge remains the provider-neutral compiler, project-memory and handoff layer. Execution-capable agents use this stack beside PromptForge.

Shared capabilities:
- Addy Osmani Agent Skills: engineering workflows and quality gates.
- Graphify: codebase/dependency graph intelligence.
- Treg: external tool/API registry and credential-injection layer.
- NoSignups: local discovery catalog for lightweight no-account/open tools.
- `tool-discovery`: routing policy that prefers existing capabilities before new subscriptions/builds.

Film capabilities:
- `film-production` skill.
- video-use for transcript-driven analysis and rough cuts.
- DaVinci Resolve MCP for professional timeline, color, Fusion, Fairlight and render operations.

WASK Labs capabilities:
- `wask-project-council` skill for staged research, validation, product, technical, GTM, red-team and scale/kill decisions.

## Install

From macOS terminal:

```bash
cd /Users/utku/Desktop/PromptForge
git fetch
git checkout agent-stack/integrations
bash agent-stack/install.sh
```

The installer is additive/idempotent and finishes by running `agent-stack/verify.sh`. It installs and wires the local Codex/OpenCode stack rather than silently skipping failed integrations.

The installer may ask for two user-controlled items:
1. an ElevenLabs API key, only if you want video-use transcription immediately;
2. the one-time Treg browser login.

Skipping either does not corrupt the setup; the final health check reports the capability as WARN rather than pretending it is ready.

## Grok Bot

Grok Bot uses a separate cloud computer, so a shell script on the Mac cannot configure it. After local installation, use `agent-stack/GROK_BOOTSTRAP.md` once in Grok Bot. It creates the matching WASK Project Council, Tool Discovery and Agent Handoff behaviors and guides Treg setup on the Grok computer.

DaVinci Resolve MCP remains local because the server must run on the same Mac as DaVinci Resolve.

## Verification

Re-run at any time:

```bash
bash agent-stack/verify.sh
```

A fully installed local stack should have zero FAIL entries. WARN is expected when an optional credential is intentionally omitted or when DaVinci Resolve is not installed/running.

## Important boundary

PromptForge itself does not execute these tools. It may hand tasks to an execution runtime that has them installed, but PromptForge's existing read-only/execution security boundary remains unchanged.
