import { getPricingWithFuzzy } from '../utils/pricing';

const CHARS_PER_TOKEN = 4;
const TOKENS_PER_IMAGE = 1000;

interface TextScan {
    chars: number;
    images: number;
}

const isImagePart = (part: any): boolean =>
    part?.type === 'image' || part?.type === 'image_url' || part?.type === 'input_image' ||
    part?.inlineData != null || part?.inline_data != null || part?.fileData != null || part?.file_data != null;

/**
 * Walks a content value in any provider's shape (plain string, array of
 * parts/blocks, Anthropic tool_use/tool_result blocks, Gemini parts) and
 * accumulates text characters and image count.
 */
const scanContent = (content: any, acc: TextScan): void => {
    if (content == null) return;
    if (typeof content === 'string') {
        acc.chars += content.length;
        return;
    }
    if (Array.isArray(content)) {
        for (const part of content) scanContent(part, acc);
        return;
    }
    if (typeof content !== 'object') return;

    if (isImagePart(content)) {
        acc.images++;
        return;
    }
    if (typeof content.text === 'string') acc.chars += content.text.length;
    // Anthropic tool_result (string or nested blocks) / OpenAI Responses output
    if (content.type === 'tool_result' || content.type === 'function_call_output') {
        scanContent(content.content ?? content.output, acc);
    }
    // Anthropic tool_use / OpenAI Responses function_call: the call arguments are input tokens on the next turn
    if (content.type === 'tool_use' && content.input != null) acc.chars += JSON.stringify(content.input).length;
    if (typeof content.arguments === 'string') acc.chars += content.arguments.length;
    // OpenAI chat assistant messages carry tool-call arguments
    if (Array.isArray(content.tool_calls)) scanContent(content.tool_calls.map((t: any) => t?.function), acc);
    // Gemini: { parts: [...] }, OpenAI Responses items / chat messages: { content: ... }
    if (content.parts != null) scanContent(content.parts, acc);
    if (content.type !== 'tool_result' && content.content != null) scanContent(content.content, acc);
    // Gemini function calls/responses
    if (content.functionCall != null) acc.chars += JSON.stringify(content.functionCall).length;
    if (content.functionResponse != null) acc.chars += JSON.stringify(content.functionResponse).length;
};

const toTokens = (acc: TextScan): number =>
    Math.ceil(acc.chars / CHARS_PER_TOKEN) + acc.images * TOKENS_PER_IMAGE;

/**
 * Estimates the token count for a list of messages.
 * Uses a rough approximation of (character count / 4) for text content.
 * Adds 1000 tokens per image for vision-based requests.
 */
export const estimateTokenCount = (messages: any[]): number => {
    if (!Array.isArray(messages)) return 0;

    const acc: TextScan = { chars: 0, images: 0 };
    for (const msg of messages) scanContent(msg, acc);
    return toTokens(acc);
};

/**
 * Estimates input tokens for a whole request body, across provider shapes:
 *  - OpenAI chat / Mistral / Groq / Ollama: messages, tools
 *  - Anthropic: system (string or blocks), messages (incl. tool_use/tool_result), tools
 *  - Gemini: contents, systemInstruction, tools
 *  - OpenAI Responses: input (string or items), instructions, tools
 *  - Legacy completions: prompt
 */
export const estimateRequestTokens = (body: any): number => {
    if (!body || typeof body !== 'object') return 0;

    const acc: TextScan = { chars: 0, images: 0 };
    scanContent(body.system, acc);
    scanContent(body.instructions, acc);
    scanContent(body.systemInstruction ?? body.system_instruction, acc);
    scanContent(body.messages, acc);
    scanContent(body.contents, acc);
    scanContent(body.input, acc);
    scanContent(body.prompt, acc);
    // Tool definitions are sent to the model as input on every request
    if (Array.isArray(body.tools) && body.tools.length > 0) {
        acc.chars += JSON.stringify(body.tools).length;
    }
    return toTokens(acc);
};

// Local providers have no per-token price; the proxy logs their cost as $0.
const FREE_PROVIDERS = new Set(['ollama']);

/**
 * Estimates the total cost of a request based on input tokens and a multiplier for output.
 */
export const estimateRequestCost = (
    provider: string,
    model: string,
    inputTokens: number,
    multiplier: number = 3.0
): number => {
    if (FREE_PROVIDERS.has(provider)) return 0;

    const pricing = getPricingWithFuzzy(provider, model);
    
    if (!pricing) {
        // Fallback: If no pricing found, use a conservative default 
        // (approx $15/MTok input, $75/MTok output - Claude 3 Opus levels)
        const fallbackInput = 15 / 1_000_000;
        const fallbackOutput = 75 / 1_000_000;
        const estimatedOutput = inputTokens * multiplier;
        return (inputTokens * fallbackInput) + (estimatedOutput * fallbackOutput);
    }

    // Pricing from cache might have input_cost_per_1m or input keys
    const inputPrice = (pricing.input_cost_per_1m || pricing.input || 0) / 1_000_000;
    const outputPrice = (pricing.output_cost_per_1m || pricing.output || 0) / 1_000_000;
    const estimatedOutput = inputTokens * multiplier;

    return (inputTokens * inputPrice) + (estimatedOutput * outputPrice);
};
