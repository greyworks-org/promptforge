import * as vscode from 'vscode';
import {
  fetchSessionView,
  parseConnection,
  requestProjectResume,
  requestSessionAction,
  waitForProjectResume,
  waitForSessionAction,
  type ProjectResumeOutcome,
  type SessionAction,
  type SessionView,
  type VscodeConnection,
} from './readModelClient';
import { HandoffPanel } from './handoffPanel';
import { findGitRoot } from './workspaceProject';

class PanelItem extends vscode.TreeItem {
  public readonly children: PanelItem[];

  constructor(label: string, description = '', children: PanelItem[] = [], command?: vscode.Command) {
    super(label, children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.children = children;
    this.command = command;
  }
}

class SessionStatusProvider implements vscode.TreeDataProvider<PanelItem> {
  private readonly changed = new vscode.EventEmitter<PanelItem | undefined | null | void>();
  public readonly onDidChangeTreeData = this.changed.event;
  private connection: VscodeConnection | null = null;
  private view: SessionView | null = null;
  private error: string | null = null;
  private feedback: string | null = null;

  public setConnection(connection: VscodeConnection | null): void {
    this.connection = connection;
    this.view = null;
    this.error = null;
    this.feedback = null;
    this.changed.fire();
    if (connection) void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.connection) {
      this.changed.fire();
      return;
    }
    try {
      this.view = await fetchSessionView(this.connection);
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'PromptForge session could not be loaded.';
    }
    this.changed.fire();
  }

