/**
 * Context document skeleton templates (Phase 3).
 *
 * The 10 canonical context documents per DATA_MODEL.md §3.1.
 * Each skeleton is a Markdown template with a header and placeholder
 * sections. During onboarding, the profile-drafting service can fill
 * these via the provider API; the user can edit any draft before it
 * is written.
 */

export interface ContextDocTemplate {
  filename: string;
  title: string;
  content: string;
}

export function productDoc(): ContextDocTemplate {
  return {
    filename: 'PRODUCT.md',
    title: 'Product',
    content: `# Product

## Purpose

[What problem does this product solve?]

## Value proposition

[Why would someone use this?]

## Target users

[Who is this product built for?]
`,
  };
}

export function architectureDoc(): ContextDocTemplate {
  return {
    filename: 'ARCHITECTURE.md',
    title: 'Architecture',
    content: `# Architecture

## Tech stack

[Languages, frameworks, databases, services.]

## Project structure

\`\`\`
[High-level folder layout.]
\`\`\`

## Key architectural decisions

- [Decision 1]
- [Decision 2]
`,
  };
}

export function designDoc(): ContextDocTemplate {
  return {
    filename: 'DESIGN.md',
    title: 'Design',
    content: `# Design

## Visual language

[Design system, component library, branding.]

## Component rules

[How components are structured and styled.]

## Layout conventions

[Spacing, responsiveness, navigation patterns.]
`,
  };
}

export function dataModelDoc(): ContextDocTemplate {
  return {
    filename: 'DATA_MODEL.md',
    title: 'Data Model',
    content: `# Data Model

## Tables / Collections

[Primary data entities and their relationships.]

## Relations

[How entities connect to each other.]

## Permissions

[Access control rules for data.]
`,
  };
}

export function integrationsDoc(): ContextDocTemplate {
  return {
    filename: 'INTEGRATIONS.md',
    title: 'Integrations',
    content: `# Integrations

## External services

[Stripe, Supabase, email, third-party APIs.]

## Authentication

[Auth provider and flow.]

## Billing

[Payment processing and subscription management.]
`,
  };
}

export function securityDoc(): ContextDocTemplate {
  return {
    filename: 'SECURITY.md',
    title: 'Security',
    content: `# Security

## Security rules

[Authentication, authorization, data protection.]

## Sensitive areas

[Parts of the codebase that handle secrets, payments, or PII.]

## Do not touch

[Files or flows that must not be changed without explicit review.]
`,
  };
}

export function testingDoc(): ContextDocTemplate {
  return {
    filename: 'TESTING.md',
    title: 'Testing',
    content: `# Testing

## Test commands

\`\`\`bash
# Run unit tests
# Run linter
# Run type checker
\`\`\`

## Environments

[Local, staging, production — how to access each.]

## Deployment

[How the project is built and deployed.]
`,
  };
}

export function decisionsDoc(): ContextDocTemplate {
  return {
    filename: 'DECISIONS.md',
    title: 'Decisions',
    content: `# Decisions

## Confirmed decisions

- [Decision, date, context.]

## Hard constraints

[Things that must not change without explicit approval.]
`,
  };
}

export function currentStateDoc(): ContextDocTemplate {
  return {
    filename: 'CURRENT_STATE.md',
    title: 'Current State',
    content: `# Current State

## What works

[Features and flows that are complete and stable.]

## What is missing

[Known gaps, in-progress work.]

## Active problems

[Bugs, performance issues, tech debt being addressed.]
`,
  };
}

export function backlogDoc(): ContextDocTemplate {
  return {
    filename: 'BACKLOG.md',
    title: 'Backlog',
    content: `# Backlog

## Current milestone

[What is being worked on right now.]

## Planned tasks

- [Task 1]
- [Task 2]

## Future

[Ideas and deferred work.]
`,
  };
}

/** All 10 context doc templates in canonical order. */
export function allContextDocTemplates(): ContextDocTemplate[] {
  return [
    productDoc(),
    architectureDoc(),
    designDoc(),
    dataModelDoc(),
    integrationsDoc(),
    securityDoc(),
    testingDoc(),
    decisionsDoc(),
    currentStateDoc(),
    backlogDoc(),
  ];
}
