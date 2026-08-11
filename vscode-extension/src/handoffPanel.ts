import * as vscode from 'vscode';
import {
  fetchHandoffView,
  requestSessionAction,
  waitForSessionAction,
  type HandoffView,
  type OpenCodeModel,
  type VscodeConnection,
} from './readModelClient';
import { renderHandoffHtml } from './handoffHtml';

function findModel(view: HandoffView, modelRef: string): OpenCodeModel {
  const model = view.models.find((candidate) => candidate.modelRef === modelRef);
  if (model === undefined || (!model.available && !model.configured)) throw new Error('Choose an available OpenCode model.');
  return model;
}

export class HandoffPanel {
  private static current: HandoffPanel | null = null;
  private readonly panel: vscode.WebviewPanel;
  private view: HandoffView | null = null;
  private busy = false;

  private constructor(private readonly connection: VscodeConnection) {
    this.panel = vscode.window.createWebviewPanel('promptforge.handoff', 'PromptForge Handoff', vscode.ViewColumn.One, { enableScripts: true });
    this.panel.webview.html = renderHandoffHtml(null);
    this.panel.webview.onDidReceiveMessage((message: unknown) => { void this.handleMessage(message); });
    this.panel.onDidDispose(() => { if (HandoffPanel.current?.panel === this.panel) HandoffPanel.current = null; });
    void this.loadContext();
  }

  public static open(connection: VscodeConnection): void {
    if (HandoffPanel.current !== null) {
      HandoffPanel.current.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    HandoffPanel.current = new HandoffPanel(connection);
  }

  private setHtml(state: { busy: boolean; error: string | null; message: string | null } = { busy: false, error: null, message: null }): void {
    this.panel.webview.html = renderHandoffHtml(this.view, state);
  }

  private async action(action: 'handoff-context' | 'handoff-preview' | 'handoff-confirm', payload?: unknown): Promise<void> {
    const actionId = await requestSessionAction(this.connection, action, undefined, payload);
    const result = await waitForSessionAction(this.connection, actionId);
    if (result.status === 'failed') throw new Error(result.message);
  }

  private async loadContext(): Promise<void> {
    try {
      await this.action('handoff-context');
      this.view = await fetchHandoffView(this.connection);
      this.setHtml();
    } catch (error) {
      this.setHtml({ busy: false, error: error instanceof Error ? error.message : 'PromptForge handoff context could not be loaded.', message: null });
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || this.view === null) return;
    const data = message as { type?: unknown; modelRef?: unknown };
    if (data.type === 'cancel') { this.panel.dispose(); return; }
    if (data.type === 'target' && typeof data.modelRef === 'string') {
      if (this.busy) return;
      try {
        const model = findModel(this.view, data.modelRef);
        this.busy = true;
        this.setHtml({ busy: true, error: null, message: 'Loading continuation preview…' });
        await this.action('handoff-preview', model);
        this.view = await fetchHandoffView(this.connection);
        this.busy = false;
        this.setHtml({ busy: false, error: null, message: 'Review the bounded continuation package, then confirm when ready.' });
      } catch (error) {
        this.busy = false;
        this.setHtml({ busy: false, error: error instanceof Error ? error.message : 'The handoff preview could not be prepared.', message: null });
      }
      return;
    }
    if (data.type === 'confirm') {
      if (this.busy || this.view.preview === null) return;
      this.busy = true;
      this.setHtml({ busy: true, error: null, message: 'Creating target session…' });
      try {
        await this.action('handoff-confirm', this.view.preview.previewId);
        this.view = await fetchHandoffView(this.connection);
        this.busy = false;
        this.setHtml({ busy: false, error: null, message: 'Handoff complete. The source session remains unchanged.' });
      } catch (error) {
        this.busy = false;
        this.setHtml({ busy: false, error: error instanceof Error ? error.message : 'The handoff could not be completed.', message: null });
      }
    }
  }
}
