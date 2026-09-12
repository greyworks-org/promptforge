# Tool Discovery Policy

When an agent reaches a task it cannot complete with currently loaded capabilities, follow this order before asking the user for a manual workaround.

1. Check already configured MCP servers, CLIs, local scripts and Agent Skills.
2. Check Treg for an existing endpoint/tool/provider.
3. Check NoSignups for a lightweight browser utility that does not require account creation.
4. Check trusted open-source tools.
5. Only then recommend a new paid SaaS, custom integration or manual process.

## Rules

- Prefer an existing installed capability over adding another dependency.
- Never expose API keys or credentials to model context when server-side injection or OS keychain storage is possible.
- Treat NoSignups as discovery, not as a security or quality endorsement.
- Validate the privacy/security implications before uploading proprietary WASK data, unreleased film footage, customer data or credentials to a third-party service.
- Prefer local processing for unreleased film assets and sensitive code where practical.
- For a new dependency, record: purpose, license, maintenance status, data sent externally, credentials required and uninstall path.
- Do not silently sign up, purchase, publish, deploy, delete or send externally.

## Selection heuristic

Choose the smallest capable tool. Avoid using a broad SaaS platform when a bounded local/open tool can safely perform the task.