  public async runAction(action: SessionAction): Promise<void> {
    if (!this.connection || !this.view) return;
    let note: string | undefined;
    let payload: unknown;
    if (action === 'model') {
      const choice = await vscode.window.showInputBox({
        prompt: 'Model: Luna 5.6 High, Qwen 3.8 Max, or DeepSeek V4 Flash',
        ignoreFocusOut: true,
      });
      if (!choice?.trim()) return;
      const labels: Record<string, { providerId: string; label: string }> = {
        'Luna 5.6 High': { providerId: 'openai', label: 'Luna 5.6 High' },
        'Qwen 3.8 Max': { providerId: 'qwen', label: 'Qwen 3.8 Max' },
        'DeepSeek V4 Flash': { providerId: 'deepseek', label: 'DeepSeek V4 Flash' },
      };
      const model = labels[choice.trim()];
      if (!model) {
        await vscode.window.showErrorMessage('Choose exactly Luna 5.6 High, Qwen 3.8 Max, or DeepSeek V4 Flash.');
        return;
      }
      const ref = await vscode.window.showInputBox({
        prompt: `${model.label} OpenCode model reference (provider/model-id)`,
        ignoreFocusOut: true,
      });
      if (!ref?.trim() || !ref.includes('/')) return;
      payload = { providerId: model.providerId, modelId: ref.slice(ref.indexOf('/') + 1), modelRef: ref.trim() };
      const confirmed = await vscode.window.showWarningMessage(
        `Switch this PromptForge session to ${model.label}?`,
        { modal: true },
        'Switch Model',
      );
      if (confirmed !== 'Switch Model') return;
    }
    if (action === 'checkpoint') {
      const value = await vscode.window.showInputBox({
        prompt: 'Checkpoint note to save in PromptForge',
        ignoreFocusOut: true,
      });
      if (!value?.trim()) return;
      const confirmed = await vscode.window.showWarningMessage(
        'Save this checkpoint note to the canonical PromptForge session?',
        { modal: true },
        'Save Note',
      );
      if (confirmed !== 'Save Note') return;
      note = value.trim();
    } else if (action !== 'model') {
      const label = action === 'start' ? 'Start Session' : 'Resume Session';
      const confirmed = await vscode.window.showWarningMessage(
        `${label} through PromptForge and OpenCode?`,
        { modal: true },
        label,
      );
      if (confirmed !== label) return;
    }
    try {
      const actionId = await requestSessionAction(this.connection, action, note, payload);
      this.feedback = `${action === 'checkpoint' ? 'Checkpoint note' : `OpenCode ${action}`} requested.`;
      this.changed.fire();
      const result = await waitForSessionAction(this.connection, actionId);
      if (result.status === 'failed') {
        this.feedback = `Failed: ${result.message}`;
        await this.refresh();
        this.changed.fire();
        await vscode.window.showErrorMessage(result.message);
        return;
      }
      this.feedback = result.message;
      await this.refresh();
      await vscode.window.showInformationMessage(result.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PromptForge session action failed.';
      this.feedback = `Failed: ${message}`;
      this.changed.fire();
      await vscode.window.showErrorMessage(message);
    }
  }

  public getTreeItem(element: PanelItem): vscode.TreeItem { return element; }

  public getChildren(element?: PanelItem): PanelItem[] {
    if (element) return element.children;
    if (!this.connection) return [new PanelItem('Not connected', 'Run PromptForge: Connect Session')];
    if (this.error) return [new PanelItem('Connection error', this.error)];
    if (!this.view) return [new PanelItem('Loading session…')];
    const view = this.view;
    const model = view.session.binding.modelRef ?? view.session.binding.modelId ?? 'runtime default';
    const progress = `${view.progress.completed.length} done · ${view.progress.pending.length} pending`;
    const files = view.changedFiles.length === 0 ? 'clean' : `${view.changedFiles.length} changed`;
    const actions: PanelItem[] = [];
    if (view.controls.canStart) actions.push(new PanelItem('Start Session', 'Confirm to launch OpenCode', [], { command: 'promptforge.startSession', title: 'Start Session' }));
    if (view.controls.canResume) actions.push(new PanelItem('Resume Session', 'Confirm to resume OpenCode', [], { command: 'promptforge.resumeSession', title: 'Resume Session' }));
    if (view.controls.canCheckpoint) actions.push(new PanelItem('Add Checkpoint Note', 'Save to PromptForge', [], { command: 'promptforge.addCheckpointNote', title: 'Add Checkpoint Note' }));
    actions.push(new PanelItem('Switch Model', 'Update the same PromptForge session', [], { command: 'promptforge.switchModel', title: 'Switch Model' }));
    actions.push(new PanelItem('Handoff', 'Review and continue with another OpenCode model', [], { command: 'promptforge.handoff', title: 'Handoff' }));
    return [
      ...(this.feedback ? [new PanelItem('Action feedback', this.feedback)] : []),
      ...actions,
      new PanelItem('Status', `${view.session.status} · ${view.completion}`),
      new PanelItem('Runtime', `${view.session.runtime}${view.session.binding.detectedVersion ? ` · ${view.session.binding.detectedVersion}` : ''}`),
      new PanelItem('Model', model),
      new PanelItem('Task', view.task.objective || 'No objective recorded'),
      new PanelItem('Progress', progress),
      new PanelItem('Context', `${view.context.status}${view.context.checkpoint ? ` · ${view.context.checkpoint}` : ''}`),
      new PanelItem('Changed files', files, view.changedFiles.map((file) => new PanelItem(file))),
      new PanelItem('Recent events', `${view.events.length} recorded`, view.events.slice(-8).reverse().map((event) => new PanelItem(event.kind, event.content))),
    ];
  }
}

/** PromptForge decides; this only reports the outcome and the allowed follow-up. */
export function describeResumeOutcome(outcome: ProjectResumeOutcome): string {
  const project = outcome.projectName ?? outcome.projectId ?? outcome.repoRoot;
  if (outcome.status === 'executed') {
    return `${project}: resumed in OpenCode with the current continuation${outcome.modelRef ? ` (${outcome.modelRef})` : ''}.`;
  }
  if (outcome.status === 'completed') {
    return outcome.recommendation === null
      ? `${project}: current task complete. Start a new task in PromptForge Compiler.`
      : `${project}: current task complete. Recommended next task: ${outcome.recommendation.intent}`;
  }
  if (outcome.status === 'no-active-task') {
    return outcome.recommendation === null
      ? `${project}: no active task. Start a new task in PromptForge Compiler.`
      : `${project}: no active task. Recommended next task: ${outcome.recommendation.intent}`;
  }
  if (outcome.status === 'blocked') return `${project}: blocked. ${outcome.message}`;
  if (outcome.status === 'needs-human-review') return `${project}: needs human review. ${outcome.message}`;
  return outcome.message;
}

async function resumeCurrentProject(): Promise<void> {
  const connection = parseConnection(vscode.workspace.getConfiguration().get<string>('promptforge.connection', ''));
  if (!connection) {
    await vscode.window.showErrorMessage('Run PromptForge: Connect Session once so this workspace knows the local PromptForge endpoint.');
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    await vscode.window.showErrorMessage('Open a folder before resuming a PromptForge project.');
    return;
  }
  const repoRoot = findGitRoot(folder.uri.fsPath);
  if (!repoRoot) {
    await vscode.window.showErrorMessage('This workspace is not inside a Git repository.');
    return;
  }
  try {
    const actionId = await requestProjectResume(connection, repoRoot);
    const result = await waitForProjectResume(connection, actionId);
    const text = result.outcome ? describeResumeOutcome(result.outcome) : result.message;
    if (result.status === 'failed') {
      await vscode.window.showErrorMessage(text);
      return;
    }
    await vscode.window.showInformationMessage(text);
  } catch (err) {
    await vscode.window.showErrorMessage(err instanceof Error ? err.message : 'PromptForge could not resume this project.');
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SessionStatusProvider();
  const connectionSetting = vscode.workspace.getConfiguration().get<string>('promptforge.connection', '');
  provider.setConnection(parseConnection(connectionSetting));
  context.subscriptions.push(
    vscode.window.createTreeView('promptforge.sessionStatus', { treeDataProvider: provider }),
    vscode.commands.registerCommand('promptforge.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('promptforge.startSession', () => provider.runAction('start')),
    vscode.commands.registerCommand('promptforge.resumeSession', () => provider.runAction('resume')),
    vscode.commands.registerCommand('promptforge.addCheckpointNote', () => provider.runAction('checkpoint')),
    vscode.commands.registerCommand('promptforge.switchModel', () => provider.runAction('model')),
    vscode.commands.registerCommand('promptforge.resumeCurrentProject', () => void resumeCurrentProject()),
    vscode.commands.registerCommand('promptforge.handoff', () => {
      const connection = parseConnection(vscode.workspace.getConfiguration().get<string>('promptforge.connection', ''));
      if (connection) HandoffPanel.open(connection);
    }),
    vscode.commands.registerCommand('promptforge.connect', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Paste the connection copied from PromptForge Local',
        password: true,
        ignoreFocusOut: true,
      });
      if (!value) return;
      const connection = parseConnection(value.trim());
      if (!connection) {
        await vscode.window.showErrorMessage('That is not a valid local PromptForge connection.');
        return;
      }
      await vscode.workspace.getConfiguration().update('promptforge.connection', value.trim(), vscode.ConfigurationTarget.Global);
      provider.setConnection(connection);
      await vscode.window.showInformationMessage('PromptForge session connected.');
    }),
  );
  const timer = setInterval(() => { void provider.refresh(); }, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate(): void {}
