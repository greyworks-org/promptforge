---
name: tool-discovery
description: Find the safest existing tool before building or buying one. Search installed capabilities, Treg, NoSignups and open source in that order.
---

# Tool Discovery

Use this skill when a task needs a capability that is not already obvious.

## Order
1. Inspect already available native tools, plugins, MCP servers and CLIs.
2. Search Treg by capability, not vendor name: `treg catalog search "<job to be done>"`.
3. Search the local NoSignups catalog at `~/.local/share/utku-agent-stack/nosignups/tools.json` when a lightweight no-account browser tool could solve the task.
4. Search reputable open-source alternatives.
5. Only then recommend a new paid subscription or custom implementation.

## Rules
- Never treat a NoSignups listing as a security review.
- Do not upload WASK customer data, secrets, unpublished film footage or proprietary source to a third-party tool unless its privacy/security posture is appropriate and the user has approved that transfer.
- Prefer existing authenticated capabilities over duplicating credentials.
- For Treg, compare capability, price and provider constraints before calling a paid endpoint.
- Never silently purchase, top up, publish, send, delete or make production changes.

## Output
When discovery matters, state which source/tool was selected and why. If no safe tool is available, say what is missing rather than inventing a capability.
