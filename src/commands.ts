import * as vscode from 'vscode';
import { SessionManager } from './SessionManager';
import { UIManager } from './UIManager';

let simulationState: { originalUri: vscode.Uri, originalContent: string, tempUri?: vscode.Uri } | undefined;

export function registerCommands(context: vscode.ExtensionContext, sessionManager: SessionManager, uiManager: UIManager) {
    
    // --- Session Management ---

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.start', async () => {
        try {
            const session = await vscode.chat.startEditingSession();
            sessionManager.attachSession(session);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to start session: ${e}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.createMultiSession', async () => {
        await vscode.commands.executeCommand('aiDiffSample.start');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.switchSession', async () => {
        if (sessionManager.allSessions.length === 0) {
            vscode.window.showInformationMessage('No active sessions');
            return;
        }

        const items = sessionManager.allSessions.map((s, i) => ({
            label: `Session ${i + 1} (${s.id.substring(0, 8)})`,
            description: s === sessionManager.currentSession ? '(Current)' : '',
            session: s
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a session to switch to'
        });

        if (selected) {
            sessionManager.currentSession = selected.session;
            context.globalState.update('lastActiveChatEditingSessionId', sessionManager.currentSession.id);
            uiManager.updateUI(sessionManager);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.deleteSession', async () => {
        if (sessionManager.allSessions.length === 0) {
            vscode.window.showInformationMessage('No active sessions');
            return;
        }

        const items = sessionManager.allSessions.map((s, i) => ({
            label: `Session ${i + 1} (${s.id.substring(0, 8)})`,
            description: s === sessionManager.currentSession ? '(Current)' : '',
            session: s
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a session to delete'
        });

        if (selected) {
            const session = selected.session;
            session.dispose(); // Triggers onDidDispose in SessionManager
            vscode.window.showInformationMessage('Session Deleted');
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.show', async () => {
        const session = sessionManager.currentSession;
        if (session) {
            await session.show('Session show');
            vscode.window.showInformationMessage('Session show');
        }
    }));

    // --- Simple Edit Operations ---

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.simulateEdit', async () => {
        const session = sessionManager.currentSession;
        const editor = vscode.window.activeTextEditor;
        if (editor && session) {
            const edit = new vscode.WorkspaceEdit();
            const doc = editor.document;
            edit.insert(doc.uri, new vscode.Position(0, 0), '// AI Generated Header ' + Date.now() + '\n');
            const result = await session.applyEdits(edit, "AI Edit");
            if (!result.success) {
                vscode.window.showErrorMessage(result.errorMessage || 'Failed to apply edits');
            }
        } else {
            vscode.window.showWarningMessage('No active session or editor');
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.accept', async () => {
        const session = sessionManager.currentSession;
        if (session) {
            await session.accept();
            vscode.window.showInformationMessage('Session Accepted');
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.reject', async () => {
        const session = sessionManager.currentSession;
        if (session) {
            await session.reject();
            vscode.window.showInformationMessage('Session Rejected');
        }
    }));

    // --- File Specific Operations ---

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.acceptFile', async (arg?: vscode.TreeItem | vscode.Uri) => {
        let uri: vscode.Uri | undefined;
        if (arg instanceof vscode.TreeItem) {
            uri = arg.resourceUri;
        } else if (arg instanceof vscode.Uri) {
            uri = arg;
        } else {
            uri = vscode.window.activeTextEditor?.document.uri;
        }

        if (!uri || sessionManager.allSessions.length === 0) return;
        
        for (const session of sessionManager.allSessions) {
            if (session.files.some(f => f.uri.toString() === uri!.toString())) {
                await session.accept([uri]);
                vscode.window.showInformationMessage(`Accepted changes for ${uri.fsPath}`);
                return;
            }
        }
        vscode.window.showWarningMessage('Current file is not in any active chat session');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.rejectFile', async (arg?: vscode.TreeItem | vscode.Uri) => {
        let uri: vscode.Uri | undefined;
        if (arg instanceof vscode.TreeItem) {
            uri = arg.resourceUri;
        } else if (arg instanceof vscode.Uri) {
            uri = arg;
        } else {
            uri = vscode.window.activeTextEditor?.document.uri;
        }

        if (!uri || sessionManager.allSessions.length === 0) return;
        
        for (const session of sessionManager.allSessions) {
            if (session.files.some(f => f.uri.toString() === uri!.toString())) {
                await session.reject([uri]);
                vscode.window.showInformationMessage(`Rejected changes for ${uri.fsPath}`);
                return;
            }
        }
        vscode.window.showWarningMessage('Current file is not in any active chat session');
    }));

    // --- Navigation & View ---

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.toggleDiff', async () => {
        await vscode.commands.executeCommand('chatEditor.action.toggleDiff');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.nextFile', async () => {
        await vscode.commands.executeCommand('chatEditor.action.navigateNextFile');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.prevFile', async () => {
        await vscode.commands.executeCommand('chatEditor.action.navigatePreviousFile');
    }));

    // --- Complex / Context Edits ---

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.simulateComplexEdits', async () => {
        const session = sessionManager.currentSession;
        if (!session) {
             vscode.window.showErrorMessage('No active session');
             return;
        }

        const edit = new vscode.WorkspaceEdit();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const root = workspaceFolders[0].uri;

        const newFile = vscode.Uri.joinPath(root, 'ai-generated-module.ts');
        edit.createFile(newFile, { ignoreIfExists: true });
        edit.insert(newFile, new vscode.Position(0, 0), 'export const generated = true;\nconsole.log("Hello AI");');

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const doc = editor.document;
            edit.insert(doc.uri, new vscode.Position(0, 0), '// Complex Edit Start\n');
            if (doc.lineCount > 1) {
                edit.delete(doc.uri, new vscode.Range(doc.lineCount - 2, 0, doc.lineCount - 1, 0));
            }
        }

        const result = await session.applyEdits(edit, "Complex AI Edits");
        if (!result.success) {
            vscode.window.showErrorMessage(result.errorMessage || 'Failed to apply complex edits');
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.deleteFile', async (uri?: vscode.Uri) => {
        if (!uri) {
            uri = vscode.window.activeTextEditor?.document.uri;
        }
        if (!uri) {
            vscode.window.showErrorMessage('No file selected to delete');
            return;
        }

        let session = sessionManager.currentSession;
        if (!session) {
            try {
                session = await vscode.chat.startEditingSession();
                sessionManager.attachSession(session);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to start session: ${e}`);
                return;
            }
        }

        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(uri, { ignoreIfNotExists: true });
        const result = await session.applyEdits(edit, `Delete ${vscode.workspace.asRelativePath(uri)}`);
        if (!result.success) {
            vscode.window.showErrorMessage(result.errorMessage || 'Failed to delete file');
        }
    }));

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

        let session = sessionManager.currentSession;
        if (!session) {
            try {
                session = await vscode.chat.startEditingSession();
                sessionManager.attachSession(session);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to start session: ${e}`);
                return;
            }
        }

        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(uri, newUri, { ignoreIfExists: true });
        const result = await session.applyEdits(edit, `Rename ${vscode.workspace.asRelativePath(uri)} to ${vscode.workspace.asRelativePath(newUri)}`);
        if (!result.success) {
            vscode.window.showErrorMessage(result.errorMessage || 'Failed to rename file');
        }
    }));

    // --- Interactive Diff Simulation ---

    const closeSimulation = async () => {
        if (simulationState?.tempUri) {
            // Find and close the editor by Uri specifically
            const editors = vscode.window.visibleTextEditors;
            const editor = editors.find(e => e.document.uri.toString() === simulationState?.tempUri?.toString());
            if (editor) {
                // Workaround to close specific editor
                await vscode.window.showTextDocument(editor.document);
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
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
             const workspaceFolders = vscode.workspace.workspaceFolders;
             if (workspaceFolders) {
                 targetUri = vscode.Uri.joinPath(workspaceFolders[0].uri, `new-file-${Date.now()}.txt`);
             } else {
                 vscode.window.showErrorMessage('Open a file or workspace to start simulation');
                 return;
             }
        }

        let originalContent = '';
        try {
            const doc = await vscode.workspace.openTextDocument(targetUri);
            originalContent = doc.getText();
        } catch (e) {
            originalContent = '';
        }

        simulationState = {
            originalUri: targetUri,
            originalContent: originalContent
        };

        const tempDoc = await vscode.workspace.openTextDocument({ content: simulationState.originalContent, language: 'plaintext' });
        simulationState.tempUri = tempDoc.uri;
        await vscode.window.showTextDocument(tempDoc);
        vscode.window.showInformationMessage('Interactive Simulation Started. Edit this file. Saving (Ctrl+S) will apply changes.');
    }));

    const applySimulationHandler = async () => {
        if (!simulationState || !simulationState.tempUri) {
            vscode.window.showErrorMessage('No active simulation');
            return;
        }

        const tempDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === simulationState!.tempUri!.toString());
        if (!tempDoc) {
             vscode.window.showErrorMessage('Simulation file closed');
             return;
        }

        const modifiedContent = tempDoc.getText();
        const edits = computeMinimalEdits(simulationState.originalContent, modifiedContent);

        let session = sessionManager.currentSession;
        if (!session) {
            session = await vscode.chat.startEditingSession();
            sessionManager.attachSession(session);
        }

        const workspaceEdit = new vscode.WorkspaceEdit();
        
        if (simulationState.originalContent === '' && modifiedContent !== '') {
             workspaceEdit.createFile(simulationState.originalUri, { ignoreIfExists: true });
             workspaceEdit.set(simulationState.originalUri, edits);
        } else if (simulationState.originalContent !== '' && modifiedContent === '') {
             workspaceEdit.deleteFile(simulationState.originalUri, { ignoreIfNotExists: true });
        } else {
             workspaceEdit.set(simulationState.originalUri, edits);
        }
        
        const result = await session.applyEdits(workspaceEdit, "Interactive Simulation");
        if (!result.success) {
            vscode.window.showErrorMessage(result.errorMessage || 'Failed to apply simulation');
        }
        
        await closeSimulation();
        vscode.window.showInformationMessage('Simulation Applied');
    };

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.applySimulation', applySimulationHandler));

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (simulationState && simulationState.tempUri && doc.uri.toString() === simulationState.tempUri.toString()) {
            await applySimulationHandler();
        }
    }));

    // --- New Core Test Commands ---

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.simulateRandomMultiFileEdits', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const files = await vscode.workspace.findFiles('**/*.*', '**/node_modules/**');
        const items = files.map(uri => ({
            label: vscode.workspace.asRelativePath(uri),
            uri: uri
        }));

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: 'Select files to apply random edits'
        });

        if (!selected || selected.length === 0) return;

        let session = sessionManager.currentSession;
        if (!session) {
            session = await vscode.chat.startEditingSession();
            sessionManager.attachSession(session);
        }

        const edit = new vscode.WorkspaceEdit();

        for (const item of selected) {
            const randomOp = Math.floor(Math.random() * 3);
            if (randomOp === 0) {
                // Insert random string at end
                try {
                    const doc = await vscode.workspace.openTextDocument(item.uri);
                    const lastLine = doc.lineAt(doc.lineCount - 1);
                    edit.insert(item.uri, lastLine.range.end, `\n// Random Insert ${Date.now()}`);
                } catch (e) {}
            } else if (randomOp === 1) {
                // Delete a line
                try {
                    const doc = await vscode.workspace.openTextDocument(item.uri);
                    if (doc.lineCount > 1) {
                        const randomLine = Math.floor(Math.random() * (doc.lineCount - 1));
                        edit.delete(item.uri, doc.lineAt(randomLine).rangeIncludingLineBreak);
                    }
                } catch (e) {}
            } else {
                // Create a random new file next to it
                const newUri = vscode.Uri.joinPath(item.uri, '..', `random-${Date.now()}.txt`);
                edit.createFile(newUri, { ignoreIfExists: true });
                edit.insert(newUri, new vscode.Position(0, 0), 'Random file generated\n');
            }
        }

        const result = await session.applyEdits(edit, "Random Multi-File Edits");
        if (!result.success) {
            vscode.window.showErrorMessage(result.errorMessage || 'Failed to apply random edits');
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('aiDiffSample.simulateApplyEditsFailure', async () => {
        // 1. Start a new session
        const session = await vscode.chat.startEditingSession();
        
        // 2. Immediately dispose it to create invalid state
        await session.dispose();

        // 3. Construct an arbitrary edit
        const edit = new vscode.WorkspaceEdit();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            const tempUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'temp-fail-test.txt');
            edit.createFile(tempUri, { ignoreIfExists: true });
            edit.insert(tempUri, new vscode.Position(0, 0), 'Should not see this');
        }

        // 4. Try to apply edits to disposed session
        const result = await session.applyEdits(edit, "Fail Test");
        
        // 5. Verify error handling
        if (!result.success) {
            vscode.window.showErrorMessage(`Expected Failure Captured: ${result.errorMessage || 'Unknown Error'}`);
        } else {
            vscode.window.showWarningMessage('Unexpected: applyEdits succeeded on disposed session');
        }
    }));
}

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
        const newText = modifiedLines.join('\n');
        return [new vscode.TextEdit(new vscode.Range(0, 0, 0, 0), newText)];
    }

    const range = new vscode.Range(new vscode.Position(start, 0), new vscode.Position(endOriginal + 1, 0));
    const newTextLines = modifiedLines.slice(start, endModified + 1);
    const newText = newTextLines.join('\n') + (endModified < modifiedLines.length - 1 ? '\n' : '');

    return [new vscode.TextEdit(range, newText)];
}