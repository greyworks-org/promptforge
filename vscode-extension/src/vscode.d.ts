declare module 'vscode' {
  export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
  export interface Disposable { dispose(): void }
  export type Event<T> = (listener: (event: T) => unknown) => Disposable;
  export class EventEmitter<T> implements Disposable {
    readonly event: Event<T>;
    fire(event: T): void;
    dispose(): void;
  }
  export class TreeItem {
    constructor(label: string, collapsibleState?: TreeItemCollapsibleState);
    label: string;
    description?: string;
    tooltip?: string;
    command?: Command;
  }
  export interface Command { command: string; title: string; arguments?: unknown[] }
  export interface TreeDataProvider<T> {
    readonly onDidChangeTreeData?: Event<T | undefined | null | void>;
    getTreeItem(element: T): TreeItem;
    getChildren(element?: T): T[] | Promise<T[]>;
  }
  export interface ExtensionContext { subscriptions: { push(...items: Disposable[]): void } }
  export interface TreeViewOptions<T> { treeDataProvider: TreeDataProvider<T> }
  export namespace window {
    function createTreeView<T>(id: string, options: TreeViewOptions<T>): Disposable;
    function showInputBox(options: { prompt: string; password?: boolean; ignoreFocusOut?: boolean }): PromiseLike<string | undefined>;
    function showErrorMessage(message: string): PromiseLike<string | undefined>;
    function showInformationMessage(message: string): PromiseLike<string | undefined>;
    function showWarningMessage(message: string, options: { modal?: boolean }, ...items: string[]): PromiseLike<string | undefined>;
  }
  export namespace commands {
    function registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable;
  }
  export enum ConfigurationTarget { Global = 1 }
  export interface WorkspaceConfiguration {
    get<T>(section: string, defaultValue: T): T;
    update(section: string, value: unknown, configurationTarget: ConfigurationTarget): Promise<void>;
  }
  export namespace workspace { function getConfiguration(section?: string): WorkspaceConfiguration; }
}
