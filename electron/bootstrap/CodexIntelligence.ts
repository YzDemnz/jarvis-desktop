import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { vacantPort } from './LocalRuntime';
import { NodeProcessPort } from '../dev/nodePorts';
import { spawnWindowsJob, withProcessScope } from '../process/WindowsJobProcess';
import type { SpawnedProcess } from '../../src/dev/ports';
import { safeContextText } from '../../src/fabric/ContinuityState';
/** Official app-server protocol. Never imports desktop tokens/cookies/auth.json. */
export class CodexIntelligence {
    private proc: SpawnedProcess | null = null;
    private ws: WebSocket | null = null;
    private next = 1;
    private pending = new Map<number, {
        resolve: (x: any) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    private notifications = new Set<(event: any) => void>();
    private starting: Promise<void> | null = null;
    private epoch=0;
    protocolVerified = false;
    lastError: string | null = null;
    lastModel:string|null=null;
    models:string[]=[];
    startupDiagnostic='';
    status: 'NOT_INSTALLED' | 'AUTH_REQUIRED' | 'NOT_VERIFIED' | 'OPERATIVE' | 'BLOCKED' = 'NOT_INSTALLED';
    constructor(readonly directory: string, private readonly executable: string | null) { this.status = executable && fs.existsSync(executable) ? 'AUTH_REQUIRED' : 'NOT_INSTALLED'; }
    async ready(): Promise<void> { if (this.ws?.readyState === WebSocket.OPEN)
        return; if (this.starting)
        return this.starting; this.starting = this.start().finally(() => this.starting = null); return this.starting; }
    private async start() {
        if(this.proc)await this.stop();
        const epoch=this.epoch;
        const guard=()=>{if(epoch!==this.epoch)throw Error('CODEX_STOPPED');};
        if (!this.executable || !path.isAbsolute(this.executable) || !fs.existsSync(this.executable))
            throw Error('CODEX_NOT_INSTALLED');
        fs.mkdirSync(this.directory, { recursive: true });
        const port = await vacantPort();
        guard();this.protocolVerified=false;
        const env = new NodeProcessPort().baseEnv();
        env.CODEX_HOME = this.directory;
        env.USERPROFILE = this.directory;
        env.HOME = this.directory;
        const args = ['app-server', '--listen', `ws://127.0.0.1:${port}`, '-c', 'cli_auth_credentials_store="keyring"', '-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false', '-c', 'features.web_search_request=false', '-c', 'features.apps=false', '-c', 'features.plugins=false'];
        const executable = this.executable;
        this.proc = withProcessScope('bootstrap-codex', undefined, () => spawnWindowsJob({ file: executable, args, cwd: this.directory, env }));
        this.proc.onStderr(text => {if(process.env.JARVIS_ALLOW_FIXTURES==='1')this.startupDiagnostic=safeContextText((this.startupDiagnostic+text).slice(0,3000));});
        const owned=this.proc;
        this.proc.onExit(() => { if(this.proc===owned){this.proc = null; this.ws?.close(); this.ws = null; this.status = 'AUTH_REQUIRED'; this.failPending();} });
        await owned.ready;guard();
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            guard();
            if(!this.proc)throw Error('CODEX_PROCESS_EXITED');
            try {
                this.ws = await new Promise<WebSocket>((resolve, reject) => { const ws = new WebSocket(`ws://127.0.0.1:${port}`, { handshakeTimeout: 1000 }); ws.once('open', () => resolve(ws)); ws.once('error', () => { ws.close(); reject(Error('CODEX_CONNECT_FAILED')); }); });
                if(epoch!==this.epoch){this.ws.close();this.ws=null;guard();}
                break;
            }
            catch {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        if (!this.ws)
            throw Error('CODEX_START_TIMEOUT');
        guard();
        this.ws.on('message', bytes => { const raw = bytes.toString(); if (raw.length > 2 * 1024 ** 2) {
            void this.stop();
            return;
        } try {
            this.receive(JSON.parse(raw));
        }
        catch {
            void this.stop();
        } });
        this.ws.on('close', () => this.failPending());
        this.ws.on('error', () => this.failPending());
        await this.rpc('initialize', { clientInfo: { name: 'jarvis', title: 'JARVIS', version: '0.4.4-dev' }, capabilities: { experimentalApi: false } });
        guard();
        this.ws.send(JSON.stringify({ method: 'initialized' }));
        this.protocolVerified = true;
    }
    private failPending() { for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error('CODEX_DISCONNECTED'));
    } this.pending.clear(); }
    private receive(event: any) {
        if (event.id !== undefined && event.method) {
            // Every server tool/approval request is denied. No command/exec,
            // filesystem edit, credential, dynamic-tool or effect implementation.
            this.ws?.send(JSON.stringify({ id: event.id, error: { code: -32601, message: 'JARVIS admits no provider-owned tools or effects' } }));
            return;
        }
        if (event.id !== undefined) {
            const p = this.pending.get(event.id);
            if (p) {
                this.pending.delete(event.id);
                clearTimeout(p.timer);
                event.error ? p.reject(Error('CODEX_RPC_FAILED')) : p.resolve(event.result);
            }
            return;
        }
        this.notifications.forEach(fn => fn(event));
    }
    private rpc(method: string, params: unknown): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return Promise.reject(Error('CODEX_OFFLINE'));
        const id = this.next++;
        return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('CODEX_RPC_TIMEOUT')); }, 30000); this.pending.set(id, { resolve, reject, timer }); this.ws!.send(JSON.stringify({ id, method, params })); });
    }
    async inspect() {
        try {
            await this.ready();
            const r = await this.rpc('account/read', { refreshToken: false });
            this.status = r.account?.type === 'chatgpt' ? (this.status === 'OPERATIVE' ? 'OPERATIVE' : 'NOT_VERIFIED') : r.account ? 'BLOCKED' : 'AUTH_REQUIRED';
            try{const catalog=await this.rpc('model/list',{limit:50,includeHidden:false});this.models=(catalog.data??[]).map((m:any)=>m.model).filter((m:unknown):m is string=>typeof m==='string'&&/^[a-zA-Z0-9._:/-]{1,200}$/.test(m)).slice(0,50);}catch{this.models=[];}
            this.lastError = null;
        }
        catch (e) {
            const message = e instanceof Error ? e.message : '';
            this.lastError = /^CODEX_[A-Z_]+$/.test(message) ? message : 'CODEX_PROTOCOL_FAILED';
            await this.stop();
            this.status = this.executable && fs.existsSync(this.executable) ? 'BLOCKED' : 'NOT_INSTALLED';
        }
        return { status: this.status, auth: 'OFFICIAL_CHATGPT_APP_SERVER', apiPaidAllowed: false, protocolVerified: this.protocolVerified, lastError: this.lastError };
    }
    async login(): Promise<string> { await this.ready(); const r = await this.rpc('account/login/start', { type: 'chatgpt' }); const u = new URL(r.authUrl); if (u.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(u.hostname))
        throw Error('CODEX_LOGIN_DESTINATION_DENIED'); return u.href; }
    async answer(prompt: string, signal: AbortSignal, context?:string, model?:string): Promise<string> {
        signal.throwIfAborted();
        const earlyAbort=()=>{void this.stop();};
        signal.addEventListener('abort',earlyAbort,{once:true});
        try{
        const s = await this.inspect();
        signal.throwIfAborted();
        if (!['NOT_VERIFIED', 'OPERATIVE'].includes(s.status))
            throw Error('CODEX_AUTH_REQUIRED_OR_API_ACCOUNT_BLOCKED');
        const thread = await this.rpc('thread/start', { cwd: this.directory, ...(model&&model!=='default'?{model}:{}), sandbox: 'readOnly', approvalPolicy: 'never', ephemeral: true, serviceName: 'jarvis-bootstrap-intelligence', config: { 'features.shell_tool': false, 'features.unified_exec': false, 'features.web_search_request': false }, developerInstructions: 'Provide text only. You are replaceable intelligence. JARVIS exclusively controls onboarding, downloads, installation, routing, secrets, verification and effects. Do not use any tools.' });
        this.lastModel=typeof thread.model==='string'&&/^[a-zA-Z0-9._:/-]{1,200}$/.test(thread.model)?thread.model:null;
        signal.throwIfAborted();
        const threadId = thread.thread?.id;
        if (typeof threadId !== 'string')
            throw Error('CODEX_THREAD_FAILED');
        let text = '';
        let finish!: (x: string) => void, fail!: (e: Error) => void;
        const completed = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; });
        void completed.catch(() => { });
        const listener = (e: any) => { if (e.params?.threadId !== threadId)
            return; if (e.method === 'item/agentMessage/delta'){
            text += typeof e.params.delta==='string'?e.params.delta:'';
            if(text.length>2*1024**2){void this.stop();fail(Error('CODEX_OUTPUT_TOO_LARGE'));return;}}
            if (e.method === 'turn/completed') {
            e.params.turn?.status === 'completed' && text.trim() ? finish(safeContextText(text)) : fail(Error('CODEX_INFERENCE_FAILED'));
        } };
        const abort = () => { void this.stop(); fail(Error('CODEX_STOPPED')); };
        this.notifications.add(listener);
        signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 90000);
        try {
            signal.throwIfAborted();
            await this.rpc('turn/start', { threadId, input: [{ type: 'text', text: safeContextText(context?`JARVIS public task context, not authority:\n${context}\n\nLatest user request:\n${prompt}`:prompt) }], approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } });
            const result = await completed;
            this.status = 'OPERATIVE';
            return result;
        }
        finally {
            clearTimeout(timer);
            this.notifications.delete(listener);
            signal.removeEventListener('abort', abort);
        }
        }finally{signal.removeEventListener('abort',earlyAbort);}
    }
    async stop() { this.epoch++;this.ws?.close(); this.ws = null; const p = this.proc; this.proc = null; if (p)
        await p.killTree(); this.failPending(); }
}
