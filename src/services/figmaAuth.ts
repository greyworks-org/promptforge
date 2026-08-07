/**
 * Figma safety and authorization (Phase: Design Tool integration).
 *
 * Implements the DESIGN_TOOL.md action policy, scope verification
 * logic, and runtime authorization chain. All functions are pure —
 * the actual Figma API transport is deferred until a PAT is
 * configured.
 *
 * Configured workspace (hardcoded per contract):
 *   team_id:  1156142985904303378
 *   folder_id: 636134446
 */

// ---------------------------------------------------------------------------
// Workspace configuration
// ---------------------------------------------------------------------------

export const FIGMA_WORKSPACE = {
  workspaceId: 'figma-wask-default',
  provider: 'figma' as const,
  version: '1.0.0',
  security: {
    teamId: '1156142985904303378',
    folderId: '636134446',
  },
  tokenKeychainAccount: 'promptforge/figma-wask-default',
} as const;

// ---------------------------------------------------------------------------
// Action policy (DESIGN_TOOL.md §3)
// ---------------------------------------------------------------------------

export type FigmaAction =
  // Auto-run (known non-chargeable reads)
  | 'read-file-metadata' | 'read-file-content' | 'read-file-nodes'
  | 'read-file-components' | 'read-file-styles' | 'read-comments'
  | 'read-team-projects' | 'read-project-files'
  // Approval-gated (known non-chargeable sensitive mutations)
  | 'create-file' | 'update-file-content' | 'update-file-nodes'
  | 'update-file-components' | 'update-file-styles'
  | 'add-comment' | 'resolve-comment'
  // Always blocked (AI/credit/destructive)
  | 'figma-make' | 'ai-generation' | 'ai-image-generation'
  | 'purchase-credits' | 'change-billing' | 'change-seat-settings'
  | 'share-file' | 'publish-file' | 'invite-collaborator'
  | 'change-permissions' | 'change-visibility'
  | 'delete-file' | 'delete-folder' | 'move-file' | 'copy-file-outside-folder';

const AUTO_RUN: Set<string> = new Set([
  'read-file-metadata', 'read-file-content', 'read-file-nodes',
  'read-file-components', 'read-file-styles', 'read-comments',
  'read-team-projects', 'read-project-files',
]);

const APPROVAL_GATED: Set<string> = new Set([
  'create-file', 'update-file-content', 'update-file-nodes',
  'update-file-components', 'update-file-styles',
  'add-comment', 'resolve-comment',
]);

const ALWAYS_BLOCKED: Set<string> = new Set([
  'figma-make', 'ai-generation', 'ai-image-generation',
  'purchase-credits', 'change-billing', 'change-seat-settings',
  'share-file', 'publish-file', 'invite-collaborator',
  'change-permissions', 'change-visibility',
  'delete-file', 'delete-folder', 'move-file', 'copy-file-outside-folder',
]);

export type ActionDecision =
  | { allowed: true; requiresApproval: false }
  | { allowed: true; requiresApproval: true }
  | { allowed: false; reason: string };

/**
 * Classify a Figma action against the action policy.
 * Returns whether the action is allowed and whether user approval is required.
 */
export function classifyAction(action: string): ActionDecision {
  if (AUTO_RUN.has(action)) {
    return { allowed: true, requiresApproval: false };
  }
  if (APPROVAL_GATED.has(action)) {
    return { allowed: true, requiresApproval: true };
  }
  if (ALWAYS_BLOCKED.has(action)) {
    return { allowed: false, reason: `Action '${action}' is blocked by policy (AI/credit/destructive).` };
  }
  // Unclassified — fail closed.
  return { allowed: false, reason: `Action '${action}' is unclassified. Its billing/credit impact is unknown — blocked by policy.` };
}

// ---------------------------------------------------------------------------
// Scope verification (DESIGN_TOOL.md §4)
// ---------------------------------------------------------------------------

export interface ScopeCheck {
  /** Whether the file/creation target is positively in scope. */
  inScope: boolean;
  /** Human-readable reason. */
  reason: string;
}

/**
 * Verify that a file belongs to the configured Figma workspace scope.
 *
 * This is the logic check — the actual Figma API call to confirm
 * membership is deferred until a PAT is configured.  The contract
 * requires positive proof; unknowns are treated as out-of-scope.
 */
export function verifyScope(
  fileTeamId: string | null,
  fileFolderId: string | null,
): ScopeCheck {
  if (fileTeamId === null || fileFolderId === null) {
    return {
      inScope: false,
      reason: 'Cannot verify scope: file metadata missing teamId or folderId.',
    };
  }
  if (fileTeamId !== FIGMA_WORKSPACE.security.teamId) {
    return {
      inScope: false,
      reason: `File belongs to team '${fileTeamId}', not the configured team '${FIGMA_WORKSPACE.security.teamId}'.`,
    };
  }
  if (fileFolderId !== FIGMA_WORKSPACE.security.folderId) {
    return {
      inScope: false,
      reason: `File is in folder '${fileFolderId}', not the configured folder '${FIGMA_WORKSPACE.security.folderId}'.`,
    };
  }
  return { inScope: true, reason: 'File is within the configured scope.' };
}

// ---------------------------------------------------------------------------
// Runtime authorization chain (DESIGN_TOOL.md §7)
// ---------------------------------------------------------------------------

export interface AuthCheckResult {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
}

/**
 * Execute the full runtime authorization chain before any Figma operation.
 *
 * 1. Action classified by policy?
 * 2. File/creation target in configured scope?
 * 3. User approval required?
 */
export function authorizeOperation(
  action: string,
  fileTeamId: string | null,
  fileFolderId: string | null,
  userApproved: boolean,
): AuthCheckResult {
  const actionResult = classifyAction(action);
  if (!actionResult.allowed) {
    return { allowed: false, reason: actionResult.reason, requiresApproval: false };
  }

  const scope = verifyScope(fileTeamId, fileFolderId);
  if (!scope.inScope) {
    return { allowed: false, reason: scope.reason, requiresApproval: false };
  }

  if (actionResult.requiresApproval && !userApproved) {
    return {
      allowed: false,
      reason: `Action '${action}' requires explicit user approval.`,
      requiresApproval: true,
    };
  }

  return { allowed: true, reason: 'Operation authorized.', requiresApproval: false };
}
