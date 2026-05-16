import * as vscode from 'vscode';
import { SessionManager } from './SessionManager';
import { UIManager } from './UIManager';
import { registerCommands } from './commands';

declare function setTimeout(callback: (...args: any[]) => void, ms: number, ...args: any[]): any;

export async function activate(context: vscode.ExtensionContext) {
    // 1. Create Output Channel for Logging
    const outputChannel = vscode.window.createOutputChannel('AI Diff Sample');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('AI Diff Sample Extension Activated');

    outputChannel.appendLine('[Extension] 开始模拟耗时激活...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    outputChannel.appendLine('[Extension] 模拟耗时激活完成！');
    
    // 2. Initialize Managers
    const uiManager = new UIManager(context);
    const sessionManager = new SessionManager(context, uiManager, outputChannel);

    // 3. Register all commands
    registerCommands(context, sessionManager, uiManager);

    // 4. Register lazy-loading listener for on-demand activation
    context.subscriptions.push(
        vscode.chat.onDidUnclaimedUserAction(async (e) => {
            outputChannel.appendLine(`[Extension] 捕获到未认领的会话操作唤醒信号! SessionId: ${e.chatSessionId}`);

            // 收到信号后，立刻按需唤醒并接管该会话
            const session = await vscode.chat.startEditingSession({ chatSessionId: e.chatSessionId });

            // 将唤醒的 session 交给 SessionManager 统一管理
            sessionManager.attachSession(session, true);
        })
    );

    // 5. Activate Diff View Visibility
    // 立刻将当前文件所有活跃会话（多 Session）的 Overlay 以及对应的代码 Diff 显示给用户
    vscode.chat.setEditingEditorVisibility(true);
    outputChannel.appendLine('[Extension] 已调用 setEditingEditorVisibility(true)');
}

export function deactivate() {}
