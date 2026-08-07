# Design Tool Integration — PromptForge Local

Status: **contract only** (no implementation). This document defines the
provider-neutral design tool contract, the Figma workspace, and the
security/action/usage policies that any implementation must enforce.

## 1. Architecture: workspace vs project bindings

Design tool configuration is split into two layers:

| Layer | Scope | Contains |
| --- | --- | --- |
| `DesignToolWorkspace` | Installation-level (one per provider) | Connection config, security boundary (`team_id`, `folder_id`), action policy, usage policy |
| `DesignToolProjectBinding` | Per-project | Workspace reference + project-specific `approvedFileKeys` |

The security boundary (`team_id`, `folder_id`) is configured **once** at the
installation level. Individual PromptForge projects bind to that workspace
and maintain their own approved fileKeys. Scope/security configuration is
never duplicated per project.

### 1.1 DesignToolWorkspace (installation-level)

```ts
interface DesignToolWorkspace {
  /** Stable workspace identifier (e.g. "figma-wask-default"). */
  workspaceId: string;
  /** Provider key (e.g. "figma"). */
  provider: string;
  /** Workspace configuration version for audit trail. */
  version: string;

  /** Connection configuration — provider-specific. */
  connection: DesignToolConnection;

  /** Security boundary — the allowed scope. */
  security: WorkspaceSecurity;

  /** Action policy — what may run automatically. */
  actions: ActionPolicy;

  /** Usage policy — when the tool should and should not be invoked. */
  usage: UsagePolicy;
}
```

### 1.2 DesignToolProjectBinding (per-project)

```ts
interface DesignToolProjectBinding {
  /** References the parent workspace. */
  workspaceId: string;
  /** Provider key (must match workspace). */
  provider: string;
  /** Project this binding belongs to. */
  projectId: string;

  /** Explicitly approved fileKeys for this project. Operations on
   *  unlisted files are denied. An empty list means "none yet approved,
   *  all denied." FileKeys may be added (via verified scope operations
   *  or explicit user action) and revoked (user action only). The
   *  authorization history is recorded in an append-only audit log
   *  separate from this active allowlist. */
  approvedFileKeys: string[];

  /** Whether the workspace scope has been positively verified for this
   *  project's binding (must be true for any operation). */
  scopeVerified: boolean;
  /** ISO-8601 timestamp of last positive scope verification. */
  lastScopeVerifiedAt: string | null;

  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}
```

## 2. Figma workspace (first provider)

### 2.1 Connection

```ts
interface DesignToolConnection {
  /** Provider-specific base configuration. */
  teamId: string;
  /** Access token stored in OS keychain (same pattern as provider API keys
   *  — docs/SECURITY.md §2). Never in this struct, never in the DB. */
  tokenKeychainAccount: string;
}
```

### 2.2 Workspace security boundary

```ts
interface WorkspaceSecurity {
  /** Figma team/workspace identifier. All operations are confined here. */
  teamId: string;
  /** Figma folder/project identifier. NOT interchangeable with PromptForge
   *  projectId. All file operations must target this folder. */
  folderId: string;
}
```

### 2.3 Concrete Figma workspace

```json
{
  "workspaceId": "figma-wask-default",
  "provider": "figma",
  "version": "1.0.0",
  "connection": {
    "teamId": "1156142985904303378",
    "tokenKeychainAccount": "promptforge/figma-wask-default"
  },
  "security": {
    "teamId": "1156142985904303378",
    "folderId": "636134446"
  },
  "actions": {
    "autoRun": [
      "read-file-metadata",
      "read-file-content",
      "read-file-nodes",
      "read-file-components",
      "read-file-styles",
      "read-comments",
      "read-team-projects",
      "read-project-files"
    ],
    "approvalGated": [
      "create-file",
      "update-file-content",
      "update-file-nodes",
      "update-file-components",
      "update-file-styles",
      "add-comment",
      "resolve-comment"
    ],
    "alwaysBlock": [
      "figma-make",
      "ai-generation",
      "ai-image-generation",
      "purchase-credits",
      "change-billing",
      "change-seat-settings",
      "share-file",
      "publish-file",
      "invite-collaborator",
      "change-permissions",
      "change-visibility",
      "delete-file",
      "delete-folder",
      "move-file",
      "copy-file-outside-folder"
    ],
    "unclassifiedPolicy": "block"
  },
  "usage": {
    "allowedTaskTypes": ["feature", "ui", "review"],
    "deniedTaskTypes": ["backend", "database", "integration", "security", "testing", "deployment"],
    "preferExistingFiles": true,
    "maxIterationsPerTask": 3,
    "verificationEnabled": true
  }
}
```

## 3. Action policy (fail-closed, cost-enforcing)

The action policy controls which Figma operations may execute and under
what conditions. It makes no assumptions about provider billing categories.
PromptForge MUST NOT infer that an operation is free, seat-included, or
non-chargeable. Operations that cannot be positively classified as
non-chargeable are **blocked** — user approval cannot override the
no-cost policy.

