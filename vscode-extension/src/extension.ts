import * as vscode from 'vscode';
import {
  fetchSessionView,
  parseConnection,
  requestSessionAction,
  waitForSessionAction,
  type SessionAction,
  type SessionView,
  type VscodeConnection,
} from './readModelClient';

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
    } else {
      const label = action === 'start' ? 'Start Session' : 'Resume Session';
      const confirmed = await vscode.window.showWarningMessage(
        `${label} through PromptForge and OpenCode?`,
        { modal: true },
        label,
      );
      if (confirmed !== label) return;
    }
    try {
      const actionId = await requestSessionAction(this.connection, action, note);
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
    return [
      ...(this.feedback ? [new PanelItem('Action feedback', this.feedback)] : []),
      ...actions,
      new PanelItem('Status', `${view.session.status} · ${view.completion}`),
      new PanelItem('Runtime', `${view.session.runtime}${view.session.binding.detectedVersion ? ` · ${view.session.binding.detectedVersion}` : ''}`),
      new PanelItem('Model', model),
      new PanelItem('Task', view.task.objective || 'No objective recorded'),
      new PanelItem('Progress', progress),
      new PanelItem('Changed files', files, view.changedFiles.map((file) => new PanelItem(file))),
      new PanelItem('Recent events', `${view.events.length} recorded`, view.events.slice(-8).reverse().map((event) => new PanelItem(event.kind, event.content))),
    ];
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
