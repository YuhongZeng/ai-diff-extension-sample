import * as vscode from 'vscode';
import { UIManager } from './UIManager';

export class SessionManager {
    private sessions: vscode.chat.ChatEditingSession[] = [];
    private _currentSession: vscode.chat.ChatEditingSession | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private uiManager: UIManager
    ) {}

    get currentSession(): vscode.chat.ChatEditingSession | undefined {
        return this._currentSession;
    }

    set currentSession(session: vscode.chat.ChatEditingSession | undefined) {
        this._currentSession = session;
    }

    get allSessions(): vscode.chat.ChatEditingSession[] {
        return this.sessions;
    }

    attachSession(session: vscode.chat.ChatEditingSession) {
        // Prevent duplicate attachments
        if (this.sessions.find(s => s.id === session.id)) {
            return;
        }

        this.sessions.push(session);
        this.currentSession = session;
        
        // Update persistence
        let ids = this.context.globalState.get<string[]>('chatEditingSessionIds') || [];
        if (!ids.includes(session.id)) {
            ids.push(session.id);
            this.context.globalState.update('chatEditingSessionIds', ids);
        }
        this.context.globalState.update('lastActiveChatEditingSessionId', session.id);

        this.context.subscriptions.push(session.onDidChange(() => this.uiManager.updateUI(this)));
        this.context.subscriptions.push(session.onDidDispose(() => {
            this.sessions = this.sessions.filter(s => s !== session);
            
            // Remove from persistence
            let ids = this.context.globalState.get<string[]>('chatEditingSessionIds') || [];
            ids = ids.filter(id => id !== session.id);
            this.context.globalState.update('chatEditingSessionIds', ids);

            if (this.currentSession === session) {
                this.currentSession = this.sessions[this.sessions.length - 1];
            }
            
            if (this.sessions.length === 0) {
                this.context.globalState.update('lastActiveChatEditingSessionId', undefined);
            } else if (this.currentSession) {
                this.context.globalState.update('lastActiveChatEditingSessionId', this.currentSession.id);
            }
            this.uiManager.updateUI(this);
        }));
        this.uiManager.updateUI(this);
        vscode.window.showInformationMessage('AI Diff Session Created/Restored');
    }

    async restoreSessions() {
        let lastSessionIds = this.context.globalState.get<string[]>('chatEditingSessionIds') || [];
        const legacyId = this.context.globalState.get<string>('lastChatEditingSessionId');
        if (legacyId && !lastSessionIds.includes(legacyId)) {
            lastSessionIds.push(legacyId);
            this.context.globalState.update('lastChatEditingSessionId', undefined); // Migrate
        }
        
        const lastActiveId = this.context.globalState.get<string>('lastActiveChatEditingSessionId');

        for (const id of lastSessionIds) {
            try {
                const session = await vscode.chat.startEditingSession({ chatSessionId: id });
                this.attachSession(session);
            } catch (e) {
                // Failed to restore, remove from list
                let ids = this.context.globalState.get<string[]>('chatEditingSessionIds') || [];
                ids = ids.filter(savedId => savedId !== id);
                this.context.globalState.update('chatEditingSessionIds', ids);
            }
        }
        
        // Restore active session selection
        if (lastActiveId) {
            const active = this.sessions.find(s => s.id === lastActiveId);
            if (active) {
                this.currentSession = active;
                this.uiManager.updateUI(this);
            }
        }
    }
}