import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { insertSession, insertSubagent, getSubagentsBySession, updateSessionTotals, invalidateEstimatedSessions } from '@llm-observer/database';
import { upsertToolUsage } from '@llm-observer/database';
import { findFilesRecursive, shouldParseFile, markFileParsed } from './utils';
import { UsageTotals, emptyTotals, loadPricingRows, priceUsageByModel } from './claudePricing';

const getClaudeDir = () => {
    const home = os.homedir();
    if (process.platform === 'win32') {
        return path.join(home, '.claude', 'projects');
    }
    return path.join(home, '.claude', 'projects');
};

export const detector = (): boolean => {
    return fs.existsSync(getClaudeDir());
};

/* PRIVACY RULE: This parser extracts ONLY metadata (token counts, duration, tool counts). It MUST NOT extract or store prompt text or raw conversational content to preserve developer privacy. */

// Current Claude Code JSONL nests the API message under `message`; legacy formats had usage/model top-level.
const getEventMessage = (event: any): any | null =>
    (event && event.message && typeof event.message === 'object') ? event.message : null;

const extractModel = (event: any): string | undefined =>
    getEventMessage(event)?.model || event.model;

// One API response can span multiple JSONL lines (one per content block), each repeating
// the same usage object. Summing naively over-counts ~2x; billing is per (message.id, requestId).
const accumulateUsage = (event: any, buckets: Map<string, UsageTotals>, seenRequests: Set<string>): void => {
    const msg = getEventMessage(event);
    const usage = msg?.usage || event.usage;
    if (!usage) return;
    const dedupeKey = `${msg?.id ?? ''}:${event.requestId ?? ''}`;
    if (dedupeKey !== ':') {
        if (seenRequests.has(dedupeKey)) return;
        seenRequests.add(dedupeKey);
    }
    // Usage is bucketed per model so a session that mixes models is priced per model, not at the dominant one.
    const model = extractModel(event) || '';
    let totals = buckets.get(model);
    if (!totals) {
        totals = emptyTotals();
        buckets.set(model, totals);
    }
    totals.input += usage.input_tokens || usage.prompt_tokens || 0;
    totals.output += usage.output_tokens || usage.completion_tokens || 0;
    totals.cacheRead += usage.cache_read_input_tokens || usage.cache_read_tokens || 0;
    totals.cacheWrite += usage.cache_creation_input_tokens || usage.cache_creation_tokens || 0;
    totals.cacheWrite1h += usage.cache_creation?.ephemeral_1h_input_tokens || 0;
};

const countToolUses = (event: any, toolCalls: Record<string, number>): void => {
    if (event.type === 'tool_use' || (event.message && event.message.tool_calls)) {
        const toolName = event.name || event.tool_name || 'unknown';
        toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
        return;
    }
    const content = getEventMessage(event)?.content || event.content;
    if (Array.isArray(content)) {
        for (const block of content) {
            if (block && block.type === 'tool_use') {
                const toolName = block.name || 'unknown';
                toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
            }
        }
    }
};

const CLAUDE_TOOL_NAME = 'Claude Code';

// Subagent transcripts live in <project>/<sessionId>/subagents/agent-*.jsonl, and agents started
// by a workflow in <project>/<sessionId>/subagents/workflows/<workflowId>/agent-*.jsonl.
const isSubagentPath = (claudeDir: string, filePath: string): boolean =>
    path.relative(claudeDir, filePath).split(path.sep).includes('subagents');

const findSubagentFiles = (sessionFilePath: string): string[] => {
    const sessionId = path.basename(sessionFilePath, '.jsonl');
    const dir = path.join(path.dirname(sessionFilePath), sessionId, 'subagents');
    return findFilesRecursive(dir, /\.jsonl$/).sort();
};

const safeMtime = (filePath: string): number => {
    try { return fs.statSync(filePath).mtimeMs; } catch { return 0; }
};

export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const claudeDir = getClaudeDir();
    if (!fs.existsSync(claudeDir)) return;

    // A pricing refresh may have given exact prices to models that were only estimated before.
    try {
        invalidateEstimatedSessions('claude-code', 'anthropic');
    } catch (err) {
        console.error('[Claude Parser] Could not queue estimated sessions for re-pricing:', err);
    }
    loadPricingRows();

    // Find all session JSONL files (subagent files are handled by their parent session)
    const jsonlFiles = findFilesRecursive(claudeDir, /\.jsonl$/).filter(f => !isSubagentPath(claudeDir, f));
    const total = jsonlFiles.length;
    let current = 0;
    
    for (const filePath of jsonlFiles) {
        current++;
        if (onProgress) onProgress(current, total);
        
        try {
            await parseSessionFile(filePath);
        } catch (err) {
            console.error(`[Claude Parser] Failed to parse ${filePath}:`, err);
            markFileParsed(filePath, 'claude-code', safeMtime(filePath), 'error', String(err));
        }
    }
};