### 3.1 `autoRun` — known non-chargeable reads

Operations on this list MAY run automatically (subject to scope
verification and usage policy). These are read-only, non-mutating,
non-AI operations. For Figma:

- `read-file-metadata`, `read-file-content`, `read-file-nodes`
- `read-file-components`, `read-file-styles`
- `read-comments`
- `read-team-projects`, `read-project-files`

### 3.2 `approvalGated` — known non-chargeable sensitive mutations

Operations on this list are known to be non-chargeable but are sensitive
(they mutate state within the allowed scope). They require explicit,
per-operation user approval before execution. User approval may ONLY
apply to operations on this list. For Figma:

- `create-file`, `update-file-content`, `update-file-nodes`
- `update-file-components`, `update-file-styles`
- `add-comment`, `resolve-comment`

### 3.3 `alwaysBlock` — always denied

Operations on this list MUST NOT execute under any circumstances. User
approval cannot override this block. Three categories:

**AI / credit-consuming** (cost policy — §2.1 of the product requirement):
- `figma-make`, `ai-generation`, `ai-image-generation`
- `purchase-credits`, `change-billing`, `change-seat-settings`

**Permission / visibility changes** (security policy):
- `share-file`, `publish-file`, `invite-collaborator`
- `change-permissions`, `change-visibility`

**Destructive / scope-escape** (security policy):
- `delete-file`, `delete-folder`
- `move-file`, `copy-file-outside-folder`

### 3.4 `unclassifiedPolicy: "block"` — unknown = denied

Any operation NOT on `autoRun`, `approvalGated`, or `alwaysBlock` is
**unclassified**. The policy for unclassified operations is **block**:
deny execution. PromptForge MUST NOT execute an unclassified operation,
even if the provider's documentation suggests it is free or seat-included.
Only adding the operation to `autoRun` or `approvalGated` (via a
configuration update) permits it.

User approval can never override the `alwaysBlock` or `unclassifiedPolicy`
blocks. The cost boundary is not waivable.

### 3.5 Runtime action check

```
1. Is the operation on autoRun?        → yes → proceed to scope verification
2. Is the operation on approvalGated?  → yes → require per-operation user approval
3. Is the operation on alwaysBlock?    → yes → reject (blocked — explain why)
4. Unclassified                        → reject (blocked — unknown billing/credit impact)
```

## 4. Security rules (deny-by-default, fail-closed)

### 4.1 Scope enforcement

1. **Deny by default.** Any Figma operation that cannot be positively
   verified against the configured workspace security boundary MUST be
   rejected. Unknown state is treated as denied.
2. **Positive scope verification.** Before any Figma operation, PromptForge
   MUST verify the target file or creation target belongs to
   `team_id: 1156142985904303378` AND resides within `folder_id: 636134446`.
   If the available Figma API or MCP cannot positively prove membership,
   the operation MUST be denied. "Probably in scope" is not sufficient.
