import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    context.subscriptions.push(statusBarItem);

    // Tree View Provider
    const treeDataProvider = new AiDiffTreeDataProvider();
    vscode.window.createTreeView('aiDiffView', { treeDataProvider });

    let currentSession: vscode.chat.ChatEditingSession | undefined;

    const updateUI = () => {
        if (!currentSession) {
            statusBarItem.hide();
            treeDataProvider.update([]);
            return;
        }
        const files = currentSession.files || [];
        let added = 0;
        let removed = 0;
        files.forEach(f => {
            added += f.added;
            removed += f.removed;
        });
        
        statusBarItem.text = `$(diff-modified) AI Diff: +${added} -${removed}`;
        statusBarItem.show();
        treeDataProvider.update(files);
    };

    const attachSession = (session: vscode.chat.ChatEditingSession) => {
        currentSession = session;
        context.subscriptions.push(session.onDidChange(updateUI));
        updateUI();
        vscode.window.showInformationMessage('AI Diff Session Attached/Resumed');
    };

    // Start Session
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.start', async () => {
        try {
            // Create session via API
            if (!currentSession) {
                const session = await vscode.chat.createEditingSession();
                attachSession(session);
            } else {
                vscode.window.showInformationMessage('Session already active');
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to start session: ${e}`);
        }
    }));

    // Simulate Edit
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.simulateEdit', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && currentSession) {
            const edit = new vscode.WorkspaceEdit();
            const doc = editor.document;
            edit.insert(doc.uri, new vscode.Position(0, 0), '// AI Generated Header\n');
            
            await currentSession.applyEdits(edit, "AI Edit");
        } else {
            vscode.window.showWarningMessage('No active session or editor');
        }
    }));

    // Accept
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.accept', async () => {
        if (currentSession) {
            await currentSession.accept();
            vscode.window.showInformationMessage('AI Diff Accepted');
            currentSession = undefined;
            updateUI();
        }
    }));

    // Reject
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.reject', async () => {
        if (currentSession) {
            await currentSession.reject();
            vscode.window.showInformationMessage('AI Diff Rejected');
            currentSession = undefined;
            updateUI();
        }
    }));
}

export function deactivate() {}

class AiDiffTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
            item.description = `+${f.added} -${f.removed}`;
            return item;
        }));
    }
}
