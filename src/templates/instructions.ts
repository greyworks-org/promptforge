/**
 * Provider instruction templates (Phase 3).
 *
 * AGENTS.md — shared, provider-neutral rules.
 * QWEN.md   — Qwen-specific addendum.
 * CLAUDE.md — Claude-specific addendum (references AGENTS.md).
 *
 * These are the initial drafts shown in the onboarding wizard; the user
 * can edit them before any file is written. The app never overwrites
 * existing files without consent (SECURITY.md §4).
 */

export interface InstructionTemplate {
  filename: string;
  content: string;
}

export function agentsMdTemplate(projectName: string): string {
  return `# AGENTS.md — ${projectName}

Shared, provider-neutral instructions for any coding agent working on this
repository. Provider-specific additions live in QWEN.md and CLAUDE.md;
do not duplicate these rules there.

## Architecture rules

- [Describe your tech stack and architectural constraints here.]
- Product logic lives in [directory]; keep it separate from [infrastructure/config].

## Coding standards

- [Language/framework conventions.]
- Names in English; comments only where "why" is not obvious from the code.

## Hard security rules

- Never commit secrets.
- [Any additional security rules specific to this project.]

## Test & validation commands

\`\`\`bash
# Add your project's test/lint/typecheck commands here.
\`\`\`

## Working discipline

- Read relevant docs and existing code before changing anything.
- Do not modify unrelated files.
- Destructive or irreversible operations require explicit user confirmation.
`;
}

export function qwenMdTemplate(projectName: string): string {
  return `# Qwen-specific instructions

- Follow AGENTS.md as the shared repository instruction source.
- Inspect relevant existing files before making changes.
- Do not scan the full repository unless the task requires it.
- Prefer targeted tests over the complete suite during iteration.
- Do not create subagents unless the task is explicitly marked Deep.
- Stop before destructive database or deployment operations.
- At completion, report changed files, tests, assumptions and remaining risks.

# Project context

Read \`.promptforge/context/\` for up-to-date ${projectName} documentation.
`;
}

export function claudeMdTemplate(projectName: string): string {
  return `@AGENTS.md

# Claude-specific instructions

- Use planning mode before high-risk architectural, billing or database work.
- Do not over-engineer beyond the task scope.
- Explicitly inspect edge cases and failure states.
- Explain material architectural trade-offs before applying them.

# Project context

Read \`.promptforge/context/\` for up-to-date ${projectName} documentation.
`;
}

export function allTemplates(projectName: string): InstructionTemplate[] {
  return [
    { filename: 'AGENTS.md', content: agentsMdTemplate(projectName) },
    { filename: 'QWEN.md', content: qwenMdTemplate(projectName) },
    { filename: 'CLAUDE.md', content: claudeMdTemplate(projectName) },
  ];
}