3. **Never escape scope.** PromptForge MUST NOT search, read, create, edit,
   copy, move, or otherwise access:
   - Another WASK Team project or folder
   - Drafts (the user's private draft space)
   - The team root
   - Any file whose `fileKey` is not in the project binding's
     `approvedFileKeys` (an empty list means "none yet approved, all denied")
4. **No permission changes.** PromptForge MUST NOT share, publish, invite
   collaborators, alter permissions, or change file visibility.
5. **No destructive folder operations.** PromptForge MUST NOT delete,
   rename, or move the configured Figma folder (`folder_id: 636134446`).
6. **Unknown fileKeys rejected.** A `fileKey` that cannot be verified
   against the workspace security boundary MUST be rejected before any
   operation.
7. **Identifier type safety.** `folder_id` (Figma), `projectId`
   (PromptForge internal), and `fileKey` (Figma) are distinct types. Code
   MUST keep them separate and require positive validation before any
   operation that bridges them.

### 4.2 Storage rules

- The workspace configuration (`DesignToolWorkspace`) is stored in the app
  settings (same pattern as provider profiles — `docs/DATA_MODEL.md` §1.5).
- Project bindings (`DesignToolProjectBinding`) are stored in a
  project-scoped table in the central SQLite database.
- `approvedFileKeys` are stored per-project, never in project repositories.
- FileKeys discovered during verified scope operations may be added to
  `approvedFileKeys` automatically; fileKeys from any other source require
  explicit user approval.
- The Figma API access token is stored in the OS keychain (same pattern as
  provider API keys — `docs/SECURITY.md` §2). The keychain account name is
  stored in the workspace connection config; the secret itself never enters
  the database.

## 5. Usage policy

### 5.1 When to invoke Figma

PromptForge SHOULD invoke Figma only for material UI/UX work where design
tool access adds clear value:

- **Feature tasks** with a frontend component that changes the visual
  hierarchy, layout, or component structure.
- **UI tasks** that explicitly target design-system alignment or visual
  changes.
- **Review tasks** where implementation-vs-design verification is
  requested.

### 5.2 When NOT to invoke Figma

PromptForge MUST NOT invoke Figma for:

- Backend-only, database, integration, security, testing, or deployment
  tasks.
- Insignificant visual changes (copy edits, spacing tweaks, color
  adjustments that are unambiguously covered by existing design tokens).
- Tasks where the relevant screens/components are already covered by an
  approved design file in the project binding.

### 5.3 Efficiency rules

- Prefer reading existing approved design files over creating new ones.
- Limit context to affected screens/components, not entire files.
- Avoid unnecessary reads: if a file was read earlier in the same
  compilation, reuse the cached response.
- Bound design iterations: `maxIterationsPerTask` caps the number of
  design-tool round-trips per compilation.

### 5.4 Implementation-vs-design verification

When `verificationEnabled` is true and a task includes UI changes:

1. After the coding agent reports completion, PromptForge MAY compare the
   implemented output against the relevant Figma file.
2. Mismatches are surfaced as checklist items (not quality scores).
3. Verification is informational only — it never blocks task completion.

## 6. Data model

### 6.1 Workspace configuration (app settings)

The `DesignToolWorkspace` is stored under a `design.workspaces` settings key
(same pattern as `provider.profiles` — `docs/DATA_MODEL.md` §1.5). One entry
per provider.

```json
{
  "design": {
    "workspaces": {
      "figma-wask-default": { /* full DesignToolWorkspace */ }
    }
  }
}
```

### 6.2 Project bindings (per-project tables)

```sql
CREATE TABLE design_tool_bindings (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL,
  provider        TEXT NOT NULL,
  approved_file_keys_json TEXT NOT NULL DEFAULT '[]',
  scope_verified  INTEGER NOT NULL DEFAULT 0,
  last_scope_verified_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (project_id, provider)
);

-- Append-only audit log of all allowlist changes.
CREATE TABLE design_tool_allowlist_audit (
  id              TEXT PRIMARY KEY,
  binding_id      TEXT NOT NULL REFERENCES design_tool_bindings(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,            -- 'add' | 'revoke'
  file_key        TEXT NOT NULL,
  source          TEXT NOT NULL,            -- 'verified-scope' | 'user-action'
  reason          TEXT,                     -- user-provided reason for revocation
  recorded_at     TEXT NOT NULL
);
```

Rules:
- One binding row per project per provider.
- `workspace_id` references the installation-level workspace configuration
  stored in `settings.value` under `design.workspaces.<id>`.
- `approved_file_keys_json` is the **active** allowlist. FileKeys may be
  added via verified scope operations or explicit user action, and revoked
  via explicit user action. Revocation removes the key from the active
  allowlist immediately.
- `design_tool_allowlist_audit` is the **append-only** audit log. Every
  addition and revocation is recorded with source and timestamp. Rows are
  never deleted or modified. This preserves the full authorization
  history for audit purposes independent of the current active allowlist
  state.
- `scope_verified` is set to 1 only after a live API call positively proves
  the project's scope membership; operations are denied while this is 0.
- Security boundary (`team_id`, `folder_id`) is never stored in either
  table — it lives in the workspace configuration only.

## 7. Runtime authorization checks (future, not implemented)

Before any Figma operation, the runtime MUST execute these checks in order:

```
1. Is there an active workspace for "figma"?        → no → reject
2. Does this project have a binding?                → no → reject
3. Is scope_verified = 1?                           → no → run scope verification
4. Is the target fileKey in approvedFileKeys?
   (skip for creation operations verified in-scope)  → no → run fileKey verification
5. Is the target file/creation in the workspace
   security boundary? (positive proof required)      → no → reject (scope escape)
6. Is the operation on autoAllow?                   → no → check alwaysBlock
7. Is the operation on alwaysBlock?                 → yes → reject (explain why)
8. Operation is unknown → require explicit user approval
9. Does usage policy permit this task type?          → no → reject
10. Execute operation
```

Each check that fails produces a user-visible explanation. No check may be
skipped or cached beyond the current compilation. Scope verification (step
3) must issue a live API call — cached verification state is not sufficient.

## 8. Relationship to existing contracts

- **ExecutionProfile** (`docs/ARCHITECTURE.md` §5): controls HOW a coding
  agent works. `DesignToolWorkspace` + `DesignToolProjectBinding` are
  separate — they control WHAT design operations are permitted and where.
- **TaskSpec**: unchanged. The task meaning, scope, and acceptance criteria
  are the same regardless of whether a design tool is involved.
- **AGENTS.md / QWEN.md / CLAUDE.md**: unchanged. Design tool instructions
  are rendered into the prompt by the compiler when the task type and usage
  policy permit it.
- **Provider profiles** (`docs/ARCHITECTURE.md` §4): the Figma access token
  uses the same keychain pattern. No new secret storage mechanism.
- **App settings** (`docs/DATA_MODEL.md` §1.5): workspace configurations
  follow the same `settings` table key/value JSON pattern as provider
  profiles.
