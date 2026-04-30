import * as vscode from 'vscode';
import { ChatEditingFileState } from './types';

export class AiDiffTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private files: readonly vscode.chat.ChatEditingFile[] = [];

    update(files: readonly vscode.chat.ChatEditingFile[]) {
        this.files = files;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (this.files.length === 0) {
            return Promise.resolve([new vscode.TreeItem("No Active Files")]);
        }
        
        return Promise.resolve(this.files.map(f => {
            const item = new vscode.TreeItem(f.uri);
            item.contextValue = 'aiDiffFile';
            item.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [f.uri]
            };

            // Enhanced File Decoration using Enum
            if (f.state === ChatEditingFileState.Accepted) {
                 item.description = 'Accepted';
                 item.iconPath = new vscode.ThemeIcon('check');
            } else if (f.state === ChatEditingFileState.Rejected) {
                 item.description = 'Rejected';
                 item.iconPath = new vscode.ThemeIcon('x');
            } else {
                // Modified
                if (f.isNew) {
                    item.description = `(New) +${f.added}`;
                    item.iconPath = new vscode.ThemeIcon('diff-added');
                } else if (f.removed > 0 && f.added === 0) { 
                     item.description = `(Deleted) -${f.removed}`;
                     item.iconPath = new vscode.ThemeIcon('diff-removed');
                } else if (f.added === -1) {
                     // Deleted file - legacy/fallback check
                    item.description = `(Deleted) -${f.removed}`;
                    item.iconPath = new vscode.ThemeIcon('diff-removed');
                } else {
                     item.description = `(Modified) +${f.added} -${f.removed}`;
                     item.iconPath = new vscode.ThemeIcon('diff-modified');
                }
            }

            return item;
        }));
    }
}