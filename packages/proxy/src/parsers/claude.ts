import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { getParsedFile, upsertParsedFile, insertSession, insertSubagent, getSubagentsBySession, updateSessionTotals } from '@llm-observer/database';
import { getPricingForModel } from '@llm-observer/database';
import { upsertToolUsage } from '@llm-observer/database';

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

const findFilesRecursive = (dir: string, pattern: RegExp): string[] => {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            if (file === 'subagents') continue; // Subagents handled explicitly by parents
            results = results.concat(findFilesRecursive(filePath, pattern));
        } else if (pattern.test(filePath)) {
            results.push(filePath);
        }
    }
    return results;
};

/* PRIVACY RULE: This parser extracts ONLY metadata (token counts, duration, tool counts). It MUST NOT extract or store prompt text or raw conversational content to preserve developer privacy. */

interface UsageTotals {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h: number;
}

const emptyTotals = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 });

// Current Claude Code JSONL nests the API message under `message`; legacy formats had usage/model top-level.
const getEventMessage = (event: any): any | null =>
    (event && event.message && typeof event.message === 'object') ? event.message : null;

const extractModel = (event: any): string | undefined =>
    getEventMessage(event)?.model || event.model;

// One API response can span multiple JSONL lines (one per content block), each repeating
// the same usage object. Summing naively over-counts ~2x; billing is per (message.id, requestId).
const accumulateUsage = (event: any, totals: UsageTotals, seenRequests: Set<string>): void => {
    const msg = getEventMessage(event);
    const usage = msg?.usage || event.usage;
    if (!usage) return;
    const dedupeKey = `${msg?.id ?? ''}:${event.requestId ?? ''}`;
    if (dedupeKey !== ':') {
        if (seenRequests.has(dedupeKey)) return;
        seenRequests.add(dedupeKey);
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

const resolvePricing = (model: string) => {
    return getPricingForModel('anthropic', model)
        || getPricingForModel('anthropic', model.replace(/-\d{8}$/, ''));
};

// Anthropic bills cache writes at 1.25x input (5-minute TTL) and 2x input (1-hour TTL).
const computeCost = (model: string, totals: UsageTotals): number => {
    if (!model) return 0;
    const pricing = resolvePricing(model);
    if (!pricing) return 0;
    const cacheWrite5m = Math.max(0, totals.cacheWrite - totals.cacheWrite1h);
    const inputCost = (totals.input / 1_000_000) * pricing.input;
    const outputCost = (totals.output / 1_000_000) * pricing.output;
    const cacheReadCost = pricing.cached ? (totals.cacheRead / 1_000_000) * pricing.cached : 0;
    const cacheWriteCost = (cacheWrite5m / 1_000_000) * pricing.input * 1.25
        + (totals.cacheWrite1h / 1_000_000) * pricing.input * 2;
    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
};
export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const claudeDir = getClaudeDir();
    if (!fs.existsSync(claudeDir)) return;

    // Find all JSONL files
    const jsonlFiles = findFilesRecursive(claudeDir, /\.jsonl$/);
    const total = jsonlFiles.length;
    let current = 0;
    
    for (const filePath of jsonlFiles) {
        current++;
        if (onProgress) onProgress(current, total);
        
        try {
            await parseSessionFile(filePath);
        } catch (err) {
            console.error(`[Claude Parser] Failed to parse ${filePath}:`, err);
            upsertParsedFile({
                file_path: filePath,
                provider: 'claude-code',
                last_modified_at: fs.statSync(filePath).mtimeMs,
                last_parsed_at: new Date().toISOString(),
                status: 'error',
                error_message: String(err)
            });
        }
    }
};

const parseSessionFile = async (filePath: string) => {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    
    const registryEntry = getParsedFile(filePath);
    if (registryEntry && registryEntry.last_modified_at >= mtime) {
        // Skip unchanged file
        return;
    }

    // Determine basic session details from path
    const isSubagent = filePath.includes('subagents');
    const fileName = path.basename(filePath, '.jsonl');
    const sessionId = fileName; // 'agent-123' or 'UUID'
    
    // The project hash is the parent dir (if main session) or parent of parent (if subagent)
    const dirSegments = filePath.split(path.sep);
    const projectHash = isSubagent ? dirSegments[dirSegments.length - 3] : dirSegments[dirSegments.length - 2];
    
    // Read the file line by line
    let started_at: string | null = null;
    let ended_at: string | null = null;
    const totals = emptyTotals();
    const seenRequests = new Set<string>();
    let totalLines = 0;
    let conversationMessages = 0;
    let toolCalls: Record<string, number> = {};
    const modelCounts: Record<string, number> = {};

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
    });

    let sidechainEvents = 0;

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const event = JSON.parse(line);
            totalLines++;
            if (event.type === 'user' || event.type === 'assistant') {
                conversationMessages++;
            }
            if (event.isSidechain === true) {
                sidechainEvents++;
            }

            if (!started_at && event.timestamp) {
                started_at = new Date(event.timestamp).toISOString();
            }
            if (event.timestamp) {
                ended_at = new Date(event.timestamp).toISOString();
            }

            const model = extractModel(event);
            if (model) {
                modelCounts[model] = (modelCounts[model] || 0) + 1;
            }

            accumulateUsage(event, totals, seenRequests);
            countToolUses(event, toolCalls);

        } catch (e) {
            // Skip malformed line
        }
    }

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

    // Determine primary model
    let primaryModel = '';
    let maxCount = 0;
    for (const [model, count] of Object.entries(modelCounts)) {
        if (count > maxCount) {
            maxCount = count;
            primaryModel = model;
        }
    }

    // Determine estimated cost ('anthropic' as provider since it's claude-code)
    const estimatedCost = computeCost(primaryModel, totals);

    // Determine session type
    const toolCallCount = Object.values(toolCalls).reduce((a, b) => a + b, 0);
    const sessionType = toolCallCount > 0 ? 'agentic' : 'interactive';

    const cacheHitRate = cacheReadTokens + inputTokens > 0 ? cacheReadTokens / (cacheReadTokens + inputTokens) : 0;

    // Subagent counting. Legacy layout: separate files under subagents/.
    // Current layout: subagent turns live inline in the parent file as
    // isSidechain events, one spawn per Task tool call.
    let subagentCount = 0;
    let hasSubagents = false;
    if (!isSubagent) {
        const subagentsDir = path.join(path.dirname(filePath), 'subagents');
        if (fs.existsSync(subagentsDir)) {
            const list = fs.readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'));
            subagentCount = list.length;
            hasSubagents = subagentCount > 0;
        }
        if (subagentCount === 0) {
            const taskSpawns = toolCalls['Task'] || toolCalls['Agent'] || 0;
            if (taskSpawns > 0 || sidechainEvents > 0) {
                subagentCount = Math.max(taskSpawns, sidechainEvents > 0 ? 1 : 0);
                hasSubagents = true;
            }
        }
    }

    const parentId = insertSession({
        provider: 'claude-code',
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
        session_type: sessionType,
        tool_calls_json: JSON.stringify(toolCalls),
        has_subagents: hasSubagents,
        subagent_count: subagentCount,
        file_path: filePath,
        file_modified_at: mtime,
        parent_cost_usd: estimatedCost // Initial parent cost matches session cost
    });

    if (hasSubagents) {
        const subagentsDir = path.join(path.dirname(filePath), 'subagents');
        if (fs.existsSync(subagentsDir)) {
            const agentFiles = fs.readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'));
            for (const agentFile of agentFiles) {
                const subagentFilePath = path.join(subagentsDir, agentFile);
                const subagentStat = fs.statSync(subagentFilePath);
                const subagentRegistryEntry = getParsedFile(subagentFilePath);
                
                if (!subagentRegistryEntry || subagentRegistryEntry.last_modified_at < subagentStat.mtimeMs) {
                    await parseSubagentFile(subagentFilePath, parentId);
                }
            }
            // After parsing/checking all subagents, update parent with totals and perform consistency check
            updateParentWithSubagentTotals(parentId, estimatedCost);
        }
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

    upsertParsedFile({
        file_path: filePath,
        provider: 'claude-code',
        last_modified_at: mtime,
        last_parsed_at: new Date().toISOString(),
        status: 'success'
    });
};

