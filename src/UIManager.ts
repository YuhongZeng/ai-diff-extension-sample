import * as vscode from 'vscode';
import { AiDiffTreeDataProvider } from './TreeDataProvider';
import { SessionManager } from './SessionManager';

declare function setTimeout(callback: (...args: any[]) => void, ms: number, ...args: any[]): any;
declare function clearTimeout(timeoutId: any): void;

export class UIManager {
    private statusBarItem: vscode.StatusBarItem;
    private treeDataProvider: AiDiffTreeDataProvider;
    private updateTimeout: any;

    constructor(context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        context.subscriptions.push(this.statusBarItem);

        this.treeDataProvider = new AiDiffTreeDataProvider();
        vscode.window.createTreeView('aiDiffView', { treeDataProvider: this.treeDataProvider });
    }

    // Debounced UI Update to prevent flickering during rapid edits
    public updateUI(sessionManager: SessionManager) {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }

        this.updateTimeout = setTimeout(() => {
            this.doUpdateUI(sessionManager);
        }, 100); // 100ms debounce
    }

    private doUpdateUI(sessionManager: SessionManager) {
        const sessionToDisplay = sessionManager.currentSession || sessionManager.allSessions[sessionManager.allSessions.length - 1];
        let displayFiles: vscode.chat.ChatEditingFile[] = [];
        if (sessionToDisplay) {
            displayFiles = [...sessionToDisplay.files];
        }
        
        if (displayFiles.length === 0) {
            this.statusBarItem.hide();
            this.treeDataProvider.update([]);
            return;
        }

        let added = 0;
        let removed = 0;
        displayFiles.forEach(f => {
            added += f.added;
            removed += f.removed;
        });
        
        this.statusBarItem.text = `$(diff-modified) AI Diff: ${sessionManager.allSessions.length} Sessions | Current: ${sessionToDisplay?.id.substring(0, 8)} | +${added} -${removed}`;
        this.statusBarItem.show();
        this.treeDataProvider.update(displayFiles);
    }
}