import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    context.subscriptions.push(statusBarItem);

    const treeDataProvider = new AiDiffTreeDataProvider();
    vscode.window.createTreeView('aiDiffView', { treeDataProvider });

    let sessions: vscode.chat.ChatEditingSession[] = [];
    let currentSession: vscode.chat.ChatEditingSession | undefined;

    const updateUI = () => {
        const sessionToDisplay = currentSession || sessions[sessions.length - 1];
        let displayFiles: vscode.chat.ChatEditingFile[] = [];
        if (sessionToDisplay) {
            displayFiles = [...sessionToDisplay.files];
        }
        
        if (displayFiles.length === 0) {
            statusBarItem.hide();
            treeDataProvider.update([]);
            return;
        }

        let added = 0;
        let removed = 0;
        displayFiles.forEach(f => {
            added += f.added;
            removed += f.removed;
        });
        
        statusBarItem.text = `$(diff-modified) AI Diff: ${sessions.length} Sessions | Current: ${sessionToDisplay?.id.substring(0, 8)} | +${added} -${removed}`;
        statusBarItem.show();
        treeDataProvider.update(displayFiles);
    };

    const attachSession = (session: vscode.chat.ChatEditingSession) => {
        sessions.push(session);
        currentSession = session;
        
        // Update persistence
        let ids = context.globalState.get<string[]>('chatEditingSessionIds') || [];
        if (!ids.includes(session.id)) {
            ids.push(session.id);
            context.globalState.update('chatEditingSessionIds', ids);
        }
        context.globalState.update('lastActiveChatEditingSessionId', session.id);

        context.subscriptions.push(session.onDidChange(updateUI));
        context.subscriptions.push(session.onDidDispose(() => {
            sessions = sessions.filter(s => s !== session);
            
            // Remove from persistence
            let ids = context.globalState.get<string[]>('chatEditingSessionIds') || [];
            ids = ids.filter(id => id !== session.id);
            context.globalState.update('chatEditingSessionIds', ids);

            if (currentSession === session) {
                currentSession = sessions[sessions.length - 1];
            }
            
            if (sessions.length === 0) {
                context.globalState.update('lastActiveChatEditingSessionId', undefined);
            } else if (currentSession) {
                context.globalState.update('lastActiveChatEditingSessionId', currentSession.id);
            }
            updateUI();
        }));
        updateUI();
        vscode.window.showInformationMessage('AI Diff Session Created/Restored');
    };

    // Try to restore previous sessions
    const restoreSessions = async () => {
        let lastSessionIds = context.globalState.get<string[]>('chatEditingSessionIds') || [];
        const legacyId = context.globalState.get<string>('lastChatEditingSessionId');
        if (legacyId && !lastSessionIds.includes(legacyId)) {
            lastSessionIds.push(legacyId);
            context.globalState.update('lastChatEditingSessionId', undefined); // Migrate
        }
        
        const lastActiveId = context.globalState.get<string>('lastActiveChatEditingSessionId');

        for (const id of lastSessionIds) {
            try {
                // @ts-ignore - using proposed API
                const session = await vscode.chat.startEditingSession({ chatSessionId: id });
                attachSession(session);
            } catch (e) {
                // Failed to restore, remove from list
                let ids = context.globalState.get<string[]>('chatEditingSessionIds') || [];
                ids = ids.filter(savedId => savedId !== id);
                context.globalState.update('chatEditingSessionIds', ids);
            }
        }
        
        // Restore active session selection
        if (lastActiveId) {
            const active = sessions.find(s => s.id === lastActiveId);
            if (active) {
                currentSession = active;
                updateUI();
            }
        }
    };
    restoreSessions();

    // --- Commands ---

    // 1. Start Session
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.start', async () => {
        try {
            // @ts-ignore - using proposed API
            const session = await vscode.chat.startEditingSession();
            attachSession(session);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to start session: ${e}`);
        }
    }));

    // 2. Create Independent Session (Multiple Sessions)
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.createMultiSession', async () => {
        await vscode.commands.executeCommand('aiDiffSample.start');
    }));

    // 2.1 Switch Session
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.switchSession', async () => {
        if (sessions.length === 0) {
            vscode.window.showInformationMessage('No active sessions');
            return;
        }

        const items = sessions.map((s, i) => ({
            label: `Session ${i + 1} (${s.id.substring(0, 8)})`,
            description: s === currentSession ? '(Current)' : '',
            session: s
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a session to switch to'
        });

        if (selected) {
            currentSession = selected.session;
            context.globalState.update('lastActiveChatEditingSessionId', currentSession.id);
            updateUI();
        }
    }));

    // 2.2 Delete Session
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.deleteSession', async () => {
        if (sessions.length === 0) {
            vscode.window.showInformationMessage('No active sessions');
            return;
        }

        const items = sessions.map((s, i) => ({
            label: `Session ${i + 1} (${s.id.substring(0, 8)})`,
            description: s === currentSession ? '(Current)' : '',
            session: s
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a session to delete'
        });

        if (selected) {
            const session = selected.session;
            session.dispose(); // This will trigger onDidDispose which handles cleanup
            vscode.window.showInformationMessage('Session Deleted');
        }
    }));

    // 3. Simulate Simple Edit
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.simulateEdit', async () => {
        const session = currentSession;
        const editor = vscode.window.activeTextEditor;
        if (editor && session) {
            const edit = new vscode.WorkspaceEdit();
            const doc = editor.document;
            edit.insert(doc.uri, new vscode.Position(0, 0), '// AI Generated Header ' + Date.now() + '\n');
            await session.applyEdits(edit, "AI Edit");
        } else {
            vscode.window.showWarningMessage('No active session or editor');
        }
    }));

    // 4. Accept All
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.accept', async () => {
        const session = currentSession;
        if (session) {
            await session.accept();
            vscode.window.showInformationMessage('Session Accepted');
        }
    }));

    // 5. Reject All
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.reject', async () => {
        const session = currentSession;
        if (session) {
            await session.reject();
            vscode.window.showInformationMessage('Session Rejected');
        }
    }));

    // --- New Features ---

    // 6. Accept Specific File
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.acceptFile', async (arg?: vscode.TreeItem | vscode.Uri) => {
        let uri: vscode.Uri | undefined;
        if (arg instanceof vscode.TreeItem) {
            uri = arg.resourceUri;
        } else if (arg instanceof vscode.Uri) {
            uri = arg;
        } else {
            uri = vscode.window.activeTextEditor?.document.uri;
        }

        if (!uri || sessions.length === 0) return;
        
        for (const session of sessions) {
            // Check if file is in session
            if (session.files.some(f => f.uri.toString() === uri!.toString())) {
                 // @ts-ignore - using proposed API
                await session.accept([uri]);
                vscode.window.showInformationMessage(`Accepted changes for ${uri.fsPath}`);
                return;
            }
        }
        vscode.window.showWarningMessage('Current file is not in any active chat session');
    }));

    // 7. Reject Specific File
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.rejectFile', async (arg?: vscode.TreeItem | vscode.Uri) => {
        let uri: vscode.Uri | undefined;
        if (arg instanceof vscode.TreeItem) {
            uri = arg.resourceUri;
        } else if (arg instanceof vscode.Uri) {
            uri = arg;
        } else {
            uri = vscode.window.activeTextEditor?.document.uri;
        }

        if (!uri || sessions.length === 0) return;
        
        for (const session of sessions) {
            if (session.files.some(f => f.uri.toString() === uri!.toString())) {
                // @ts-ignore - using proposed API
                await session.reject([uri]);
                vscode.window.showInformationMessage(`Rejected changes for ${uri.fsPath}`);
                return;
            }
        }
        vscode.window.showWarningMessage('Current file is not in any active chat session');
    }));

    // 8. Toggle Diff View
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.toggleDiff', async () => {
        await vscode.commands.executeCommand('chatEditor.action.toggleDiff');
    }));

    // 9. Navigation (Cross File)
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.nextFile', async () => {
        await vscode.commands.executeCommand('chatEditor.action.navigateNextFile');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.prevFile', async () => {
        await vscode.commands.executeCommand('chatEditor.action.navigatePreviousFile');
    }));

    // 10. Simulate Complex Edits
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.simulateComplexEdits', async () => {
        const session = currentSession;
        if (!session) {
             vscode.window.showErrorMessage('No active session');
             return;
        }

        const edit = new vscode.WorkspaceEdit();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const root = workspaceFolders[0].uri;

        // 10.1 Create File
        const newFile = vscode.Uri.joinPath(root, 'ai-generated-module.ts');
        edit.createFile(newFile, { ignoreIfExists: true });
        edit.insert(newFile, new vscode.Position(0, 0), 'export const generated = true;\nconsole.log("Hello AI");');

        // 10.2 Modify Current File (if active)
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const doc = editor.document;
            const text = doc.getText();
            // Insert at top
            edit.insert(doc.uri, new vscode.Position(0, 0), '// Complex Edit Start\n');
            // Delete last line
            if (doc.lineCount > 1) {
                edit.delete(doc.uri, new vscode.Range(doc.lineCount - 2, 0, doc.lineCount - 1, 0));
            }
        }

        await session.applyEdits(edit, "Complex AI Edits");
    }));

    // 11. Delete File (Context Menu)
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.deleteFile', async (uri?: vscode.Uri) => {
        if (!uri) {
            uri = vscode.window.activeTextEditor?.document.uri;
        }
        if (!uri) {
            vscode.window.showErrorMessage('No file selected to delete');
            return;
        }

        // Ensure session exists
        let session = currentSession;
        if (!session) {
            try {
                // @ts-ignore - using proposed API
                session = await vscode.chat.startEditingSession();
                attachSession(session);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to start session: ${e}`);
                return;
            }
        }

        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(uri, { ignoreIfNotExists: true });
        await session.applyEdits(edit, `Delete ${vscode.workspace.asRelativePath(uri)}`);
    }));

    // 12. Rename File (Context Menu)
    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.renameFile', async (uri?: vscode.Uri) => {
        if (!uri) {
            uri = vscode.window.activeTextEditor?.document.uri;
        }
        if (!uri) {
            vscode.window.showErrorMessage('No file selected to rename');
            return;
        }

        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new file name',
            value: uri.fsPath
        });

        if (!newName) {
            return;
        }

        const newUri = vscode.Uri.file(newName);

        // Ensure session exists
        let session = currentSession;
        if (!session) {
            try {
                // @ts-ignore - using proposed API
                session = await vscode.chat.startEditingSession();
                attachSession(session);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to start session: ${e}`);
                return;
            }
        }

        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(uri, newUri, { ignoreIfExists: true });
        await session.applyEdits(edit, `Rename ${vscode.workspace.asRelativePath(uri)} to ${vscode.workspace.asRelativePath(newUri)}`);
    }));

    // --- Interactive Diff Simulation ---

    let simulationState: { originalUri: vscode.Uri, originalContent: string, tempUri?: vscode.Uri } | undefined;

    const closeSimulation = async () => {
        if (simulationState?.tempUri) {
            // Find and close the editor for the temp file
             const tabGroup = vscode.window.tabGroups.all;
             for (const group of tabGroup) {
                 for (const tab of group.tabs) {
                     if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === simulationState.tempUri.toString()) {
                         await vscode.window.tabGroups.close(tab);
                         break;
                     }
                 }
             }
        }
        simulationState = undefined;
    };

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.startSimulation', async (uri?: vscode.Uri) => {
        let targetUri = uri;
        if (!targetUri) {
             const editor = vscode.window.activeTextEditor;
             if (editor) {
                 targetUri = editor.document.uri;
             }
        }

        if (!targetUri) {
             // Handle "New File" simulation
             // We can simulate creating a new file by picking a workspace root
             const workspaceFolders = vscode.workspace.workspaceFolders;
             if (workspaceFolders) {
                 targetUri = vscode.Uri.joinPath(workspaceFolders[0].uri, `new-file-${Date.now()}.txt`);
                 // It doesn't exist yet
             } else {
                 vscode.window.showErrorMessage('Open a file or workspace to start simulation');
                 return;
             }
        }

        // Check if file exists to read content
        let originalContent = '';
        try {
            const doc = await vscode.workspace.openTextDocument(targetUri);
            originalContent = doc.getText();
        } catch (e) {
            // File doesn't exist (New File Case)
            originalContent = '';
        }

        simulationState = {
            originalUri: targetUri,
            originalContent: originalContent
        };

        const tempDoc = await vscode.workspace.openTextDocument({ content: simulationState.originalContent, language: 'plaintext' }); // Default to plaintext or try to infer
        simulationState.tempUri = tempDoc.uri;
        await vscode.window.showTextDocument(tempDoc);
        vscode.window.showInformationMessage('Interactive Simulation Started. Edit this file. Saving (Ctrl+S) will apply changes.');
    }));

    const applySimulationHandler = async () => {
        if (!simulationState || !simulationState.tempUri) {
            vscode.window.showErrorMessage('No active simulation');
            return;
        }

        // Find the document for tempUri
        const tempDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === simulationState!.tempUri!.toString());
        if (!tempDoc) {
             vscode.window.showErrorMessage('Simulation file closed');
             return;
        }

        const modifiedContent = tempDoc.getText();
        const edits = computeMinimalEdits(simulationState.originalContent, modifiedContent);

        // Ensure session exists
        let session = currentSession;
        if (!session) {
            // @ts-ignore - using proposed API
            session = await vscode.chat.startEditingSession();
            attachSession(session);
        }

        const workspaceEdit = new vscode.WorkspaceEdit();
        
        // Handle File Operations
        if (simulationState.originalContent === '' && modifiedContent !== '') {
             // Creation
             workspaceEdit.createFile(simulationState.originalUri, { ignoreIfExists: true });
             workspaceEdit.set(simulationState.originalUri, edits);
        } else if (simulationState.originalContent !== '' && modifiedContent === '') {
             // Deletion
             workspaceEdit.deleteFile(simulationState.originalUri, { ignoreIfNotExists: true });
        } else {
             // Modification
             workspaceEdit.set(simulationState.originalUri, edits);
        }
        
        await session.applyEdits(workspaceEdit, "Interactive Simulation");
        
        await closeSimulation();
        vscode.window.showInformationMessage('Simulation Applied');
    };

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.applySimulation', applySimulationHandler));

    // Listen for Save
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (simulationState && simulationState.tempUri && doc.uri.toString() === simulationState.tempUri.toString()) {
            await applySimulationHandler();
        }
    }));
}

export function deactivate() {}

// Helper for Diff
function computeMinimalEdits(original: string, modified: string): vscode.TextEdit[] {
    const originalLines = original.split(/\r?\n/);
    const modifiedLines = modified.split(/\r?\n/);

    let start = 0;
    while (start < originalLines.length && start < modifiedLines.length && originalLines[start] === modifiedLines[start]) {
        start++;
    }

    let endOriginal = originalLines.length - 1;
    let endModified = modifiedLines.length - 1;

    while (endOriginal >= start && endModified >= start && originalLines[endOriginal] === modifiedLines[endModified]) {
        endOriginal--;
        endModified--;
    }

    if (start > endOriginal && start > endModified) {
        return [];
    }

    if (originalLines.length === 1 && originalLines[0] === '') {
        // Special case: Original file was empty (or didn't exist).
        // This is a pure insertion.
        // If modified is also empty, it's a no-op (handled above).
        // Return an insert at 0,0 for the entire new content.
        const newText = modifiedLines.join('\n'); // No trailing newline handling needed if we replace exact match, but here we just insert
        return [new vscode.TextEdit(new vscode.Range(0, 0, 0, 0), newText)];
    }

    const range = new vscode.Range(new vscode.Position(start, 0), new vscode.Position(endOriginal + 1, 0)); // +1 to include newline of last line
    // Reconstruct the new text
    const newTextLines = modifiedLines.slice(start, endModified + 1);
    const newText = newTextLines.join('\n') + (endModified < modifiedLines.length - 1 ? '\n' : '');

    // Edge case handling for EOF newlines could be improved, but this suffices for sample
    return [new vscode.TextEdit(range, newText)];
}

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
            item.contextValue = 'aiDiffFile';
            item.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [f.uri]
            };

            // Enhanced File Decoration

            if (f.state === 1) { // Accepted
                 item.description = 'Accepted';
                 item.iconPath = new vscode.ThemeIcon('check');
            } else if (f.state === 2) { // Rejected
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
                }else if (f.added === -1) {
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