const parseSubagentFile = async (filePath: string, parentId: number) => {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    const fileName = path.basename(filePath, '.jsonl');
    const agentId = fileName.replace('agent-', '');

    let started_at: string | null = null;
    let ended_at: string | null = null;
    const totals = emptyTotals();
    const seenRequests = new Set<string>();
    let totalLines = 0;
    let conversationMessages = 0;
    let toolCalls: Record<string, number> = {};
    const modelCounts: Record<string, number> = {};

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const event = JSON.parse(line);
            totalLines++;
            if (event.type === 'user' || event.type === 'assistant') conversationMessages++;
            if (!started_at && event.timestamp) started_at = new Date(event.timestamp).toISOString();
            if (event.timestamp) ended_at = new Date(event.timestamp).toISOString();
            const model = extractModel(event);
            if (model) modelCounts[model] = (modelCounts[model] || 0) + 1;
            accumulateUsage(event, totals, seenRequests);
            countToolUses(event, toolCalls);
        } catch (e) {}
    }

    if (!started_at) started_at = new Date(stat.birthtimeMs).toISOString();
    const messageCount = conversationMessages > 0 ? conversationMessages : totalLines;
    const inputTokens = totals.input;
    const outputTokens = totals.output;
    const cacheReadTokens = totals.cacheRead;
    const cacheWriteTokens = totals.cacheWrite;
    let primaryModel = Object.entries(modelCounts).sort((a,b) => b[1] - a[1])[0]?.[0] || '';
    const agentCost = computeCost(primaryModel, totals);

    insertSubagent({
        parent_session_id: parentId,
        agent_id: agentId,
        agent_type: classifyAgentType(toolCalls, inputTokens, outputTokens),
        model: primaryModel,
        started_at,
        ended_at: ended_at || undefined,
        duration_seconds: started_at && ended_at ? Math.round((new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000) : 0,
        message_count: messageCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: cacheWriteTokens,
        estimated_cost_usd: agentCost,
        tool_calls_json: JSON.stringify(toolCalls),
        file_path: filePath
    });

    upsertParsedFile({
        file_path: filePath,
        provider: 'claude-code',
        last_modified_at: mtime,
        last_parsed_at: new Date().toISOString(),
        status: 'success'
    });
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
