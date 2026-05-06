import * as vscode from 'vscode';
import { SessionManager } from './SessionManager';
import { UIManager } from './UIManager';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext) {
    // 1. Create Output Channel for Logging
    const outputChannel = vscode.window.createOutputChannel('AI Diff Sample');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('AI Diff Sample Extension Activated');

    // 2. Initialize Managers
    const uiManager = new UIManager(context);
    const sessionManager = new SessionManager(context, uiManager, outputChannel);

    // 3. Restore any previously active sessions
    sessionManager.restoreSessions();

    // 4. Register all commands
    registerCommands(context, sessionManager, uiManager);
}

export function deactivate() {}