interface FileScan {
    started_at: string | null;
    ended_at: string | null;
    buckets: Map<string, UsageTotals>;
    totals: UsageTotals;
    totalLines: number;
    conversationMessages: number;
    sidechainEvents: number;
    toolCalls: Record<string, number>;
    modelCounts: Record<string, number>;
}

const scanFile = async (filePath: string): Promise<FileScan> => {
    const scan: FileScan = {
        started_at: null,
        ended_at: null,
        buckets: new Map(),
        totals: emptyTotals(),
        totalLines: 0,
        conversationMessages: 0,
        sidechainEvents: 0,
        toolCalls: {},
        modelCounts: {}
    };
    const seenRequests = new Set<string>();

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const event = JSON.parse(line);
            scan.totalLines++;
            if (event.type === 'user' || event.type === 'assistant') {
                scan.conversationMessages++;
            }
            if (event.isSidechain === true) {
                scan.sidechainEvents++;
            }

            if (!scan.started_at && event.timestamp) {
                scan.started_at = new Date(event.timestamp).toISOString();
            }
            if (event.timestamp) {
                scan.ended_at = new Date(event.timestamp).toISOString();
            }

            const model = extractModel(event);
            if (model) {
                scan.modelCounts[model] = (scan.modelCounts[model] || 0) + 1;
            }

            accumulateUsage(event, scan.buckets, seenRequests);
            countToolUses(event, scan.toolCalls);

        } catch (e) {
            // Skip malformed line
        }
    }

    for (const t of scan.buckets.values()) {
        scan.totals.input += t.input;
        scan.totals.output += t.output;
        scan.totals.cacheRead += t.cacheRead;
        scan.totals.cacheWrite += t.cacheWrite;
        scan.totals.cacheWrite1h += t.cacheWrite1h;
    }
    return scan;
};

const dominantModel = (modelCounts: Record<string, number>): string => {
    let primaryModel = '';
    let maxCount = 0;
    for (const [model, count] of Object.entries(modelCounts)) {
        if (count > maxCount) {
            maxCount = count;
            primaryModel = model;
        }
    }
    return primaryModel;
};

