import * as vscode from 'vscode';
import { UIManager } from './UIManager.js';

export class SessionManager {
    private sessions: vscode.chat.ChatEditingSession[] = [];
    private _currentSession: vscode.chat.ChatEditingSession | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private uiManager: UIManager,
        private outputChannel: vscode.OutputChannel
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

    attachSession(session: vscode.chat.ChatEditingSession, isUnclaimed: boolean = false) {
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

        this.context.subscriptions.push(session.onDidChange(() => {
            this.outputChannel.appendLine(`[Event] Session ${session.id.substring(0, 8)}: onDidChange fired (files count: ${session.files.length})`);
            this.uiManager.updateUI(this);
        }));

        this.context.subscriptions.push(session.onDidUserAction((action) => {
            const actionMap: { [key: number]: string } = {
                1: 'FileAccepted',
                2: 'FileRejected',
                3: 'HunkAccepted',
                4: 'HunkRejected'
            };
            
            const stateMap: { [key: number]: string } = {
                0: 'Modified',
                1: 'Accepted',
                2: 'Rejected'
            };

            const actionName = actionMap[action.type] || `UnknownAction(${action.type})`;
            const source = action.isFromApi ? 'API Call' : 'User UI Interaction';
                        
            let fileInfo = '';
            if (action.file) {
                const f = action.file;
                const stateStr = stateMap[f.state] || `Unknown(${f.state})`;
                fileInfo = ` | FileState: ${stateStr}, isNew: ${f.isNew}, +${f.added} -${f.removed}`;
            }
            this.outputChannel.appendLine(`[Event]  ${isUnclaimed ? 'Unclaimed ' : ''} Session ${session.id.substring(0, 8)}: onDidUserAction fired. Type: ${actionName}, Source: ${source}, URI: ${vscode.workspace.asRelativePath(action.uri)},${fileInfo}`);
        }));

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
                // Check if the returned session ID matches the one we tried to restore.
                // If it's different, it means the old session was invalid and the API quietly created a new one.
                if (session.id !== id) {
                    session.dispose(); // Clean up the unwanted newly created session
                    continue; // Skip attaching and let the old ID be naturally purged
                }
                this.attachSession(session);
            } catch (e) {
                // Failed to restore, just ignore it. It will be cleaned up below.
            }
        }
        
        // Purge invalid IDs: Only keep the IDs of sessions that are currently alive
        const aliveIds = this.sessions.map(s => s.id);
        this.context.globalState.update('chatEditingSessionIds', aliveIds);
        
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