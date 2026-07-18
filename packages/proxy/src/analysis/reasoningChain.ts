/**
 * Reasoning-chain / tool-invocation replay — normalizes a stored
 * request/response pair into a step-by-step timeline: who said what, which
 * tools were invoked with what inputs, and what each tool returned.
 *
 * Because the request body always contains the FULL prior conversation
 * (stateless chat APIs re-send the whole transcript every call), a single
 * logged request already captures every earlier turn, tool call, and tool
 * result — no need to stitch multiple log rows together to get a genuine
 * multi-step chain.
 *
 * Scope, stated plainly: this parses OpenAI-style (`messages[].content`
 * string + `tool_calls[]`, `role: "tool"` results) and Anthropic-style
 * (`content[]` blocks: text / tool_use / tool_result) request shapes, which
 * covers every provider this proxy supports. The RESPONSE side is only
 * structurally parsed when it was a single non-streaming JSON body — a
 * streamed response is reported as unparsed rather than guessed at, because
 * reconstructing exact tool-call arguments from partial SSE deltas isn't
 * reliable enough to present as a debugger's ground truth.
 */

export type ChainRole = 'system' | 'user' | 'assistant' | 'tool';
export type ChainStepType = 'text' | 'tool_use' | 'tool_result';
export type ChainTurn = 'request' | 'response';

export interface ChainStep {
    index: number;
    turn: ChainTurn;
    role: ChainRole;
    type: ChainStepType;
    text?: string;
    toolName?: string;
    toolInput?: any;
    toolUseId?: string;
    isError?: boolean;
}

export interface ReasoningChainResult {
    steps: ChainStep[];
    /** false when the response side couldn't be structurally parsed (streamed, malformed, or empty) */
    responseParsed: boolean;
}

function textFromToolResultContent(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .filter((c: any) => c && c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
    }
    if (content == null) return '';
    try { return JSON.stringify(content); } catch { return String(content); }
}

function parseToolCallArguments(raw: any): any {
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch { return raw; }
}

/** Parses one message object into zero or more normalized steps (a single message can carry text AND tool calls). */
function parseMessage(msg: any, turn: ChainTurn, nextIndex: () => number): ChainStep[] {
    if (!msg || typeof msg !== 'object') return [];
    const steps: ChainStep[] = [];
    const role: ChainRole = (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool')
        ? msg.role
        : 'assistant';

    // OpenAI-style tool-result message: role "tool", content is the result string
    if (role === 'tool' && typeof msg.content === 'string') {
        steps.push({ index: nextIndex(), turn, role: 'tool', type: 'tool_result', text: msg.content, toolUseId: msg.tool_call_id });
        return steps;
    }

    if (typeof msg.content === 'string') {
        if (msg.content.trim().length > 0) {
            steps.push({ index: nextIndex(), turn, role, type: 'text', text: msg.content });
        }
    } else if (Array.isArray(msg.content)) {
        // Anthropic-style content blocks
        for (const block of msg.content) {
            if (!block || typeof block !== 'object') continue;
            if (block.type === 'text' && typeof block.text === 'string') {
                steps.push({ index: nextIndex(), turn, role, type: 'text', text: block.text });
            } else if (block.type === 'tool_use') {
                steps.push({ index: nextIndex(), turn, role, type: 'tool_use', toolName: block.name, toolInput: block.input, toolUseId: block.id });
            } else if (block.type === 'tool_result') {
                steps.push({
                    index: nextIndex(), turn, role: 'tool', type: 'tool_result',
                    text: textFromToolResultContent(block.content),
                    toolUseId: block.tool_use_id, isError: !!block.is_error
                });
            }
        }
    }

    // OpenAI-style tool calls attached to an assistant message
    if (Array.isArray(msg.tool_calls)) {
        for (const call of msg.tool_calls) {
            steps.push({
                index: nextIndex(), turn, role: 'assistant', type: 'tool_use',
                toolName: call?.function?.name, toolInput: parseToolCallArguments(call?.function?.arguments), toolUseId: call?.id
            });
        }
    }

    return steps;
}

export function buildReasoningChain(requestBodyStr: string, responseBodyStr: string, isStreaming: boolean): ReasoningChainResult {
    const steps: ChainStep[] = [];
    let counter = 0;
    const nextIndex = () => counter++;

    // Request side — always a single well-formed JSON body containing the
    // full prior conversation, whether or not the eventual response streamed.
    try {
        const reqBody = JSON.parse(requestBodyStr || '{}');
        if (typeof reqBody.system === 'string' && reqBody.system.trim().length > 0) {
            steps.push({ index: nextIndex(), turn: 'request', role: 'system', type: 'text', text: reqBody.system });
        }
        const messages = Array.isArray(reqBody.messages) ? reqBody.messages : [];
        for (const msg of messages) {
            steps.push(...parseMessage(msg, 'request', nextIndex));
        }
    } catch {
        // Malformed or truncated request body — nothing usable to show for this side.
    }

    let responseParsed = false;
    if (!isStreaming) {
        try {
            const resBody = JSON.parse(responseBodyStr || '{}');
            if (Array.isArray(resBody.choices) && resBody.choices[0]?.message) {
                const before = steps.length;
                steps.push(...parseMessage(resBody.choices[0].message, 'response', nextIndex));
                responseParsed = steps.length > before || Object.keys(resBody.choices[0].message).length > 0;
            } else if (Array.isArray(resBody.content)) {
                steps.push(...parseMessage({ role: 'assistant', content: resBody.content }, 'response', nextIndex));
                responseParsed = true;
            }
        } catch {
            // Malformed, empty, or otherwise unparseable response body.
        }
    }

    return { steps, responseParsed };
}