const parseSessionFile = async (filePath: string) => {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    
    // Subagent files are checked too: they change independently of the parent, and an
    // errored one must be retried. Errored files are never skipped (shouldParseFile).
    const agentFiles = findSubagentFiles(filePath);
    const staleAgentFiles = agentFiles.filter(f => shouldParseFile(f, safeMtime(f)));
    if (!shouldParseFile(filePath, mtime) && staleAgentFiles.length === 0) {
        // Skip unchanged file
        return;
    }

    // Determine basic session details from path: <project>/<sessionId>.jsonl
    const sessionId = path.basename(filePath, '.jsonl');
    const projectHash = path.basename(path.dirname(filePath));
    
    // Read the file line by line
    const scan = await scanFile(filePath);
    let { started_at } = scan;
    const { ended_at, totals, totalLines, conversationMessages, toolCalls, sidechainEvents } = scan;

    // Files with typed user/assistant lines get a true conversation count; legacy files fall back to line count
    const messageCount = conversationMessages > 0 ? conversationMessages : totalLines;
    const inputTokens = totals.input;
    const outputTokens = totals.output;
    const cacheReadTokens = totals.cacheRead;
    const cacheWriteTokens = totals.cacheWrite;

    if (!started_at) started_at = new Date(stat.birthtimeMs).toISOString();
    
    // Duration
    let durationSeconds = 0;
    if (started_at && ended_at) {
        durationSeconds = Math.round((new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000);
    }

    // Primary model is the most frequent one; cost is priced per model, not at the primary model
    const primaryModel = dominantModel(scan.modelCounts);
    const { costUsd: estimatedCost, isEstimated, costSource } = priceUsageByModel(scan.buckets, primaryModel);

    // Determine session type
    const toolCallCount = Object.values(toolCalls).reduce((a, b) => a + b, 0);
    const sessionType = toolCallCount > 0 ? 'agentic' : 'interactive';

    const cacheHitRate = cacheReadTokens + inputTokens > 0 ? cacheReadTokens / (cacheReadTokens + inputTokens) : 0;

    // Subagent counting. Separate files under <sessionId>/subagents/ when present; otherwise
    // subagent turns live inline in the parent file as isSidechain events, one spawn per Task tool call.
    let subagentCount = agentFiles.length;
    let hasSubagents = subagentCount > 0;
    if (subagentCount === 0) {
        const taskSpawns = toolCalls['Task'] || toolCalls['Agent'] || 0;
        if (taskSpawns > 0 || sidechainEvents > 0) {
            subagentCount = Math.max(taskSpawns, sidechainEvents > 0 ? 1 : 0);
            hasSubagents = true;
        }
    }

    const parentId = insertSession({
        provider: 'claude-code',
        tool: CLAUDE_TOOL_NAME,
        session_id: sessionId,
        project_path: projectHash, 
        project_name: projectHash, 
        model_primary: primaryModel,
        started_at,
        ended_at: ended_at || undefined,
        duration_seconds: durationSeconds,
        message_count: messageCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: cacheWriteTokens,
        cache_hit_rate: cacheHitRate,
        estimated_cost_usd: estimatedCost,
        is_estimated: isEstimated,
        cost_source: costSource,
        session_type: sessionType,
        tool_calls_json: JSON.stringify(toolCalls),
        has_subagents: hasSubagents,
        subagent_count: subagentCount,
        file_path: filePath,
        file_modified_at: mtime,
        parent_cost_usd: estimatedCost // Initial parent cost matches session cost
    });

    if (agentFiles.length > 0) {
        for (const subagentFilePath of staleAgentFiles) {
            try {
                await parseSubagentFile(subagentFilePath, parentId);
            } catch (err) {
                // One bad agent file must not lose the parent; it stays 'error' and is retried next cycle.
                console.error(`[Claude Parser] Failed to parse subagent ${subagentFilePath}:`, err);
                markFileParsed(subagentFilePath, 'claude-code', safeMtime(subagentFilePath), 'error', String(err));
            }
        }
        // After parsing/checking all subagents, update parent with totals and perform consistency check
        updateParentWithSubagentTotals(parentId, estimatedCost);
    }

    // Daily tool usage aggregation (simplified for now)
    const dateStr = started_at.split('T')[0];
    for (const [tool, count] of Object.entries(toolCalls)) {
        upsertToolUsage({
            date: dateStr,
            provider: 'claude-code',
            tool_name: tool,
            call_count: count,
            total_tokens: 0, // Placeholder
            estimated_cost_usd: 0 // Placeholder
        });
    }

    markFileParsed(filePath, 'claude-code', mtime, 'success');
};

const parseSubagentFile = async (filePath: string, parentId: number) => {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    const fileName = path.basename(filePath, '.jsonl');
    const agentId = fileName.replace('agent-', '');

    const scan = await scanFile(filePath);
    const { ended_at, totals, toolCalls } = scan;
    const started_at = scan.started_at || new Date(stat.birthtimeMs).toISOString();
    const messageCount = scan.conversationMessages > 0 ? scan.conversationMessages : scan.totalLines;
    const primaryModel = dominantModel(scan.modelCounts);
    const { costUsd: agentCost, isEstimated, costSource } = priceUsageByModel(scan.buckets, primaryModel);

    insertSubagent({
        parent_session_id: parentId,
        agent_id: agentId,
        agent_type: classifyAgentType(toolCalls, totals.input, totals.output),
        model: primaryModel,
        started_at,
        ended_at: ended_at || undefined,
        duration_seconds: ended_at ? Math.round((new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000) : 0,
        message_count: messageCount,
        input_tokens: totals.input,
        output_tokens: totals.output,
        cache_read_tokens: totals.cacheRead,
        cache_write_tokens: totals.cacheWrite,
        estimated_cost_usd: agentCost,
        is_estimated: isEstimated,
        cost_source: costSource,
        tool_calls_json: JSON.stringify(toolCalls),
        file_path: filePath
    });

    markFileParsed(filePath, 'claude-code', mtime, 'success');
};

export const classifyAgentType = (toolCalls: Record<string, number>, input: number, output: number): string => {
    const totalCalls = Object.values(toolCalls).reduce((a, b) => a + b, 0);
    const readCalls = toolCalls['Read'] || toolCalls['ReadFile'] || 0;
    const writeCalls = toolCalls['Write'] || toolCalls['WriteFile'] || 0;
    const bashCalls = toolCalls['Bash'] || 0;

    if (totalCalls === 0 && output > input * 2) return 'plan';
    if (readCalls > totalCalls * 0.5 && writeCalls < totalCalls * 0.1) return 'explore';
    // Validate: Bash + Read, but NO Writes
    if (bashCalls > 0 && totalCalls > bashCalls && readCalls > 0 && writeCalls === 0) return 'validate';
    // Execute: Any Writes or dominant Bash
    if (writeCalls > 0 || bashCalls > totalCalls * 0.3) return 'execute';
    return 'general';
};

const updateParentWithSubagentTotals = (parentId: number, originalParentCost: number) => {
    const agents = getSubagentsBySession(parentId);
    const totalSubagentCost = agents.reduce((sum: number, a: any) => sum + (a.estimated_cost_usd || 0), 0);
    
    // Consistency check: total session cost vs (parent interactive cost + subagent totals)
    // estimated_cost_usd in sessions table represents the summary from the parent log file
    // which *should* already account for subagent token counts if Claude Code logs them correctly,
    // OR it might only represent the parent's interactive overhead. 
    // Usually, parent log in Claude Code shows aggregate usage *including* what it thinks subagents did.
    // However, our subagent parser reads the discrete logs.
    const combinedCost = originalParentCost + totalSubagentCost;
    
    if (Math.abs(combinedCost - originalParentCost) > 0.01 && totalSubagentCost > 0) {
        console.log(`[Claude Parser] Session ${parentId}: Parent cost $${originalParentCost.toFixed(4)}, Subagents total $${totalSubagentCost.toFixed(4)}.`);
    }

    updateSessionTotals(parentId, totalSubagentCost, agents.length);
};
