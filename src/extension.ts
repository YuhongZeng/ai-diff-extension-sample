import * as vscode from 'vscode';
import { SessionManager } from './SessionManager';
import { UIManager } from './UIManager';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext) {
    const uiManager = new UIManager(context);
    const sessionManager = new SessionManager(context, uiManager);

    sessionManager.restoreSessions();
    registerCommands(context, sessionManager, uiManager);
}

export function deactivate() {}