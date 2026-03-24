import { getDb, getSetting } from '@llm-observer/database';
import { exec } from 'child_process';
import { promisify } from 'util';
import dns from 'dns/promises';
import { platform } from 'os';

const execAsync = promisify(exec);

export const AI_DOMAINS: Record<string, string> = {
    'api.anthropic.com': 'anthropic',
    'api.openai.com': 'openai',
    'generativelanguage.googleapis.com': 'google',
    'api.mistral.ai': 'mistral',
    'api.groq.com': 'groq',
    'api.together.xyz': 'together',
    'api.fireworks.ai': 'fireworks',
    'api.deepseek.com': 'deepseek',
    'api.cohere.com': 'cohere'
};

export class NetworkMonitor {
    private interval: NodeJS.Timeout | null = null;
    private dnsInterval: NodeJS.Timeout | null = null;
    private resolvedIps: Map<string, string> = new Map(); // IP -> provider
    private lastLogged: Map<string, number> = new Map(); // "process:provider" -> timestamp
    private isScanning: boolean = false;
    private lastErrorLog: number = 0;
    private scanIntervalMs: number = 5000;

    async start() {
        this.stop();
        
        const enabled = getSetting('network_monitor_enabled') === 'true';
        if (!enabled) return;

        console.log('[NetworkMonitor] Starting...');
        
        await this.resolveDomains();
        await this.ensureTablesExist();
        
        this.scanIntervalMs = parseInt(getSetting('network_monitor_interval') || '5000');
        this.scheduleScan();
        
        this.dnsInterval = setInterval(() => this.resolveDomains(), 10 * 60 * 1000);
    }

    private scheduleScan() {
        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(() => this.scan(), this.scanIntervalMs);
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        if (this.dnsInterval) clearInterval(this.dnsInterval);
        this.interval = null;
        this.dnsInterval = null;
        console.log('[NetworkMonitor] Stopped.');
    }

