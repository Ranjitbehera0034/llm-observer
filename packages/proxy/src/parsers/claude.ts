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
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let messageCount = 0;
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
            messageCount++;
            
            if (!started_at && event.timestamp) {
                started_at = new Date(event.timestamp).toISOString();
            }
            if (event.timestamp) {
                ended_at = new Date(event.timestamp).toISOString();
            }

            if (event.model) {
                modelCounts[event.model] = (modelCounts[event.model] || 0) + 1;
            }

            // Usage extraction
            if (event.usage) {
                inputTokens += event.usage.input_tokens || event.usage.prompt_tokens || 0;
                outputTokens += event.usage.output_tokens || event.usage.completion_tokens || 0;
                cacheReadTokens += event.usage.cache_read_tokens || event.usage.cache_creation_input_tokens || 0; // fallback matching logic
                cacheWriteTokens += event.usage.cache_creation_tokens || 0;
            }

            // Tool extraction
            if (event.type === 'tool_use' || (event.message && event.message.tool_calls)) {
                // If it's a direct tool_use event from Claude Code
                const toolName = event.name || event.tool_name || 'unknown';
                toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
            } else if (event.content && Array.isArray(event.content)) {
                 for (const block of event.content) {
                     if (block.type === 'tool_use') {
                         const toolName = block.name || 'unknown';
                         toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
                     }
                 }
            }

        } catch (e) {
            // Skip malformed line
        }
    }

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

    // Determine estimated cost
    let estimatedCost = 0;
    if (primaryModel) {
        // We use 'anthropic' as provider since it's claude-code
        const pricing = getPricingForModel('anthropic', primaryModel);
        if (pricing) {
            const inputCost = (inputTokens / 1_000_000) * pricing.input;
            const outputCost = (outputTokens / 1_000_000) * pricing.output;
            const cacheCost = pricing.cached ? (cacheReadTokens / 1_000_000) * pricing.cached : 0;
            estimatedCost = inputCost + outputCost + cacheCost;
        }
    }

    // Determine session type
    const toolCallCount = Object.values(toolCalls).reduce((a, b) => a + b, 0);
    const sessionType = toolCallCount > 0 ? 'agentic' : 'interactive';

    const cacheHitRate = cacheReadTokens + inputTokens > 0 ? cacheReadTokens / (cacheReadTokens + inputTokens) : 0;

    // Subagent counting
    let subagentCount = 0;
    let hasSubagents = false;
    if (!isSubagent) {
        const subagentsDir = path.join(path.dirname(filePath), 'subagents');
        if (fs.existsSync(subagentsDir)) {
            const list = fs.readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'));
            subagentCount = list.length;
            hasSubagents = subagentCount > 0;
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
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let messageCount = 0;
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
            messageCount++;
            if (!started_at && event.timestamp) started_at = new Date(event.timestamp).toISOString();
            if (event.timestamp) ended_at = new Date(event.timestamp).toISOString();
            if (event.model) modelCounts[event.model] = (modelCounts[event.model] || 0) + 1;
            if (event.usage) {
                inputTokens += event.usage.input_tokens || event.usage.prompt_tokens || 0;
                outputTokens += event.usage.output_tokens || event.usage.completion_tokens || 0;
                cacheReadTokens += event.usage.cache_read_tokens || 0;
                cacheWriteTokens += event.usage.cache_creation_tokens || 0;
            }
            if (event.type === 'tool_use') {
                const toolName = event.name || 'unknown';
                toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
            }
        } catch (e) {}
    }

    if (!started_at) started_at = new Date(stat.birthtimeMs).toISOString();
    let primaryModel = Object.entries(modelCounts).sort((a,b) => b[1] - a[1])[0]?.[0] || '';
    let agentCost = 0;
    if (primaryModel) {
        const pricing = getPricingForModel('anthropic', primaryModel);
        if (pricing) {
            agentCost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
        }
    }

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