    private async ensureTablesExist() {
        const db = getDb();
        db.exec(`
            CREATE TABLE IF NOT EXISTS app_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME NOT NULL,
                process_name TEXT NOT NULL,
                process_pid INTEGER,
                provider TEXT NOT NULL,
                destination_ip TEXT,
                destination_port INTEGER DEFAULT 443,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS app_aliases (
                process_name TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                icon TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
    }

    private async resolveDomains() {
        const newIps = new Map<string, string>();
        
        for (const [domain, provider] of Object.entries(AI_DOMAINS)) {
            try {
                // Resolve both IPv4 and IPv6 via { all: true }
                const addresses = await dns.lookup(domain, { all: true });
                for (const addr of addresses) {
                    newIps.set(addr.address, provider);
                }
            } catch (err) {
                for (const [ip, p] of this.resolvedIps.entries()) {
                    if (p === provider) newIps.set(ip, p);
                }
            }
        }
        
        this.resolvedIps = newIps;
    }

    private async scan() {
        if (this.isScanning) return;
        this.isScanning = true;

        const startTime = Date.now();

        try {
            const currentPlatform = platform();
            let connections: { process: string, pid: number, ip: string, port: number }[] = [];

            if (currentPlatform === 'darwin') {
                connections = await this.scanMacOS();
            } else if (currentPlatform === 'linux') {
                connections = await this.scanLinux();
            } else {
                this.isScanning = false;
                return;
            }

            const db = getDb();
            const now = new Date().toISOString();
            const nowMs = Date.now();

            for (const conn of connections) {
                // Strip brackets from IPv6 if lsof/ss includes them
                const cleanIp = conn.ip.replace(/^\[|\]$/g, '');
                const provider = this.resolvedIps.get(cleanIp);
                if (!provider) continue;

                // Deduplication: 30s window per (process, provider)
                const dedupKey = `${conn.process}:${provider}`;
                const lastTime = this.lastLogged.get(dedupKey) || 0;
                
                if (nowMs - lastTime > 30000) {
                    // Try to resolve actual app name for generic processes
                    const resolvedProcessName = await this.resolveProcessName(conn.pid, conn.process);
                    
                    db.prepare(`
                        INSERT INTO app_connections (timestamp, process_name, process_pid, provider, destination_ip, destination_port)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).run(now, resolvedProcessName, conn.pid, provider, conn.ip, conn.port);
                    
                    this.lastLogged.set(dedupKey, nowMs);
                }
            }

            // Automatic frequency adjustment
            const duration = Date.now() - startTime;
            if (duration > 2000 && this.scanIntervalMs < 15000) {
                console.warn(`[NetworkMonitor] Slow scan (${duration}ms). Reducing frequency to 15s.`);
                this.scanIntervalMs = 15000;
                this.scheduleScan();
            }

        } catch (err) {
            const now = Date.now();
            if (now - this.lastErrorLog > 60000) {
                console.error('[NetworkMonitor] Scan error:', (err as Error).message);
                this.lastErrorLog = now;
            }
        } finally {
            this.isScanning = false;
        }
    }

    private async resolveProcessName(pid: number, rawName: string): Promise<string> {
        const genericNames = ['electron', 'node', 'python', 'python3', 'bash', 'sh', 'curl'];
        const isGeneric = genericNames.includes(rawName.toLowerCase()) || rawName.includes('Helper');
        
        if (!isGeneric) return rawName;

        try {
            if (platform() === 'darwin') {
                const { stdout } = await execAsync(`ps -p ${pid} -o command=`);
                const appMatch = stdout.match(/\/([^\/]+)\.app\//);
                if (appMatch) return appMatch[1].toLowerCase();
                
                const firstWord = stdout.trim().split(/\s+/)[0];
                const parts = firstWord.split('/');
                return parts[parts.length - 1] || rawName;
            } else if (platform() === 'linux') {
                const { stdout } = await execAsync(`cat /proc/${pid}/cmdline`);
                const firstPart = stdout.split('\0')[0];
                const parts = firstPart.split('/');
                return parts[parts.length - 1] || rawName;
            }
        } catch (err) {
            // Ignore resolution errors
        }
        return rawName;
    }

    private async scanMacOS() {
        try {
            // Use -F for machine-readable output to avoid truncation and parsing issues
            // p=PID, c=Command, n=Name, TST=TCP State info
            const { stdout } = await execAsync('lsof -i -n -P -F pcnT');
            const lines = stdout.split('\n');
            const results: { process: string, pid: number, ip: string, port: number }[] = [];

            let currentPid: number | null = null;
            let currentCmd: string | null = null;
            let lastFoundIp: { ip: string, port: number } | null = null;

            for (const line of lines) {
                if (line.startsWith('p')) {
                    currentPid = parseInt(line.substring(1));
                } else if (line.startsWith('c')) {
                    currentCmd = line.substring(1);
                } else if (line.startsWith('n')) {
                    const namePart = line.substring(1);
                    if (namePart.includes('->')) {
                        const remotePart = namePart.split('->')[1];
                        const colonIndex = remotePart.lastIndexOf(':');
                        if (colonIndex > 0) {
                            const ip = remotePart.substring(0, colonIndex);
                            const port = parseInt(remotePart.substring(colonIndex + 1));
                            lastFoundIp = { ip, port };
                        }
                    } else {
                        lastFoundIp = null;
                    }
                } else if (line.startsWith('TST=ESTABLISHED')) {
                    if (currentPid && currentCmd && lastFoundIp) {
                        results.push({ process: currentCmd, pid: currentPid, ip: lastFoundIp.ip, port: lastFoundIp.port });
                        lastFoundIp = null; // Consume
                    }
                }
            }
            return results;
        } catch (err) {
            return [];
        }
    }

    private async scanLinux() {
        try {
            const { stdout } = await execAsync('ss -tp state established');
            const lines = stdout.split('\n');
            const results = [];

            for (const line of lines) {
                if (!line.includes('users:')) continue;

                const parts = line.trim().split(/\s+/);
                if (parts.length < 6) continue;

                const remotePart = parts[4]; 
                const userPart = parts[5];   

                const colonIndex = remotePart.lastIndexOf(':');
                const ip = remotePart.substring(0, colonIndex);
                const port = parseInt(remotePart.substring(colonIndex + 1));

                const pidMatch = userPart.match(/pid=(\d+)/);
                const nameMatch = userPart.match(/"([^"]+)"/);

                if (pidMatch && nameMatch) {
                    results.push({
                        process: nameMatch[1],
                        pid: parseInt(pidMatch[1]),
                        ip,
                        port
                    });
                }
            }
            return results;
        } catch (err) {
            return [];
        }
    }
    
    getStatus() {
        return {
            running: this.interval !== null,
            platform: platform(),
            knownIps: this.resolvedIps.size,
            lastLoggedCount: this.lastLogged.size,
            scanIntervalMs: this.scanIntervalMs
        };
    }
}

export const networkMonitor = new NetworkMonitor();
